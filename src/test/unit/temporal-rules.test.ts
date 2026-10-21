import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RuleV2Schema } from '../../shared/contracts/strategy-v2';
import { RuleNodeSchema, readStrategy, toLegacyStrategy, canonicalStrategyJSON } from '../../shared/strategy/schema';
import { evaluateCondition, evaluateConditionMatch, evaluateRuleSet } from '../../server/backtest/rules';
import { calculateAllIndicators } from '../../server/backtest/indicators';
import { simulate } from '../../server/backtest/engine';
import { renderRuleInPlainLanguage } from '../../shared/strategy/renderPlainLanguage';
import type { RuleNode } from '../../shared/strategy/types';
import { strategy, bars } from '../fixtures/research';
const lookback = { bars: 20, includeCurrent: false, match: 'any' } as const;
const historical: RuleNode = { leftIndicator: 'rsi', operator: 'gte', rightValue: 70, lookback };
const current: RuleNode = { leftIndicator: 'rsi', operator: 'lt', rightValue: 30 };
const canonicalRule = { left: { kind: 'price', field: 'close' }, right: { kind: 'constant', value: 70 }, operator: 'gte' };

describe('explicit causal historical comparison windows', () => {
  it('strictly validates bounds, literals, required keys and malformed nested input in both contracts', () => {
    const bad = [null, {}, {bars:20}, {...lookback,bars:0}, {...lookback,bars:-1}, {...lookback,bars:253}, {...lookback,bars:1.5}, {...lookback,bars:Infinity}, {...lookback,bars:NaN}, {...lookback,bars:'20'}, {...lookback,includeCurrent:true}, {...lookback,match:'all'}, {...lookback,extra:true}];
    for (const value of bad) {
      expect(RuleNodeSchema.safeParse({...historical,lookback:value}).success).toBe(false);
      expect(RuleV2Schema.safeParse({...canonicalRule,lookback:value}).success).toBe(false);
    }
    for (const count of [1,20,252]) {
      expect(RuleNodeSchema.safeParse({...historical,lookback:{...lookback,bars:count}}).success).toBe(true);
      expect(RuleV2Schema.safeParse({...canonicalRule,lookback:{...lookback,bars:count}}).success).toBe(true);
    }
    expect(RuleNodeSchema.safeParse(current).success).toBe(true);
    expect(RuleV2Schema.safeParse(canonicalRule).success).toBe(true);
  });
  it('preserves exact windows through roundtrips and digest identity', () => {
    const s=strategy(); s.indicators=[{id:'rsi',type:'RSI',params:{period:14}}]; s.rules.entry=[current,historical];
    const parsed=readStrategy(s); if(!parsed.success) throw Error(parsed.errors.join('; '));
    const legacy=toLegacyStrategy(parsed.data);
    expect(legacy.rules.entry).toEqual([current,historical]);
    expect(parsed.data.rules.entry.all[1].lookback).toEqual(lookback);
    const back=readStrategy(legacy); if(!back.success) throw Error(back.errors.join('; '));
    expect(canonicalStrategyJSON(back.data)).toBe(canonicalStrategyJSON(parsed.data));
    const digest=(value:unknown)=>createHash('sha256').update(canonicalStrategyJSON(value)).digest('hex');
    const altered=structuredClone(parsed.data); altered.rules.entry.all[1].lookback!.bars=19;
    expect(digest(altered)).not.toBe(digest(parsed.data));
    delete altered.rules.entry.all[1].lookback;
    expect(digest(altered)).not.toBe(digest(parsed.data));
    expect(renderRuleInPlainLanguage(historical,s.indicators)).toContain('preceding 20 completed bars (excluding the current bar)');
  });
  it('excludes current, includes exactly the 20th prior session and excludes the 21st', () => {
    for (const [offset,expected] of [[0,false],[1,true],[20,true],[21,false]] as const) {
      const values=Array<number|null>(40).fill(50); values[30-offset]=70;
      expect(evaluateCondition(historical,30,{rsi:values})).toBe(expected);
    }
    const values=Array<number|null>(40).fill(50); values[30]=29; values[10]=70;
    expect(evaluateRuleSet([current,historical],30,{rsi:values})).toBe(true);
    values[30]=30; expect(evaluateRuleSet([current,historical],30,{rsi:values})).toBe(false);
  });
  it('reports the most recent matching session without future influence', () => {
    const values=Array<number|null>(40).fill(50); values[10]=80; values[27]=70; values[31]=99;
    const dates=values.map((_,i)=>({date:'session-'+i}));
    expect(evaluateConditionMatch(historical,30,{rsi:values},dates)).toEqual({matched:true,mostRecentMatchingIndex:27,mostRecentMatchingDate:'session-27'});
    for(let i=0;i<values.length;i++) expect(evaluateConditionMatch(historical,i,{rsi:values})).toEqual(evaluateConditionMatch(historical,i,{rsi:values.slice(0,i+1)}));
  });
  it('never treats missing, NaN, infinity or unavailable crossover warmup as true', () => {
    for(const value of [null,NaN,Infinity]) expect(evaluateCondition(historical,30,{rsi:Array(40).fill(value)})).toBe(false);
    expect(evaluateCondition(historical,0,{rsi:[80]})).toBe(false);
    expect(evaluateCondition(historical,30,{})).toBe(false);
    expect(evaluateCondition({...historical,operator:'crossesAbove'},2,{rsi:[null,80,20]})).toBe(false);
    expect(evaluateCondition({...historical,lookback:{...lookback,bars:253}},30,{rsi:Array(40).fill(80)})).toBe(false);
  });
  it('preserves level, exact, approximate and crossover operators inside the window', () => {
    for(const operator of ['gt','gte','lt','lte','eq','approxEq','crossesAbove','crossesBelow'] as const) {
      const lower=operator==='lt'||operator==='lte'||operator==='crossesBelow';
      const rule:RuleNode={leftIndicator:'a',rightIndicator:'b',operator,absoluteTolerance:.1,lookback:{...lookback,bars:1}};
      const a=operator==='eq'||operator==='approxEq'?[0,70,0]:lower?[80,60,80]:[60,80,60];
      expect(evaluateCondition(rule,2,{a,b:[70,70,70]})).toBe(true);
    }
    const cross:RuleNode={...historical,operator:'crossesAbove'};
    expect(evaluateCondition(cross,3,{rsi:[80,80,80,20]})).toBe(false);
    expect(evaluateCondition(cross,3,{rsi:[60,80,80,20]})).toBe(true);
  });
  it('uses causal Wilder RSI14 and fills the same predicate only at the next open', () => {
    const prices=[...Array.from({length:15},(_,i)=>100+i),80,81,82];
    const data=bars(prices.map(p=>[p,p+1,p-1,p]));
    const s=strategy(); s.indicators=[{id:'rsi',type:'RSI',params:{period:14}}]; s.rules.entry=[current,historical];s.rules.exit=[];
    const series=calculateAllIndicators(data,s.indicators);
    expect(series.rsi.slice(0,14)).toEqual(Array(14).fill(null));
    expect(series.rsi[14]).toBe(100);
    expect(series.rsi[15]).toBeCloseTo(100-100/(1+(13/14)/(34/14)),10);
    expect(evaluateRuleSet(s.rules.entry,14,series)).toBe(false);
    expect(evaluateRuleSet(s.rules.entry,15,series)).toBe(true);
    for(let i=0;i<data.length;i++) {
      const prefix=calculateAllIndicators(data.slice(0,i+1),s.indicators);
      expect(prefix.rsi[i]).toBe(series.rsi[i]);
      expect(evaluateRuleSet(s.rules.entry,i,prefix)).toBe(evaluateRuleSet(s.rules.entry,i,series));
    }
    const result=simulate(s,data,{initialCapital:10000,robustness:false});
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].entryDate).toBe(data[16].date);
    expect(result.trades[0].entryPrice).toBe(data[16].open);
    expect(simulate(s,data.slice(0,16),{initialCapital:10000,robustness:false}).trades).toHaveLength(0);
  });
});
