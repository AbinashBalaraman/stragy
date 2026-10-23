import { describe, it, expect, vi } from 'vitest';
import { researchChat } from '../../server/ai/researchChat';
import { validStrategy } from '../../server/ai/testFixtures';
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
