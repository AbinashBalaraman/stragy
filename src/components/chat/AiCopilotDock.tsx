import React, { useEffect, useRef, useState } from 'react';
import { Send, X, RotateCcw, Play } from 'lucide-react';
import { z } from 'zod';
import type { StrategyAST } from '../../shared/strategy/types';
import { snapshotStrategy } from '../../client/workspace';
import { assertProposalCurrent, parseStrategyProposal, type StrategyProposal } from '../../shared/contracts/ai-proposal';
import { requestScan, type ScanResult } from '../../client/api';
import { requestResearchChat } from '../../client/researchChat';
import type { ResearchScreenPlan } from '../../shared/contracts/research-chat';
export interface ChatMessage { id: string; sender: 'user' | 'assistant'; text: string; timestamp: number; }
interface Props { onResearchBacktest?: (strategy: StrategyAST, asOf?: string) => Promise<void>; strategy: StrategyAST; onApplyVariation?: (strategy: StrategyAST) => boolean | void | Promise<boolean | void>; onRunBacktest?: () => Promise<void> | void; onRunScanner?: () => void; onClose?: () => void; }
const MessageSchema = z.object({id:z.string(),sender:z.enum(['user','assistant']),text:z.string().max(6000),timestamp:z.number().finite()});
type Proposal = StrategyProposal & { sourceSnapshot: string; validatedCandidate: StrategyAST };
const HISTORY_KEY = 'stragy_copilot_review_history_v2';
function loadHistory(): ChatMessage[] { try { return z.array(MessageSchema).max(40).parse(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')); } catch { return []; } }
export const AiCopilotDock: React.FC<Props> = ({ strategy, onApplyVariation, onRunBacktest, onRunScanner, onClose, onResearchBacktest }) => {
  const [messages,setMessages]=useState<ChatMessage[]>(loadHistory);
  const [prompt,setPrompt]=useState('');
  const [screenPlan,setScreenPlan]=useState<ResearchScreenPlan|null>(null);
  const [scanResult,setScanResult]=useState<ScanResult|null>(null);
  const [scanPending,setScanPending]=useState(false);
  const [scanError,setScanError]=useState('');
  const [useWorkspace,setUseWorkspace]=useState(false);
  const [proposal,setProposal]=useState<Proposal|null>(null);
  const [allowLocal,setAllowLocal]=useState(true);
  const [loading,setLoading]=useState(false);
  const [running,setRunning]=useState(false);
  const [error,setError]=useState('');
  const [applied,setApplied]=useState<string|null>(null);
  const [applyStatus,setApplyStatus]=useState('');
  const [clipboardStatus,setClipboardStatus]=useState('');
  const pendingApply=useRef<{id:string;snapshot:string}|null>(null);
  const clipboardGeneration=useRef(0);
  const [historyStatus,setHistoryStatus]=useState('');
  const revision=useRef(0), generation=useRef(0), abort=useRef<AbortController|null>(null);
  const snapshot=JSON.stringify(strategy);
  useEffect(()=>{
    if(pendingApply.current){
      const pending=pendingApply.current;
      let matches=false;
      try{matches=JSON.stringify(snapshotStrategy(strategy))===pending.snapshot;}catch{/* Invalid workspaces cannot confirm an apply. */}
      if(matches){setApplied(pending.id);setApplyStatus('Draft applied to the workspace. No backtest or broker order was executed.');}
      else{setApplyStatus('Workspace changed, but applying this draft was not confirmed.');}
      pendingApply.current=null;
    }
    revision.current++; generation.current++; clipboardGeneration.current++; abort.current?.abort(); setLoading(false); setProposal(null); setScreenPlan(null); setScanResult(null); setScanPending(false); setScanError(''); setUseWorkspace(false); setClipboardStatus('');
  },[snapshot]);
  useEffect(()=>()=>{generation.current++;clipboardGeneration.current++;pendingApply.current=null;abort.current?.abort();},[]);
  useEffect(()=>{try {localStorage.setItem(HISTORY_KEY,JSON.stringify(messages.slice(-40)));setHistoryStatus('History is local to this browser.');}catch{setHistoryStatus('History was not saved: browser storage unavailable.');}},[messages]);
  const append=(sender:ChatMessage['sender'],text:string)=>setMessages(old=>[...old,{id:Date.now()+'-'+old.length,sender,text,timestamp:Date.now()}].slice(-40));
  const clear=()=>{generation.current++;abort.current?.abort();setLoading(false);setScreenPlan(null);setScanResult(null);setScanPending(false);setScanError('');setUseWorkspace(false);setMessages([]);setProposal(null);setError('');setApplied(null);setApplyStatus('');setClipboardStatus('');clipboardGeneration.current++;pendingApply.current=null;};
  const send=async(event:React.FormEvent)=>{
    event.preventDefault(); if(loading||pendingApply.current||!prompt.trim())return;
    let current:StrategyAST;
    try{current=snapshotStrategy(strategy);}catch(e){setError((e as Error).message);return;}
    const text=prompt.trim(), sourceSnapshot=JSON.stringify(strategy), originatingRevision=revision.current;
    const owned=++generation.current;abort.current?.abort();const controller=new AbortController();abort.current=controller;
    setScreenPlan(null);setScanResult(null);setScanPending(false);setScanError('');setUseWorkspace(false);setLoading(true);setError('');setApplyStatus('');setClipboardStatus('');clipboardGeneration.current++;setProposal(null);setPrompt('');append('user',text);
    try{
      const data=await requestResearchChat({message:text,currentStrategy:current,originatingRevision,allowLocalFallback:allowLocal,history:messages.slice(-20).map(m=>({role:m.sender,text:m.text})),...(screenPlan?{screenContext:{strategy:screenPlan.strategy,universe:screenPlan.universe}}:{})},controller.signal);
      if(generation.current!==owned)return;
      if(data.originatingRevision!==originatingRevision)throw new Error('This research response is stale.');
      const label=data.provider.aiGenerated?'AI-generated via '+data.provider.name+' / '+data.provider.model+'; factual claims still require data verification':data.method+' (not AI)';
      append('assistant',data.message+'\nMethod: '+label+(data.warnings.length?'\n'+data.warnings.join('\n'):''));
      if(data.method==='unavailable')setError(data.message);
      if(data.kind==='proposal'){
        const parsed=parseStrategyProposal(data.proposal);
        assertProposalCurrent(parsed,originatingRevision,sourceSnapshot,JSON.stringify(strategy));
        setProposal({...parsed,sourceSnapshot,validatedCandidate:parsed.candidate});setApplied(null);
      }else if(data.kind==='screen'){
        setScreenPlan(data);setScanPending(true);setScanResult(null);setScanError('');setUseWorkspace(false);
        try{
          const result=await requestScan({universe:data.universe,strategy:data.strategy,limit:100,...(data.asOf?{asOf:data.asOf}:{})},controller.signal);
          if(generation.current!==owned)return;
          if(result.mode!=='real'||result.matches.some(m=>m.provenance.mode!=='real')||/demo/i.test(result.dataSource))throw new Error('Real current data is unavailable. Demo results were not presented as stock matches.');
          setScanResult(result);
        }catch(e){if(generation.current===owned&&!controller.signal.aborted)setScanError((e as Error).message);}
        finally{if(generation.current===owned)setScanPending(false);}
      }
    }catch(e){if(generation.current===owned&&!controller.signal.aborted)setError((e as Error).message);}
    finally{if(generation.current===owned)setLoading(false);}
  };
  const apply=async()=>{
    if(!proposal||!onApplyVariation||applied===proposal.id||pendingApply.current)return;
    let candidate:StrategyAST;
    try{assertProposalCurrent(proposal,revision.current,proposal.sourceSnapshot,JSON.stringify(strategy));candidate=snapshotStrategy(proposal.validatedCandidate);}catch(e){setError((e as Error).message);return;}
    const pending={id:proposal.id,snapshot:JSON.stringify(candidate)};
    pendingApply.current=pending;setError('');setApplyStatus('Apply requested. Waiting for workspace confirmation.');
    try{
      const accepted=await onApplyVariation(candidate);
      if(accepted===false)throw new Error('The workspace rejected this draft. Nothing was confirmed as applied.');
      if(pendingApply.current===pending&&accepted===true){
        pendingApply.current=null;setApplied(pending.id);setApplyStatus('Draft applied to the workspace. No backtest or broker order was executed.');
      }else if(pendingApply.current===pending&&pending.snapshot===JSON.stringify(snapshotStrategy(strategy))){
        pendingApply.current=null;setApplied(pending.id);setApplyStatus('Workspace already matches this draft. No backtest or broker order was executed.');
      }
    }catch(e){if(pendingApply.current===pending){pendingApply.current=null;setApplyStatus('Draft was not confirmed as applied.');setError((e as Error).message);}}
  };
  const copy=async()=>{
    if(!proposal)return;
    const owned=++clipboardGeneration.current;setClipboardStatus('Copying draft...');
    try{
      if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable. Copy from View complete strategy instead.');
      await navigator.clipboard.writeText(JSON.stringify(proposal.validatedCandidate,null,2));
      if(clipboardGeneration.current===owned)setClipboardStatus('Draft copied. Nothing was applied or run.');
    }catch(e){if(clipboardGeneration.current===owned)setClipboardStatus('Copy failed. '+(e as Error).message);}
  };
  const run=async()=>{if(!onRunBacktest||running)return;setError('');setRunning(true);try{await onRunBacktest();}catch(e){setError((e as Error).message);}finally{setRunning(false);}};
  return <section aria-label="Strategy proposal assistant" className="flex flex-col h-full min-h-0 p-4 gap-3" onKeyDown={e=>{if(e.key==='Escape')onClose?.();}}>
    <header className="flex items-center justify-between gap-2"><h2 className="font-bold">Strategy Copilot</h2><div className="flex gap-2"><button type="button" aria-label="Clear conversation" onClick={clear}><RotateCcw size={16}/></button>{onClose&&<button type="button" aria-label="Close copilot" onClick={onClose}><X size={18}/></button>}</div></header>
    <p className="text-xs text-neutral-400">Research screens are read-only. Applying and running are separate actions. Local heuristics are not an AI model.</p>
    <div role="log" aria-live="polite" aria-label="Conversation" className="flex-1 overflow-y-auto space-y-3 min-h-0">
      {!messages.length&&<p className="text-sm text-neutral-400">Ask a research question, describe a strategy edit, or find Nifty 50 stocks with an RSI setup. Do not paste credentials.</p>}
      {messages.map(m=><article key={m.id} className="p-3 bg-[#161619] rounded-lg text-xs whitespace-pre-wrap break-words"><strong className="block mb-1">{m.sender==='user'?'You':'Assistant'}</strong>{m.text}</article>)}
      {screenPlan&&<article aria-label="Research screen" className="p-3 border rounded-lg space-y-2 text-xs">
        <h3>Nifty 50 read-only screen</h3><p>Method: {screenPlan.method}; provider: {screenPlan.provider.name}; {screenPlan.provider.aiGenerated?'AI-generated plan, strategy still requires review':'Not AI-generated'}</p>
        <ul>{screenPlan.assumptions.map((a,i)=><li key={i}>{a}</li>)}</ul>
        <details><summary>View screening strategy</summary><pre>{JSON.stringify(screenPlan.strategy,null,2)}</pre></details>
        {scanPending&&<p role="status">Scanning actual current daily data. Results pending, not zero matches.</p>}
        {scanError&&<p role="alert">Screen unavailable: {scanError}. No zero-match conclusion.</p>}
        {scanResult&&<div aria-label="Screen results"><p>Coverage: {scanResult.succeeded} succeeded / {scanResult.requested} requested; {scanResult.unavailable} unavailable; {scanResult.failed} failed. Sources: {JSON.stringify(scanResult.sourceCoverage)}. Scanned: {scanResult.scannedAt}</p>{scanResult.membership&&<p>Membership source: {scanResult.membership.source}; observed {scanResult.membership.observedAt}; {scanResult.membership.freshness}.</p>}{scanResult.observationDates&&<p>Observation dates: {scanResult.observationDates.earliest} to {scanResult.observationDates.latest}; stale datasets: {scanResult.observationDates.staleSymbols}.</p>}
          {!scanResult.succeeded?<p>No successful data coverage. Matches are unknown, not zero.</p>:<p>{scanResult.matched} matches in successfully evaluated stocks.</p>}
          {scanResult.matches.map(m=><div key={m.symbolId}><strong>{m.ticker}</strong>: RSI {Object.entries(m.indicatorValues).filter(([id])=>screenPlan.strategy.indicators.some(i=>i.id===id&&i.type==='RSI')).map(([id,value])=>id+' '+value.toFixed(2)).join(', ')||'unavailable'}; current daily date {m.lastDate}; prior overbought date {m.matchedRules.filter((_,index)=>screenPlan.strategy.rules.entry[index]?.lookback).map(r=>r.matchedDate).filter(Boolean).join(', ')||'not supplied'}; source {m.provenance.source}; freshness {m.provenance.freshness}{useWorkspace&&onResearchBacktest&&<button type="button" disabled={running||loading} className="ml-2 underline" onClick={async()=>{setRunning(true);setError('');try{await onResearchBacktest(snapshotStrategy(screenPlan.strategy,m.symbolId),m.lastDate);}catch(e){setError((e as Error).message);}finally{setRunning(false);}}}>Backtest {m.ticker}</button>}</div>)}
          {scanResult.errors.map((e,i)=><p key={i}>{e.symbolId}: {e.code} {e.message}</p>)}{scanResult.warnings.map((w,i)=><p key={i}>{w}</p>)}
        </div>}
        <p>Backtest incomplete: exits, sizing, execution and costs are not specified by this screen. Nothing was applied or backtested.</p>
        <details><summary>Exact workspace assumptions for a backtest</summary><pre>{JSON.stringify({exit:strategy.rules.exit,risk:strategy.risk,execution:strategy.execution,costs:strategy.costs},null,2)}</pre></details>
        <button type="button" disabled={useWorkspace||scanPending} onClick={()=>setUseWorkspace(true)}>Use current workspace exits and sizing, execution and costs</button>
        {useWorkspace&&<><p>Explicit workspace assumptions selected above. Review before running. The workspace itself is unchanged.</p><button type="button" disabled={!onResearchBacktest||running||loading} onClick={async()=>{if(!onResearchBacktest||running)return;setRunning(true);try{await onResearchBacktest(snapshotStrategy(screenPlan.strategy),screenPlan.asOf);}catch(e){setError((e as Error).message);}finally{setRunning(false);}}}>Backtest workspace symbol with these screening rules</button></>}
      </article>}
      {proposal&&<article aria-label="Draft proposal" className="p-3 border border-[#00ffa3]/30 rounded-lg space-y-2 text-xs">
        <h3 className="font-bold">Review: {proposal.validatedCandidate.name}</h3><p>Method: {proposal.method}, provider: {proposal.provider.name}; model: {proposal.provider.model??'none'}; {proposal.provider.aiGenerated?'AI-generated draft':'Not AI-generated'}</p>
        <h4 className="font-semibold">Changes</h4><ul className="list-disc pl-4">{proposal.changes.length?proposal.changes.map((c,i)=><li key={i}>{c}</li>):<li>No parameter changes proposed.</li>}</ul>
        <h4 className="font-semibold">Assumptions and warnings</h4><ul className="list-disc pl-4">{proposal.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>
        <details><summary className="cursor-pointer">View complete strategy</summary><pre className="whitespace-pre-wrap break-all mt-2">{JSON.stringify(proposal.validatedCandidate,null,2)}</pre></details>
        <div className="flex gap-2"><button className="btn-primary-mint" type="button" disabled={!onApplyVariation||!!pendingApply.current||applied===proposal.id||proposal.sourceSnapshot!==snapshot} onClick={()=>void apply()}>Apply draft</button><button type="button" onClick={()=>void copy()}>Copy draft JSON</button><button type="button" onClick={()=>{setProposal(null);setClipboardStatus('');clipboardGeneration.current++;}}>Dismiss</button></div>
      </article>}
    </div>
    {applyStatus&&<p role="status" className="text-xs">{applyStatus}</p>}
    {clipboardStatus&&<p role="status" className="text-xs">{clipboardStatus}</p>}
    {error&&<p role="alert" className="text-xs text-red-400">{error}</p>}
    {loading&&!scanPending&&<p role="status" className="text-xs">Processing research request...</p>}
    <form onSubmit={send} className="space-y-2"><label className="flex gap-2 text-xs"><input type="checkbox" checked={allowLocal} onChange={e=>setAllowLocal(e.target.checked)}/>Allow clearly labeled local heuristic fallback</label><label htmlFor="copilot-prompt" className="text-xs">Research request</label><textarea id="copilot-prompt" rows={3} maxLength={4000} value={prompt} onChange={e=>{setPrompt(e.target.value);if(scanPending){generation.current++;abort.current?.abort();setLoading(false);setScanPending(false);setScanError('Cancelled because the chat request changed.');}}} disabled={loading&&!scanPending} className="w-full p-2 rounded bg-[#161619] border border-white/10 text-sm"/><button type="submit" disabled={loading||!!pendingApply.current||!prompt.trim()} className="btn-primary-mint flex items-center gap-2"><Send size={14}/>Send request</button></form>
    <div className="flex gap-3 text-xs">{onRunBacktest&&<button type="button" disabled={loading||running||!!pendingApply.current} onClick={()=>void run()} className="flex items-center gap-1"><Play size={14}/>Run current workspace</button>}{onRunScanner&&<button type="button" onClick={onRunScanner}>Open scanner</button>}</div><p className="text-[10px] text-neutral-500">{historyStatus}</p>
  </section>;
};
