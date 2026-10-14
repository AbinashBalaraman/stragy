import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../../server/backtest/metrics';
import { bootstrapReturns, quantile, seededRandom } from '../../server/backtest/robustness';
import type { EquityPoint } from '../../shared/strategy/types';
const points = (values: number[]): EquityPoint[] => values.map((equity,i)=>({date:'2026-01-'+String(i+1).padStart(2,'0'),timestamp:i*86400000,equity,benchmarkEquity:equity,drawdown:0,drawdownPercent:0}));
describe('equity metrics',()=>{
  it('M01 uses sample Sharpe and full-sample downside deviation',()=>{const m=computeMetrics(points([100,110,99,108.9]),[],100);expect(m.totalReturnPercent).toBeCloseTo(8.9);expect(m.maxDrawdownPercent).toBeCloseTo(10);expect(m.sharpeRatio).toBeCloseTo(4.582575694955848);expect(m.sortinoRatio).toBeCloseTo(9.165151389911701);expect(m.beta).toBeCloseTo(1);expect(m.alpha).toBeCloseTo(0);});
  it('M02 elapsed time determines CAGR, not the number of fills',()=>{const p=points([100,110]);p[1].timestamp=365.2425*86400000;expect(computeMetrics(p,[],100).cagr).toBeCloseTo(10);});
  it('M03 undefined ratios are null with reasons, never Infinity',()=>{const m=computeMetrics(points([100,100,100]),[],100);expect(m.sharpeRatio).toBeNull();expect(m.sortinoRatio).toBeNull();expect(m.profitFactor).toBeNull();expect(m.beta).toBeNull();expect(m.unavailableReasons?.sharpeRatio).toBe('ZERO_VARIANCE');expect(JSON.stringify(m)).not.toContain('Infinity');});
});
describe('seeded bootstrap',()=>{
  it('R01 controlled paths preserve the observed two-return horizon',()=>{const draws=[0,0,0,.9,.9,0,.9,.9];let i=0;const r=bootstrapReturns([.1,-.1],100000,4,7,()=>draws[i++]);expect(r.p10TerminalEquity).toBeCloseTo(81000);expect(r.p50TerminalEquity).toBeCloseTo(99000);expect(r.p90TerminalEquity).toBeCloseTo(121000);expect(r.probDrawdownOver15).toBe(25);expect(r.probDrawdownOver25).toBe(0);expect(r.percentileCurves.p50).toHaveLength(3);});
  it('R02 same seed reproduces all paths and invalid RNG is rejected',()=>{expect(bootstrapReturns([.1,-.1,.04],100,20,42)).toEqual(bootstrapReturns([.1,-.1,.04],100,20,42));expect(()=>bootstrapReturns([.1],100,1,42,()=>1)).toThrow('INVALID_RANDOM_SAMPLE');expect(bootstrapReturns([],100).status).toBe('unavailable');});
  it('R03 nearest-rank percentiles and xorshift are bounded',()=>{expect(quantile([1,2,3,4],.5)).toBe(2);const rand=seededRandom(0);for(let i=0;i<1000;i++){const v=rand();expect(v).toBeGreaterThanOrEqual(0);expect(v).toBeLessThan(1);}});
});
