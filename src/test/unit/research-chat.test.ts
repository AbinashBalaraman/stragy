import { describe, it, expect, vi } from 'vitest';
import { researchChat } from '../../server/ai/researchChat';
import { validStrategy } from '../../server/ai/testFixtures';
import { fakeResponse, openAIBody } from '../../server/ai/testFixtures';
import { createRequestBudget } from '../../server/ai/provider';
import { filterSymbolsByUniverse } from '../../shared/data/symbols';
import { validateStrategy } from '../../shared/strategy/schema';
const prompt='Find Nifty 50 stocks with RSI in the oversold area but recently touched over bought area';
describe('research chat plans',()=>{
 it('turns the requested setup into an exact causal screen, not a fictional answer or backtest',async()=>{
  const current=validStrategy(), fetch=vi.fn();const out=await researchChat({message:prompt,currentStrategy:current,originatingRevision:5},{env:{AI_PROVIDER:'none'},fetch});
  expect(out.kind).toBe('screen');if(out.kind!=='screen')throw Error('Screen absent');expect(out.method).toBe('rule_parser');expect(out.provider.aiGenerated).toBe(false);expect(fetch).not.toHaveBeenCalled();expect(out.message).toBe('Scanning Nifty 50 for RSI below 30 after above 70. Nothing is changed or run.');expect(out.strategy.name).toBe('RSI below 30 after above 70 · Nifty 50');expect(out.strategy.rules.entry[0]).toMatchObject({operator:'lt',rightValue:30});expect(out.strategy.rules.entry[1]).toMatchObject({operator:'gte',rightValue:70,lookback:{bars:20,includeCurrent:false,match:'any'}});expect(out.strategy.rules.exit).toEqual(current.rules.exit);expect(out.strategy.risk).toEqual(current.risk);expect(out.backtestReady).toBe(false);expect(out.missingBacktestRules).toContain('positionSizing');expect(out.assumptions.join(' ')).toContain('default');expect(validateStrategy(out.strategy).success).toBe(true);
 });
 it('does not misinterpret negation, reversed order, other periods or other indicators',async()=>{
  for(const message of ['Find Nifty50 RSI not oversold after recently overbought','Find Nifty50 RSI overbought after oversold','Find Nifty50 RSI9 oversold after recently overbought','Find Nifty50 RSI oversold after overbought and volume breakout']){
   const out=await researchChat({message,currentStrategy:validStrategy()},{env:{AI_PROVIDER:'none'}});expect(out.kind).toBe('conversation');expect(out.method).toBe('unavailable');
  }
 });
 it('preserves existing indicator semantics in workspace exits',async()=>{
  const current=validStrategy();current.indicators.push({id:'rsi14',type:'RSI',params:{period:9}});const out=await researchChat({message:prompt,currentStrategy:current},{env:{AI_PROVIDER:'none'}});if(out.kind!=='screen')throw Error('Screen absent');const preserved=out.strategy.indicators.find(i=>i.id==='rsi14');if(preserved?.type!=='RSI')throw Error('Original indicator changed');expect(preserved.params.period).toBe(9);expect(out.strategy.rules.entry[0].leftIndicator).toBe('screen_rsi14');
 });
 it('rejects invalid workspace and never executes model output',async()=>{
  const fetch=vi.fn();const out=await researchChat({message:prompt,currentStrategy:{invalid:true}},{env:{AI_PROVIDER:'none'},fetch});expect(out.method).toBe('unavailable');expect(fetch).not.toHaveBeenCalled();
 });
 it('keeps explicit strategy edits as unapplied proposals',async()=>{
  const out=await researchChat({message:'set stop loss to 3%',currentStrategy:validStrategy(),allowLocalFallback:true,originatingRevision:7},{env:{AI_PROVIDER:'none'}});expect(out.kind).toBe('proposal');if(out.kind==='proposal'){expect(out.proposal.applied).toBe(false);expect(out.proposal.executes).toBe(false);expect(out.originatingRevision).toBe(7);}
 });
});

it('does not treat a do-not-scan instruction as screening intent',async()=>{
 const fetch=vi.fn(),deps={env:{AI_PROVIDER:'none'},fetch};
 const edit=await researchChat({message:'Set stop loss to 3%. Verification only: return an unapplied draft. Do not scan, backtest, save, or place orders.',currentStrategy:validStrategy(),allowLocalFallback:true},deps);expect(edit.kind).toBe('proposal');if(edit.kind==='proposal'){expect(edit.proposal.applied).toBe(false);expect(edit.proposal.executes).toBe(false);}
 const forbidden=await researchChat({message:prompt+'. Do not run a scan.',currentStrategy:validStrategy()},deps);expect(forbidden.kind).not.toBe('screen');expect(fetch).not.toHaveBeenCalled();
});

it('keeps plain stock questions in conversation instead of hijacking them as screens',async()=>{
 const fetch=vi.fn(),deps={env:{AI_PROVIDER:'none'},fetch};
 for(const message of ['what are nifty 50 stocks?','explain how stocks move','why do nifty 50 stocks react to rates?']){
  const out=await researchChat({message,currentStrategy:validStrategy()},deps);
  expect(out.kind).toBe('conversation');
  expect(out.method).toBe('unavailable');
 }
 expect(fetch).not.toHaveBeenCalled();
});

it('routes both audited RSI screen phrasings through the deterministic scanner with no provider call',async()=>{
 for(const message of ['Screen Nifty 50 for RSI below 30','Find Nifty 50 stocks with RSI(14) below 30']){
  const fetch=vi.fn();
  const out=await researchChat({message,currentStrategy:validStrategy()},{env:{AI_PROVIDER:'none'},fetch});
  expect(out.kind).toBe('screen');
  if(out.kind!=='screen')throw Error('Screen absent');
  expect(out.method).toBe('rule_parser');
  expect(out.provider.aiGenerated).toBe(false);
  expect(out.universe).toBe('NIFTY_50');
  expect(out.message).toBe('Scanning Nifty 50 for RSI below 30. Nothing is changed or run.');
  expect(out.strategy.name).toBe('RSI below 30 · Nifty 50');
  expect(out.strategy.rules.entry[0]).toMatchObject({operator:'lt',rightValue:30});
  expect(out.strategy.rules.exit).toEqual(validStrategy().rules.exit);
  expect(out.assumptions.join(' ')).toContain('Workspace exits');
  expect(fetch).not.toHaveBeenCalled();
 }
});

it('routes an RSI above screen through the deterministic scanner without a provider call',async()=>{
 const fetch=vi.fn();
 const out=await researchChat({message:'Screen Nifty 50 for RSI above 60',currentStrategy:validStrategy()},{env:{AI_PROVIDER:'none'},fetch});
 if(out.kind!=='screen')throw Error('Screen absent: '+JSON.stringify(out));
 expect(out.method).toBe('rule_parser');
 expect(out.strategy.name).toBe('RSI above 60 · Nifty 50');
 expect(out.strategy.rules.entry[0]).toMatchObject({operator:'gt',rightValue:60});
 expect(fetch).not.toHaveBeenCalled();
});

it('returns one actionable message when the model screen fails validation',async()=>{
 const bad:any=validStrategy();delete bad.risk;
 const fetch=vi.fn(async()=>fakeResponse({body:openAIBody(JSON.stringify({strategy:bad,assumptions:[]}))}));
 const out=await researchChat({message:'Screen Nifty 50 for a rare SMA divergence pattern',currentStrategy:validStrategy()},{env:{AI_PROVIDER:'openai',OPENAI_API_KEY:'fixture-screen-error',AI_MODEL:'gpt-test',AI_COST_POLICY:'operator-approved'},fetch,budget:createRequestBudget()});
 expect(out.kind).toBe('conversation');
 expect(out.message).toMatch(/^I couldn't turn that into scan rules: /);
 expect(out.message).toContain("Try 'RSI above 60' or 'break above the 20-day high'.");
 expect(out.message).not.toMatch(/failed full strategy validation/i);
 expect(fetch).toHaveBeenCalledTimes(2);
});

it('retries a failed external screen planner once with a shorter prompt and a full output budget',async()=>{
 const message='Screen Nifty 50 for a rare SMA divergence pattern';
 const fetch=vi.fn()
  .mockResolvedValueOnce(fakeResponse({status:500,body:{error:{message:'Provider reached its output limit before returning text.'}}}))
  .mockResolvedValueOnce(fakeResponse({body:openAIBody(JSON.stringify({strategy:validStrategy(),assumptions:['Retry plan.']}))}));
 const out=await researchChat({message,currentStrategy:validStrategy()},{env:{AI_PROVIDER:'openai',OPENAI_API_KEY:'fixture-screen-key',AI_MODEL:'gpt-test',AI_COST_POLICY:'operator-approved'},fetch,budget:createRequestBudget()});
 expect(out.kind).toBe('screen');
 expect(out.method).toBe('external_ai');
 expect(fetch).toHaveBeenCalledTimes(2);
 const first=JSON.parse(fetch.mock.calls[0][1].body);
 const second=JSON.parse(fetch.mock.calls[1][1].body);
 expect(first.max_completion_tokens).toBe(12000);
 expect(first.temperature).toBe(0);
 expect(second.messages[0].content.length).toBeLessThan(first.messages[0].content.length);
 expect(second.messages[1].content).not.toContain('history');
});

it('derives an external screen title from rules and keeps the model summary separate',async()=>{
 const planned=validStrategy();
 planned.indicators=[...planned.indicators,{id:'ema50',type:'EMA',params:{period:50}},{id:'rsi14',type:'RSI',params:{period:14}}];
 planned.rules.entry=[{leftIndicator:'close',operator:'gt',rightIndicator:'ema50'},{leftIndicator:'rsi14',operator:'gte',rightValue:62},{leftIndicator:'rsi14',operator:'lte',rightValue:82}];
 planned.name='Daily long setup: price is above the drawn 50-period EMA, RSI is';
 planned.description='Daily long setup above the 50-day EMA. Conditions: RSI (14) is greater than or equal to 62; RSI (14) is less than or equal to 82.';
 const fetch=vi.fn().mockResolvedValue(fakeResponse({body:openAIBody(JSON.stringify({strategy:planned,assumptions:['Fixture.']}))}));
 const out=await researchChat({message:'Screen Nifty 50 for a rare EMA and RSI divergence with SMA pattern',currentStrategy:validStrategy()},{env:{AI_PROVIDER:'openai',OPENAI_API_KEY:'fixture-title-key',AI_MODEL:'gpt-test',AI_COST_POLICY:'operator-approved'},fetch,budget:createRequestBudget()});
 if(out.kind!=='screen')throw Error('Screen absent: '+JSON.stringify(out));
 expect(out.strategy.name).toBe('Above 50 EMA · RSI 62–82 · Nifty 50');
 expect(out.strategy.description).toBe('Daily long setup above the 50-day EMA');
 expect(out.summary).toBe('Daily long setup above the 50-day EMA');
});

it('still treats an explicit screening verb plus stock topic as a screen request',async()=>{
 for(const message of ['show me Nifty 50 stocks with RSI oversold after recently overbought','find Nifty 50 stocks with RSI 14 oversold after recently overbought']){
  const out=await researchChat({message,currentStrategy:validStrategy()},{env:{AI_PROVIDER:'none'}});
  expect(out.kind).toBe('screen');
 }
});

it('keeps indicator questions conversational while explicit builds still draft',async()=>{
 for(const message of ['What does RSI measure?','What is a strategy?','Explain the meaning of a breakout']){
  const out=await researchChat({message,currentStrategy:validStrategy()},{env:{AI_PROVIDER:'none'}});
  expect(out.kind).toBe('conversation');
 }
 const built=await researchChat({message:'Build an RSI strategy'},{env:{AI_PROVIDER:'none'}});
 expect(built.kind).toBe('proposal');
 if(built.kind==='proposal')expect(built.proposal.applied).toBe(false);
});

it('never turns questions about sectors, prices or concepts into scans',async()=>{
 const questions=[
  'Which Nifty 50 sectors are strongest today? Answer in two lines.',
  'What is RSI?',
  'How did Reliance do this week?',
  'Is the market open?',
  'Which Nifty 50 stocks are strongest today?',
  'Explain the meaning of breakout',
  'What is the price of Reliance?',
  'How do sectors work?',
  'Show me Nifty 50 stocks',
  'Find Nifty 50 stocks with a setup like this chart',
 ];
 for(const message of questions){
  const fetch=vi.fn();
  const out=await researchChat({message,currentStrategy:validStrategy()},{env:{AI_PROVIDER:'none',QUOTES_PROVIDER:'none'},fetch});
  expect(out.kind,message).toBe('conversation');
  expect(fetch,message).not.toHaveBeenCalled();
 }
});

it('says sector data is unavailable instead of inventing a ranking',async()=>{
 const out=await researchChat({message:'Which Nifty 50 sectors are strongest today? Answer in two lines.',currentStrategy:validStrategy()},{env:{AI_PROVIDER:'none',QUOTES_PROVIDER:'none'}});
 expect(out.kind).toBe('conversation');
 expect(out.message).toMatch(/can't rank Nifty 50 sectors|unavailable/i);
 expect(out.method).toBe('unavailable');
});

it('normalises sector names and excludes a demerger-style duplicate quote from the ranking',async()=>{
 const symbols=filterSymbolsByUniverse('NIFTY_50').filter(symbol=>!symbol.ticker.startsWith('^'));
 const live=async(ids:number[])=>({
  source:'ANGEL_SMARTAPI' as const,available:true,delay:'unknown' as const,fetchedAt:new Date().toISOString(),cached:false,configured:true,unavailable:[],
  quotes:ids.map(symbolId=>{
   const symbol=symbols.find(item=>item.id===symbolId)!;
   const duplicate=symbol.ticker==='TATAMOTORS'||symbol.ticker==='TMPV';
   const auto=/auto/i.test(symbol.sector);
   return {symbolId,ticker:symbol.ticker,ltp:duplicate?262.4:100,open:100,high:101,low:99,close:duplicate?287.4:99,changePercent:duplicate?-8.7:auto?2:0.5,exchangeTimestamp:null,fetchedAt:new Date().toISOString(),source:'ANGEL_SMARTAPI' as const,delay:'unknown' as const};
  }),
 });
 const out=await researchChat({message:'Which Nifty 50 sectors are strongest today? Answer in two lines.',currentStrategy:validStrategy()},{env:{AI_PROVIDER:'none'},market:{live}});
 expect(out.kind).toBe('conversation');
 expect(out.provider).toEqual({name:'Angel One live quotes',model:null,aiGenerated:false});
 expect(out.message).toContain('Strongest Nifty 50 sectors today');
 expect(out.message).toContain('Automobile and Auto Components');
 expect(out.message).not.toMatch(/Automobile -/);
 expect(out.message).toContain('Excluded TATAMOTORS, TMPV');
 expect(out.message).not.toContain('-8.70');
 expect(out.message).toContain('45 of 47');
});

it('routes only explicit condition sentences to the deterministic screen path',async()=>{
 const screens=[
  'Find stocks with RSI below 30',
  'Screen for close above 200 EMA',
  'Screen Nifty 50 for RSI above 60',
  'Screen Nifty 50 for RSI between 40 and 60',
  'Find Nifty 50 stocks where close breaks above the 20-day high',
  'Screen Nifty 50 for a break above the 200-day high',
  'Find Nifty 50 stocks with a new 52-week high',
  'Screen Nifty 50 for a breakdown below the 20-day low',
  'Screen Nifty 50 for price below 50-day SMA',
 ];
 for(const message of screens){
  const fetch=vi.fn();
  const out=await researchChat({message,currentStrategy:validStrategy()},{env:{AI_PROVIDER:'none'},fetch});
  expect(out.kind,message).toBe('screen');
  expect(out.method,message).toBe('rule_parser');
  expect(fetch,message).not.toHaveBeenCalled();
 }
});

it('rejects a model plan that adds conditions the user never mentioned',async()=>{
 const planned=validStrategy();
 planned.indicators.push({id:'ema50',type:'EMA',params:{period:50}});
 planned.rules.entry=[{leftIndicator:'close',operator:'gt',rightIndicator:'ema50'}];
 const fetch=vi.fn(async()=>fakeResponse({body:openAIBody(JSON.stringify({strategy:planned,assumptions:[]}))}));
 const out=await researchChat({message:'Screen Nifty 50 for a rare volume divergence',currentStrategy:validStrategy()},{env:{AI_PROVIDER:'openai',OPENAI_API_KEY:'fixture-plan-key',AI_MODEL:'gpt-test',AI_COST_POLICY:'operator-approved'},fetch,budget:createRequestBudget()});
 expect(out.kind).toBe('conversation');
 expect(out.message).toMatch(/added conditions you didn't ask for/i);
 expect(out.message).toContain("Try 'RSI above 60' or 'break above the 20-day high'.");
});

it('surfaces key-free field errors when an AI draft fails schema validation',async()=>{
 const bad:any=validStrategy();delete bad.risk;delete bad.execution;
 const fetch=vi.fn(async()=>fakeResponse({body:openAIBody(JSON.stringify({rationale:'bad draft',warnings:[],strategy:bad}))}));
 const out=await researchChat({message:'set stop loss to 3% and add an RSI entry',currentStrategy:validStrategy()},{env:{AI_PROVIDER:'openai',OPENAI_API_KEY:'fixture-warning-key',AI_MODEL:'gpt-test',AI_COST_POLICY:'operator-approved'},fetch,budget:createRequestBudget()});
 expect(fetch).toHaveBeenCalledTimes(2);
 expect(out).toMatchObject({kind:'conversation',method:'unavailable'});
 expect(out.warnings.join(' ')).toMatch(/schema validation/i);
 expect(out.warnings.join(' ')).toMatch(/risk|execution/);
 expect(JSON.stringify(out)).not.toContain('fixture-warning-key');
});

it('offers only the verified Nifty 50 and refuses sector and all-NSE screens plainly',async()=>{
 const cases:[string,string][]=[
  ['Screen NIFTY IT for close above the 20-day high','NIFTY IT'],
  ['Screen NIFTY Metal for RSI below 40','NIFTY Metal'],
  ['Screen all NSE stocks for RSI above 70','all NSE stocks'],
  ['Screen Bank NIFTY for RSI above 60','Bank NIFTY'],
  ['Screen NIFTY Auto for RSI above 55','NIFTY Auto'],
  ['Screen NIFTY Pharma for RSI below 45','NIFTY Pharma'],
  ['Screen NIFTY FMCG for RSI above 65','NIFTY FMCG'],
 ];
 for(const [message,label] of cases){
  const fetch=vi.fn();
  const out=await researchChat({message,currentStrategy:validStrategy()},{env:{AI_PROVIDER:'none'},fetch});
  expect(out.kind,message).toBe('conversation');
  expect(out.method,message).toBe('rule_parser');
  expect(out.message,message).toBe(`I can only screen the Nifty 50 with verified membership. Use the Market scanner for ${label}. No scan was run.`);
  expect(out.message,message).not.toContain('Scanning');
  expect(fetch,message).not.toHaveBeenCalled();
 }
});

it('still prepares a Nifty 50 screen when that universe is named',async()=>{
 const out=await researchChat({message:'Screen Nifty 50 for RSI above 60',currentStrategy:validStrategy()},{env:{AI_PROVIDER:'none'}});
 expect(out.kind).toBe('screen');
 if(out.kind!=='screen')throw Error('Screen absent');
 expect(out.universe).toBe('NIFTY_50');
 expect(out.message).toBe('Scanning Nifty 50 for RSI above 60. Nothing is changed or run.');
 expect(out.strategy.name).toBe('RSI above 60 · Nifty 50');
 expect(out.assumptions.join(' ')).toContain('Universe: Nifty 50');
});

it('does not carry an unverified universe from a previous screen context',async()=>{
 const out=await researchChat({message:'Screen RSI above 60',currentStrategy:validStrategy(),screenContext:{strategy:validStrategy(),universe:'NIFTY_IT'}},{env:{AI_PROVIDER:'none'}});
 expect(out.kind).toBe('screen');
 if(out.kind!=='screen')throw Error('Screen absent');
 expect(out.universe).toBe('NIFTY_50');
 expect(out.message).toContain('Scanning Nifty 50');
});

it('refuses an unsupported universe with the same verified-membership line',async()=>{
 const cases:[string,string][]=[
  ['Screen BSE Sensex for RSI above 60','BSE Sensex'],
  ['Screen Nifty Midcap for RSI below 40','that NIFTY index'],
 ];
 for(const [message,label] of cases){
  const out=await researchChat({message,currentStrategy:validStrategy()},{env:{AI_PROVIDER:'none'}});
  expect(out.kind,message).toBe('conversation');
  expect(out.method,message).toBe('rule_parser');
  expect(out.message,message).toBe(`I can only screen the Nifty 50 with verified membership. Use the Market scanner for ${label}. No scan was run.`);
  expect(out.message,message).not.toContain('Scanning Nifty 50');
 }
});

it('resolves TCS from the catalog and never returns model deliberation',async()=>{
 const reasoning='The request is to backtest TCS with an RSI-below-30 entry. The hard schema rules require that when a current_strategy is supplied, its symbolId and instrumentId are preserved exactly. All indicators, entry rules, risk, execution and cost settings are therefore carried over unchanged.';
 const fetch=vi.fn(async()=>fakeResponse({body:openAIBody(JSON.stringify({rationale:reasoning,warnings:[],strategy:validStrategy()}))}));
 const out=await researchChat({message:'Backtest TCS with RSI below 30',currentStrategy:validStrategy()},{env:{AI_PROVIDER:'openai',OPENAI_API_KEY:'fixture-reasoning-key',AI_MODEL:'gpt-test',AI_COST_POLICY:'operator-approved'},fetch,budget:createRequestBudget()});
 expect(out.kind).toBe('proposal');
 if(out.kind!=='proposal')throw Error('Proposal absent');
 expect(out.proposal.candidate.universe.symbolId).toBe(11);
 expect(out.proposal.candidate.universe.ticker).toBe('TCS');
 expect(out.message).toBe('I prepared a draft from your request. Nothing is applied until you review and apply it.');
 expect(out.message).not.toMatch(/schema|symbolId|instrumentId|current_strategy|The request is/i);
 expect(JSON.stringify(out)).not.toContain('fixture-reasoning-key');
});

it('answers a normal why-question without discarding a long first-person reply',async()=>{
 const answer="I'd use a stop loss because it caps the loss on one idea. I size the position so a bad trade cannot erase many good ones. I place it below real support so normal market noise does not trigger it, and I keep the stop wide enough to let the trade breathe. The aim is survival first and consistency second, not a perfect entry.";
 const fetch=vi.fn(async()=>fakeResponse({body:openAIBody(answer)}));
 const out=await researchChat({message:'Why use a stop loss?'},{env:{AI_PROVIDER:'openai',OPENAI_API_KEY:'fixture-chat-key',AI_MODEL:'gpt-test',AI_COST_POLICY:'operator-approved'},fetch,budget:createRequestBudget()});
 expect(out.kind).toBe('conversation');
 if(out.kind!=='conversation')throw Error('Conversation absent');
 expect(out.message).toBe(answer);
 expect(out.method).toBe('external_ai');
 expect(fetch).toHaveBeenCalledTimes(1);
});

it('retries a chain-of-thought reply once with a direct-answer instruction',async()=>{
 const cot='The user wants a stop-loss explanation. Step 1: inspect the request. Step 2: decide on the answer.';
 const clean='A stop loss defines the most you can lose on a trade, so one bad idea cannot erase many good ones.';
 let calls=0;
 const fetch=vi.fn(async (_url: string, _init: { body: string })=>{calls+=1;return fakeResponse({body:openAIBody(calls===1?cot:clean)});});
 const out=await researchChat({message:'Why use a stop loss?'},{env:{AI_PROVIDER:'openai',OPENAI_API_KEY:'fixture-chat-key',AI_MODEL:'gpt-test',AI_COST_POLICY:'operator-approved'},fetch,budget:createRequestBudget()});
 expect(out.kind).toBe('conversation');
 if(out.kind!=='conversation')throw Error('Conversation absent');
 expect(out.message).toBe(clean);
 expect(out.message).not.toContain('Step 1');
 expect(fetch).toHaveBeenCalledTimes(2);
 const secondCall=fetch.mock.calls[1];
 expect(secondCall).toBeDefined();
 const second=JSON.parse(secondCall![1].body);
 expect(second.messages[0].content).toContain('Answer the question directly in one short paragraph. No analysis, no headings, no draft.');
});

it('never returns the reasoning text when the retry is still deliberation',async()=>{
 const cot='The user asked for an answer. Step 1: inspect the schema. Step 2: draft the reply.';
 const fetch=vi.fn(async()=>fakeResponse({body:openAIBody(cot)}));
 const out=await researchChat({message:'Why use a stop loss?'},{env:{AI_PROVIDER:'openai',OPENAI_API_KEY:'fixture-chat-key',AI_MODEL:'gpt-test',AI_COST_POLICY:'operator-approved'},fetch,budget:createRequestBudget()});
 expect(out.kind).toBe('conversation');
 if(out.kind!=='conversation')throw Error('Conversation absent');
 expect(out.message).toContain('clean answer');
 expect(out.message).not.toContain('Step 1');
 expect(out.method).toBe('unavailable');
 expect(fetch).toHaveBeenCalledTimes(2);
});

it('answers conceptual follow-ups instead of drafting an empty proposal',async()=>{
 for(const message of ['And what about a trailing stop? One sentence.','Why use a stop loss?','What is RSI? Set nothing.']){
  const out=await researchChat({message,currentStrategy:validStrategy()},{env:{AI_PROVIDER:'none'}});
  expect(out.kind,message).toBe('conversation');
  expect('proposal' in out,message).toBe(false);
  expect(out.message,message).not.toContain('No field changes');
 }
});

it('keeps explicit trailing-stop edits as proposals with a change',async()=>{
 const set=await researchChat({message:'Set a 2% trailing stop',currentStrategy:validStrategy()},{env:{AI_PROVIDER:'none'}});
 expect(set.kind).toBe('proposal');
 if(set.kind!=='proposal')throw Error('Trailing-stop proposal absent');
 expect(set.proposal.changes.length).toBeGreaterThan(0);
 expect(set.proposal.candidate.risk.trailingStop).toMatchObject({value:2});
 const change=await researchChat({message:'And change my stop to 4%',currentStrategy:validStrategy()},{env:{AI_PROVIDER:'none'}});
 expect(change.kind).toBe('proposal');
 if(change.kind!=='proposal')throw Error('Stop change proposal absent');
 expect(change.proposal.changes.length).toBeGreaterThan(0);
 expect(change.proposal.candidate.risk.stopLoss.value).toBe(4);
});
