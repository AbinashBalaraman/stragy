import { describe, it, expect, vi } from 'vitest';
import { researchChat } from '../../server/ai/researchChat';
import { validStrategy } from '../../server/ai/testFixtures';
import { fakeResponse, openAIBody } from '../../server/ai/testFixtures';
import { createRequestBudget } from '../../server/ai/provider';
import { validateStrategy } from '../../shared/strategy/schema';
const prompt='Find Nifty 50 stocks with RSI in the oversold area but recently touched over bought area';
describe('research chat plans',()=>{
 it('turns the requested setup into an exact causal screen, not a fictional answer or backtest',async()=>{
  const current=validStrategy(), fetch=vi.fn();const out=await researchChat({message:prompt,currentStrategy:current,originatingRevision:5},{env:{AI_PROVIDER:'none'},fetch});
  expect(out.kind).toBe('screen');if(out.kind!=='screen')throw Error('Screen absent');expect(out.method).toBe('rule_parser');expect(out.provider.aiGenerated).toBe(false);expect(fetch).not.toHaveBeenCalled();expect(out.strategy.rules.entry[0]).toMatchObject({operator:'lt',rightValue:30});expect(out.strategy.rules.entry[1]).toMatchObject({operator:'gte',rightValue:70,lookback:{bars:20,includeCurrent:false,match:'any'}});expect(out.strategy.rules.exit).toEqual(current.rules.exit);expect(out.strategy.risk).toEqual(current.risk);expect(out.backtestReady).toBe(false);expect(out.missingBacktestRules).toContain('positionSizing');expect(out.assumptions.join(' ')).toContain('default');expect(validateStrategy(out.strategy).success).toBe(true);
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

it('retries a failed external screen planner once with a shorter prompt and a full output budget',async()=>{
 const message='Screen Nifty 50 for a rare divergence pattern';
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
 const out=await researchChat({message:'Screen Nifty 50 for a rare divergence pattern',currentStrategy:validStrategy()},{env:{AI_PROVIDER:'openai',OPENAI_API_KEY:'fixture-title-key',AI_MODEL:'gpt-test',AI_COST_POLICY:'operator-approved'},fetch,budget:createRequestBudget()});
 if(out.kind!=='screen')throw Error('Screen absent: '+JSON.stringify(out));
 expect(out.strategy.name).toBe('Above 50 EMA · RSI 62–82');
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
