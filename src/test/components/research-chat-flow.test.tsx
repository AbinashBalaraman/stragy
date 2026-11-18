// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { AiCopilotDock } from '../../components/chat/AiCopilotDock';
import { validStrategy } from '../../server/ai/testFixtures';
import type { BacktestResponse, StrategyAST } from '../../shared/strategy/types';
import { postEngineMessage } from '../../client/engine';
import { resetEngineHarness, engineReplyDefault, engineReplyOnce } from '../../test/support/engineMock';
import { requestScan } from '../../client/api';
import { requestFeatureSetup } from '../../client/featureSetup';
import { FEATURE_PREFILL_EVENT } from '../../client/featureHandoff';
import { buildChatDraft } from '../../shared/contracts/featureRegistry';
import { resolveFeatureSetup } from '../../server/ai/featureSetup';
import { validateStrategy } from '../../shared/strategy/schema';
vi.mock('../../client/engine', async () => await import('../../test/support/engineMock'));
vi.mock('../../client/api',()=>({requestScan:vi.fn()}));
vi.mock('../../client/featureSetup',()=>({requestFeatureSetup:vi.fn()}));
let dom:JSDOM;
const zero=()=>({mode:'real' as const,universe:'NIFTY_50',scanned:50,matched:0,scannedAt:'2026-10-15T12:00:00Z',dataSource:'PROVENANCE_PER_SYMBOL',matches:[],requested:50,attempted:50,succeeded:50,unavailable:0,failed:0,offset:0,limit:100,errors:[],sourceCoverage:{YAHOO_PUBLIC_CHART:50},warnings:[]});
const reliantSymbol={id:7,ticker:'RELIANCE',name:'Reliance Industries',exchange:'NSE' as const,sector:'Energy',currentPrice:2900,changePercent:0.5};
const reliancePowerSymbol={id:8,ticker:'RELIANCEPOWER',name:'Reliance Power',exchange:'NSE' as const,sector:'Utilities',currentPrice:45,changePercent:-0.5};
const matched=()=>({...zero(),matched:1,matches:[{symbolId:7,ticker:'RELIANCE',name:'Reliance Industries',sector:'Energy',lastDate:'2026-10-15',lastClose:2900,changePercent:0.5,matchedRules:[],indicatorValues:{},provenance:{mode:'real' as const,source:'YAHOO_PUBLIC_CHART',symbolId:7,asOf:'2026-10-15',fetchedAt:'2026-10-15T12:00:00Z',requestedRange:{},actualRange:{start:'2024-10-15',end:'2026-10-15'},adjustment:'split',checksum:'fixture',coverage:'full',freshness:'FRESH',warnings:[],calendarVersion:'v1'}}]});
const resultFor=(strategy:StrategyAST,overrides:Record<string,unknown>={})=>({backtestId:'run-'+strategy.id,strategy,symbol:reliantSymbol,metrics:{initialCapital:100000,finalEquity:101000,netPnl:1000,totalReturnPercent:1,cagr:null,sharpeRatio:null,maxDrawdownPercent:1,totalTrades:1,unavailableReasons:{}},equityCurve:[],trades:[],costs:{},robustness:{},indicatorsData:{},bars:[],executedAt:'2026-10-15T12:00:00Z',warnings:[],provenance:{mode:'real',source:'YAHOO_PUBLIC_CHART',asOf:'2026-10-15'},...overrides} as unknown as BacktestResponse);
function send(){fireEvent.change(screen.getByLabelText('Research request'),{target:{value:'Find Nifty 50 RSI oversold now after recently overbought'}});fireEvent.click(screen.getByRole('button',{name:'Send request'}));}
function sendText(value:string){fireEvent.change(screen.getByLabelText('Research request'),{target:{value}});fireEvent.click(screen.getByRole('button',{name:'Send request'}));}
const screenPlan=(message='Scanning Nifty 50 for RSI above 60. Nothing is changed or run.')=>{const base=validStrategy();return {schemaVersion:1 as const,kind:'screen' as const,originatingRevision:1,message,method:'rule_parser' as const,provider:{name:'none',model:null,aiGenerated:false},warnings:[],universe:'NIFTY_50',strategy:{...base,indicators:[...base.indicators,{id:'rsi14',type:'RSI' as const,params:{period:14}}],rules:{...base.rules,entry:[base.rules.entry[0],{id:'e2',leftIndicator:'rsi14',operator:'lt' as const,rightValue:35,lookback:{bars:20,includeCurrent:false as const,match:'any' as const}}]}} as StrategyAST,assumptions:[],missingBacktestRules:['exits'],backtestReady:false};};
const withScan=(plan:ReturnType<typeof screenPlan>)=>({...plan,__engineTool:{name:'scan_market',run:async()=>{try{return {result:await vi.mocked(requestScan)({universe:'NIFTY_50',strategy:plan.strategy})};}catch(error){const failure=error as {code?:string;message?:string;jobId?:string};return {error:{...(failure.code?{code:failure.code}:{}),...(failure.message?{message:failure.message}:{}),...(failure.jobId?{jobId:failure.jobId}:{})}};}}}} as Record<string,unknown>);
beforeEach(()=>{resetEngineHarness();dom=new JSDOM('',{url:'https://research.test'});vi.stubGlobal('localStorage',dom.window.localStorage);engineReplyDefault(input=>{
  const plan=screenPlan((input.text??'').includes('below 30')?'Scanning Nifty 50 for RSI below 30. Nothing is changed or run.':'Scanning Nifty 50 for RSI above 60. Nothing is changed or run.');
  return {...plan,__engineTool:{name:'scan_market',run:async()=>{
    try{return {result:await vi.mocked(requestScan)({universe:'NIFTY_50',strategy:plan.strategy})};}
    catch(error){const failure=error as {code?:string;message?:string;jobId?:string};return {error:{...(failure.code?{code:failure.code}:{}),...(failure.message?{message:failure.message}:{}),...(failure.jobId?{jobId:failure.jobId}:{})}};}
  }}};
});});
afterEach(()=>{cleanup();dom.window.close();vi.clearAllMocks();vi.unstubAllGlobals();});
it('runs an explicit read-only screen and requires a separate reviewed action before any backtest',async()=>{vi.mocked(requestScan).mockResolvedValue(matched());const apply=vi.fn(),run=vi.fn(async(candidate:StrategyAST)=>resultFor(candidate));render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onApplyVariation={apply} onResearchBacktest={run}/>);send();await screen.findByLabelText('Screen results');expect(requestScan).toHaveBeenCalledTimes(1);expect(apply).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled();expect(screen.queryByRole('article',{name:'Backtest review'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Prepare backtest for RELIANCE'}));expect(await screen.findByRole('article',{name:'Backtest review'})).toBeTruthy();expect(run).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Use these assumptions and run'}));await waitFor(()=>expect(run).toHaveBeenCalledTimes(1));expect(run.mock.calls[0]?.[0].rules.entry[1]?.lookback?.bars).toBe(20);expect(await screen.findByText(/Backtest completed/)).toBeTruthy();expect(apply).not.toHaveBeenCalled();});
it('does not present failed or all-unavailable data as zero matches',async()=>{vi.mocked(requestScan).mockRejectedValue(new Error('HTTP 504'));const view=render(<AiCopilotDock strategy={validStrategy()}/>);send();expect((await screen.findByRole('alert')).textContent).toContain("The scan didn't finish. Try again.");
expect(screen.getByRole('button', { name: 'Retry scan' })).toBeTruthy();expect(screen.queryByText('0 matches in successfully evaluated stocks.')).toBeNull();view.unmount();vi.mocked(requestScan).mockResolvedValue({...zero(),succeeded:0,unavailable:50,sourceCoverage:{},errors:Array.from({length:50},(_,i)=>({symbolId:i+1,code:'NO_DATA',message:'No bars'}))});render(<AiCopilotDock strategy={validStrategy()}/>);send();await screen.findByText('No successful data coverage. Matches are unknown, not zero.');expect(screen.queryByText('0 matches in successfully evaluated stocks.')).toBeNull();});
it('does not duplicate the zero-match headline with a count sentence',async()=>{
  vi.mocked(requestScan).mockResolvedValue(zero());
  render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={vi.fn()}/>);
  send();
  await screen.findByLabelText('Screen results');
  expect(screen.getByText('0 matches')).toBeTruthy();
  expect(screen.getByText('No stock meets all conditions today.')).toBeTruthy();
  expect(screen.queryByText('0 matches in successfully evaluated stocks.')).toBeNull();
});

it('rejects even empty demo scans instead of presenting them as current market answers',async()=>{vi.mocked(requestScan).mockResolvedValue({...zero(),mode:'demo'});render(<AiCopilotDock strategy={validStrategy()}/>);send();expect((await screen.findByRole('alert')).textContent).toContain('Real current data is unavailable right now.');expect(screen.queryByLabelText('Screen results')).toBeNull();});
it('aborts pending scan ownership when conversation is cleared',async()=>{let signal:AbortSignal|undefined;let finish!:(v:ReturnType<typeof zero>)=>void;vi.mocked(requestScan).mockImplementation((_input,s)=>{signal=s;return new Promise(resolve=>{finish=resolve;});});const view=render(<AiCopilotDock strategy={validStrategy()}/>);send();await waitFor(()=>expect(screen.getAllByText(/Results are pending, not zero matches/).length).toBeGreaterThan(0));view.rerender(<AiCopilotDock strategy={validStrategy()} newConversationSignal={1}/>);finish(zero());await waitFor(()=>expect(screen.queryByLabelText('Screen results')).toBeNull());});
it('prepares a reviewed backtest on the current screen only after explicit consent and refuses negation',async()=>{vi.mocked(requestScan).mockResolvedValue(matched());const run=vi.fn(async(candidate:StrategyAST)=>resultFor(candidate));render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={run}/>);send();await screen.findByLabelText('Screen results');sendText('backtest this on RELIANCE');const review=await screen.findByRole('article',{name:'Backtest review'});expect(within(review).getByText(/Backtest RELIANCE/)).toBeTruthy();expect(within(review).getByText(/Reliance Industries \(NSE\)/)).toBeTruthy();expect(within(review).getByText(/nothing has been run or applied/i)).toBeTruthy();expect(run).not.toHaveBeenCalled();sendText("no, don't run it");expect(await screen.findByText(/Nothing was run\. The review is still open/)).toBeTruthy();expect(run).not.toHaveBeenCalled();expect(screen.getByRole('article',{name:'Backtest review'})).toBeTruthy();sendText('use these assumptions and run');await waitFor(()=>expect(run).toHaveBeenCalledTimes(1));expect(run.mock.calls[0]?.[0].universe.symbolId).toBe(7);expect(run.mock.calls[0]?.[0].rules.entry[1]?.lookback?.bars).toBe(20);expect(await screen.findByText(/Backtest completed/)).toBeTruthy();});
it('asks for a missing or ambiguous stock instead of guessing one',async()=>{vi.mocked(requestScan).mockResolvedValue(matched());const run=vi.fn().mockResolvedValue(undefined);render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol,reliancePowerSymbol]} onResearchBacktest={run}/>);send();await screen.findByLabelText('Screen results');sendText('backtest this');expect(await screen.findByText(/Which stock should I test/)).toBeTruthy();expect(screen.queryByRole('article',{name:'Backtest review'})).toBeNull();expect(run).not.toHaveBeenCalled();sendText('cancel');expect(await screen.findByText('No backtest was prepared. Nothing was run.')).toBeTruthy();sendText('backtest this on REL');expect(await screen.findByText(/more than one possible stock/i)).toBeTruthy();expect(screen.queryByRole('article',{name:'Backtest review'})).toBeNull();expect(run).not.toHaveBeenCalled();sendText('RELIANCE');expect(await screen.findByRole('article',{name:'Backtest review'})).toBeTruthy();expect(run).not.toHaveBeenCalled();});

it('sets aside an unapproved review immediately when a new request fails, so a later run reply cannot approve it',async()=>{vi.mocked(requestScan).mockResolvedValue(matched());const run=vi.fn(async(candidate:StrategyAST)=>resultFor(candidate));render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={run}/>);send();await screen.findByLabelText('Screen results');sendText('backtest this on RELIANCE');await screen.findByRole('article',{name:'Backtest review'});engineReplyOnce(Object.assign(new Error('Provider unavailable'),{code:'ENGINE_FAILED',status:500}));sendText('change stop loss to 5%');expect(await screen.findByText(/set aside the backtest review that was waiting for approval/i)).toBeTruthy();expect((await screen.findByRole('alert')).textContent).toContain('Provider unavailable');expect(screen.queryByRole('article',{name:'Backtest review'})).toBeNull();expect(run).not.toHaveBeenCalled();sendText('use these assumptions and run');expect(await screen.findByText(/There is no current backtest review to approve/)).toBeTruthy();expect(run).not.toHaveBeenCalled();});

it('does not treat choosing assumptions, conditional replies or mixed replies as execution consent',async()=>{vi.mocked(requestScan).mockResolvedValue(matched());const run=vi.fn(async(candidate:StrategyAST)=>resultFor(candidate));render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={run}/>);send();await screen.findByLabelText('Screen results');sendText('backtest this on RELIANCE');const review=await screen.findByRole('article',{name:'Backtest review'});sendText('use these assumptions');expect(await screen.findByText(/assumptions are selected, but nothing was run/i)).toBeTruthy();expect(run).not.toHaveBeenCalled();expect(screen.getByRole('article',{name:'Backtest review'})).toBeTruthy();sendText('use these assumptions but do not run');expect(await screen.findByText(/Nothing was run\. The review is still open/)).toBeTruthy();expect(run).not.toHaveBeenCalled();expect(screen.getByRole('article',{name:'Backtest review'})).toBeTruthy();sendText('use these assumptions and run');await waitFor(()=>expect(run).toHaveBeenCalledTimes(1));expect(await screen.findByText(/Backtest completed/)).toBeTruthy();expect(within(review).getByText(/Backtest RELIANCE/)).toBeTruthy();});

it('marks no run complete when the callback resolves without a validated result',async()=>{vi.mocked(requestScan).mockResolvedValue(matched());const run=vi.fn().mockResolvedValue(undefined);render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={run}/>);send();await screen.findByLabelText('Screen results');sendText('backtest this on RELIANCE');await screen.findByRole('article',{name:'Backtest review'});fireEvent.click(screen.getByRole('button',{name:'Use these assumptions and run'}));expect(await screen.findByText(/No headline was shown and nothing was marked complete/i)).toBeTruthy();expect(screen.queryByText(/Backtest completed/)).toBeNull();expect(screen.getByRole('article',{name:'Backtest review'})).toBeTruthy();});

it('discards a pending run and its review when the workspace changes, without announcing completion',async()=>{vi.mocked(requestScan).mockResolvedValue(matched());let candidate:StrategyAST|undefined;let finish!:(value:BacktestResponse)=>void;const run=vi.fn((input:StrategyAST)=>{candidate=input;return new Promise<BacktestResponse>(resolve=>{finish=resolve;});});const first=validStrategy();const view=render(<AiCopilotDock strategy={first} symbols={[reliantSymbol]} onResearchBacktest={run}/>);send();await screen.findByLabelText('Screen results');sendText('backtest this on RELIANCE');await screen.findByRole('article',{name:'Backtest review'});fireEvent.click(screen.getByRole('button',{name:'Use these assumptions and run'}));await screen.findByText(/Backtest running on the reviewed assumptions/);view.rerender(<AiCopilotDock strategy={{...first,name:'Changed workspace'}} symbols={[reliantSymbol]} onResearchBacktest={run}/>);expect(await screen.findByText(/workspace changed, so the previous backtest review was set aside/i)).toBeTruthy();expect(screen.queryByRole('article',{name:'Backtest review'})).toBeNull();finish(resultFor(candidate!));await new Promise(resolve=>setTimeout(resolve,30));expect(screen.queryByText(/Backtest completed/)).toBeNull();expect(screen.queryByText(/Backtest running on the reviewed assumptions/)).toBeNull();});

it('cancels a pending run without accepting its later callback',async()=>{vi.mocked(requestScan).mockResolvedValue(matched());const cancel=vi.fn();let candidate:StrategyAST|undefined;let finish!:(value:BacktestResponse)=>void;const run=vi.fn((input:StrategyAST)=>{candidate=input;return new Promise<BacktestResponse>(resolve=>{finish=resolve;});});render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={run} onCancelResearch={cancel}/>);send();await screen.findByLabelText('Screen results');sendText('backtest this on RELIANCE');const review=await screen.findByRole('article',{name:'Backtest review'});fireEvent.click(screen.getByRole('button',{name:'Use these assumptions and run'}));await screen.findByText(/Backtest running on the reviewed assumptions/);fireEvent.click(within(review).getByRole('button',{name:'Cancel research'}));expect(cancel).toHaveBeenCalledTimes(1);expect(await screen.findByText('Research cancelled. No result was applied or saved.')).toBeTruthy();finish(resultFor(candidate!));await new Promise(resolve=>setTimeout(resolve,30));expect(screen.queryByText(/Backtest completed/)).toBeNull();});

it('clears a pending run when a new chat starts, without announcing the obsolete result',async()=>{vi.mocked(requestScan).mockResolvedValue(matched());const cancel=vi.fn();let candidate:StrategyAST|undefined;let finish!:(value:BacktestResponse)=>void;const run=vi.fn((input:StrategyAST)=>{candidate=input;return new Promise<BacktestResponse>(resolve=>{finish=resolve;});});const view=render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={run} onCancelResearch={cancel}/>);send();await screen.findByLabelText('Screen results');sendText('backtest this on RELIANCE');await screen.findByRole('article',{name:'Backtest review'});fireEvent.click(screen.getByRole('button',{name:'Use these assumptions and run'}));await screen.findByText(/Backtest running on the reviewed assumptions/);view.rerender(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={run} onCancelResearch={cancel} newConversationSignal={1}/>);expect(cancel).toHaveBeenCalledTimes(1);expect(screen.queryByRole('article',{name:'Backtest review'})).toBeNull();finish(resultFor(candidate!));await new Promise(resolve=>setTimeout(resolve,30));expect(screen.queryByText(/Backtest completed/)).toBeNull();expect(screen.queryByText(/Backtest running on the reviewed assumptions/)).toBeNull();});

it('preserves an intentionally empty exit set instead of reinstating old screen exits',async()=>{vi.mocked(requestScan).mockResolvedValue(matched());const base=validStrategy();const noExit:StrategyAST={...base,rules:{...base.rules,exit:[]}};const run=vi.fn(async(candidate:StrategyAST)=>resultFor(candidate));render(<AiCopilotDock strategy={noExit} symbols={[reliantSymbol]} onResearchBacktest={run}/>);send();await screen.findByLabelText('Screen results');sendText('backtest this on RELIANCE');const review=await screen.findByRole('article',{name:'Backtest review'});expect(within(review).getByText(/No rule-based exit is configured/i)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Use these assumptions and run'}));await waitFor(()=>expect(run).toHaveBeenCalledTimes(1));expect(run.mock.calls[0][0].rules.exit).toEqual([]);expect(await screen.findByText(/Backtest completed/)).toBeTruthy();});

it('refuses current exits that refer to a screen indicator with different settings',async()=>{const plan=screenPlan();const altered=JSON.parse(JSON.stringify(plan)) as typeof plan;const fast=altered.strategy.indicators.find(indicator=>indicator.id==='sma_fast');if(!fast||fast.type!=='SMA')throw new Error('fixture sma_fast expected');fast.params.period=5;engineReplyOnce(withScan(altered));vi.mocked(requestScan).mockResolvedValue(matched());const run=vi.fn();render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={run}/>);send();await screen.findByLabelText('Screen results');fireEvent.click(screen.getByRole('button',{name:'Prepare backtest for RELIANCE'}));expect(await screen.findByText(/different settings from the screen/i)).toBeTruthy();expect(screen.queryByRole('article',{name:'Backtest review'})).toBeNull();expect(run).not.toHaveBeenCalled();});

it('opens a workspace review for "Backtest my current strategy on RELIANCE" from a fresh chat',async()=>{const run=vi.fn(async(candidate:StrategyAST)=>resultFor(candidate));render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={run}/>);sendText('Backtest my current strategy on RELIANCE');const review=await screen.findByRole('article',{name:'Backtest review'});expect(within(review).getByText(/Backtest RELIANCE with “Fixture SMA cross”/)).toBeTruthy();expect(within(review).getByText(/Your workspace strategy/)).toBeTruthy();expect(run).not.toHaveBeenCalled();});

it('asks which strategy to use when "my strategy" is requested after a screen, and never substitutes the screen silently',async()=>{vi.mocked(requestScan).mockResolvedValue(matched());render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={vi.fn()}/>);send();await screen.findByLabelText('Screen results');sendText('Backtest my current strategy on RELIANCE');expect(await screen.findByLabelText('Choose backtest strategy')).toBeTruthy();expect(screen.queryByRole('article',{name:'Backtest review'})).toBeNull();expect(screen.getByRole('button',{name:/Use screen:/})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Use my strategy: Fixture SMA cross'}));const review=await screen.findByRole('article',{name:'Backtest review'});expect(within(review).getByText(/Backtest RELIANCE with “Fixture SMA cross”/)).toBeTruthy();});

it('has no direct workspace-run or scanner shortcut in the primary conversation',async()=>{render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={vi.fn()}/>);expect(screen.queryByRole('button',{name:/Run current workspace/i})).toBeNull();expect(screen.queryByRole('button',{name:/Open scanner/i})).toBeNull();});

it('supersedes a prepared review when a later backtest asks for an unknown stock, so approval cannot run it',async()=>{vi.mocked(requestScan).mockResolvedValue(matched());const run=vi.fn(async(candidate:StrategyAST)=>resultFor(candidate));render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={run}/>);send();await screen.findByLabelText('Screen results');sendText('backtest this on RELIANCE');await screen.findByRole('article',{name:'Backtest review'});sendText('backtest this on UNKNOWN');expect(await screen.findByText(/set aside the backtest review that was waiting for approval/i)).toBeTruthy();expect(await screen.findByText(/Which stock should I test/)).toBeTruthy();expect(screen.queryByRole('article',{name:'Backtest review'})).toBeNull();sendText('use these assumptions and run');expect(await screen.findByText(/There is no current backtest review to approve/)).toBeTruthy();expect(run).not.toHaveBeenCalled();});

it('supersedes a prepared review when a later backtest stock is ambiguous, so approval cannot run it',async()=>{vi.mocked(requestScan).mockResolvedValue(matched());const run=vi.fn(async(candidate:StrategyAST)=>resultFor(candidate));render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol,reliancePowerSymbol]} onResearchBacktest={run}/>);send();await screen.findByLabelText('Screen results');sendText('backtest this on RELIANCE');await screen.findByRole('article',{name:'Backtest review'});sendText('backtest this on REL');expect(await screen.findByText(/set aside the backtest review that was waiting for approval/i)).toBeTruthy();expect(await screen.findByText(/more than one possible stock/i)).toBeTruthy();expect(screen.queryByRole('article',{name:'Backtest review'})).toBeNull();sendText('use these assumptions and run');expect(await screen.findByText(/There is no current backtest review to approve/)).toBeTruthy();expect(run).not.toHaveBeenCalled();});

it('completes with the engine-normalized strategy returned by the run',async()=>{vi.mocked(requestScan).mockResolvedValue(matched());const run=vi.fn(async(candidate:StrategyAST)=>{const returned=validateStrategy(candidate).data!;expect(returned.execution).toMatchObject({executionPolicy:'next_open_long_cash_v1',liquidateAtEnd:true});return resultFor(returned);});render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={run}/>);send();await screen.findByLabelText('Screen results');sendText('backtest this on RELIANCE');await screen.findByRole('article',{name:'Backtest review'});fireEvent.click(screen.getByRole('button',{name:'Use these assumptions and run'}));expect(await screen.findByText(/Backtest completed/)).toBeTruthy();expect(screen.getByRole('article',{name:'Backtest result'})).toBeTruthy();});

it('does not complete or render a headline when the result has different rules under the same strategy id',async()=>{vi.mocked(requestScan).mockResolvedValue(matched());const run=vi.fn(async(candidate:StrategyAST)=>resultFor({...candidate,rules:{...candidate.rules,entry:[{...candidate.rules.entry[0],id:'changed-entry'}]}}));render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={run}/>);send();await screen.findByLabelText('Screen results');sendText('backtest this on RELIANCE');await screen.findByRole('article',{name:'Backtest review'});fireEvent.click(screen.getByRole('button',{name:'Use these assumptions and run'}));expect(await screen.findByText(/No headline was shown and nothing was marked complete/i)).toBeTruthy();expect(screen.queryByText(/Backtest completed/)).toBeNull();expect(screen.queryByRole('article',{name:'Backtest result'})).toBeNull();});

// Data observed AFTER the reviewed cutoff is the only case that is refused.
it('does not complete or render a headline when the result contains data after the reviewed cutoff',async()=>{vi.mocked(requestScan).mockResolvedValue(matched());const run=vi.fn(async(candidate:StrategyAST)=>resultFor(candidate,{provenance:{mode:'real',source:'YAHOO_PUBLIC_CHART',asOf:'2026-10-16'}}));render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={run}/>);send();await screen.findByLabelText('Screen results');fireEvent.click(screen.getByRole('button',{name:'Prepare backtest for RELIANCE'}));await screen.findByRole('article',{name:'Backtest review'});fireEvent.click(screen.getByRole('button',{name:'Use these assumptions and run'}));expect(await screen.findByText(/No headline was shown and nothing was marked complete/i)).toBeTruthy();expect(screen.queryByText(/Backtest completed/)).toBeNull();expect(screen.queryByRole('article',{name:'Backtest result'})).toBeNull();});

it('rejects a scan without an explicit real data mode instead of treating it as verified',async()=>{
  vi.mocked(requestScan).mockResolvedValue({...zero(),mode:undefined} as never);
  render(<AiCopilotDock strategy={validStrategy()}/>);
  send();
  expect((await screen.findByRole('alert')).textContent).toContain("The scan didn't confirm real observed data.");
  expect(screen.queryByLabelText('Screen results')).toBeNull();
  expect(screen.queryByText('0 matches in successfully evaluated stocks.')).toBeNull();
});

it('opens details with the exact validated result retained in the conversation',async()=>{
  vi.mocked(requestScan).mockResolvedValue(matched());
  let validated:BacktestResponse|undefined;
  const run=vi.fn(async(candidate:StrategyAST)=>(validated=resultFor(candidate)));
  const open=vi.fn();
  render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={run} onOpenDetails={open}/>);
  send();
  await screen.findByLabelText('Screen results');
  fireEvent.click(screen.getByRole('button',{name:'Prepare backtest for RELIANCE'}));
  await screen.findByRole('article',{name:'Backtest review'});
  fireEvent.click(screen.getByRole('button',{name:'Use these assumptions and run'}));
  expect(await screen.findByText(/Backtest completed/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'View details'}));
  expect(open).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith(validated);
});

it('fills the strategy tester from a rule sentence and never runs or applies it',async()=>{
  vi.mocked(requestFeatureSetup).mockImplementation(async input => resolveFeatureSetup(input,{now:new Date('2026-11-16T12:00:00.000Z')}));
  const run=vi.fn();
  render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={run}/>);
  sendText('Backtest RSI below 30 buy, above 70 sell on Reliance');
  const review=await screen.findByRole('article',{name:'Backtest review'});
  expect(requestFeatureSetup).toHaveBeenCalledTimes(1);
  expect(within(review).getByText(/Backtest RELIANCE/)).toBeTruthy();
  expect(within(review).getByText(/RSI is below 30/)).toBeTruthy();
  expect(within(review).getByText(/RSI \(14\) is greater than 70/)).toBeTruthy();
  expect(within(review).getByText(/3.5% below the entry price/)).toBeTruthy();
  expect(within(review).getAllByText(/2023-11-17 to 2026-11-16/).length).toBeGreaterThan(0);
  expect(within(review).getByText("Or type 'run it'.")).toBeTruthy();
  expect(run).not.toHaveBeenCalled();
  fireEvent.click(within(review).getByRole('button',{name:'Use these assumptions and run'}));
  await waitFor(()=>expect(run).toHaveBeenCalledTimes(1));
  const [, asOf, runOptions] = run.mock.calls[0];
  expect(asOf).toBe('2026-11-16');
  expect(runOptions).toMatchObject({start:'2023-11-17',end:'2026-11-16',initialCapital:100000,robustness:false});
  expect(JSON.parse(localStorage.getItem('stragy_user_preferences_v1')!)).toMatchObject({lastTicker:'RELIANCE',riskPercent:3.5});
});

it('fills the composer from a chat_draft hand-off without sending',async()=>{
  render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={vi.fn()}/>);
  const draft=buildChatDraft({prompt:'Review my current strategy and suggest one improvement',source:'strategy_tester'});
  act(()=>{window.dispatchEvent(new CustomEvent(FEATURE_PREFILL_EVENT,{detail:draft}));});
  const composer=screen.getByLabelText('Research request') as HTMLTextAreaElement;
  await waitFor(()=>expect(composer.value).toBe(draft.prompt));
  await waitFor(()=>expect(document.activeElement).toBe(composer));
});

it('routes an explicit open-scanner sentence to feature setup and publishes a scanner prefill without asking for one stock',async()=>{
  const message='Open the market scanner with RSI below 30; exit when RSI is above 70';
  const response=resolveFeatureSetup({message,currentStrategy:validStrategy()},{now:new Date('2026-11-16T12:00:00Z')});
  if(response.status!=='ready')throw new Error('Expected a scanner setup: '+response.question);
  vi.mocked(requestFeatureSetup).mockResolvedValue(response);
  const preflights:unknown[]=[];
  const receive=(event:Event)=>preflights.push((event as CustomEvent).detail);
  window.addEventListener(FEATURE_PREFILL_EVENT,receive);
  try{
    render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={vi.fn()}/>);
    sendText(message);
    await waitFor(()=>expect(requestFeatureSetup).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(preflights).toHaveLength(1));
    expect(preflights[0]).toMatchObject({feature:'market_scanner',universe:'NIFTY_50'});
      expect(await screen.findByText(/I filled a NIFTY_50 scan setup/)).toBeTruthy();
    expect(screen.queryByText(/Which NSE stock/)).toBeNull();
  }finally{window.removeEventListener(FEATURE_PREFILL_EVENT,receive);}
});

it('keeps a simple screen sentence in chat so the deterministic screen card renders',async()=>{
  vi.mocked(requestScan).mockResolvedValue(matched());
  render(<AiCopilotDock strategy={validStrategy()} symbols={[reliantSymbol]} onResearchBacktest={vi.fn()}/>);
  sendText('Screen Nifty 50 for RSI below 30');
  await waitFor(()=>expect(postEngineMessage).toHaveBeenCalledTimes(1));
  expect(requestFeatureSetup).not.toHaveBeenCalled();
  expect(await screen.findByLabelText('Screen results')).toBeTruthy();
  expect(screen.getByText('1 match')).toBeTruthy();
  expect(screen.getByText('Scanning Nifty 50 for RSI below 30. Nothing is changed or run.')).toBeTruthy();
});

