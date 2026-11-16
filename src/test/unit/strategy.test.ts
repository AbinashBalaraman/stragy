import { describe,expect,it } from 'vitest';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import { validateStrategy,readStrategy,toLegacyStrategy,repairStrategyAST } from '../../shared/strategy/schema';
import { calculateAllIndicators,calcSMA,calcEMA,calcRSI,calcATR } from '../../server/backtest/indicators';
import { evaluateCondition,evaluateRuleSet } from '../../server/backtest/rules';
import { simulate } from '../../server/backtest/engine';
import type { IndicatorConfig } from '../../shared/strategy/types';
import { strategy,bars } from '../fixtures/research';
describe('strict strategy contracts',()=>{
  it.each(STRATEGY_TEMPLATES)('S01 validates the complete $name template',t=>{expect(validateStrategy(t.strategy).success).toBe(true);});
  it('S02 preserves fractional allocation, AND exits and legacy tolerance',()=>{const s=strategy();s.version=1;s.risk.positionSizing={type:'fixedFraction',fraction:.15};s.rules.exit.push({leftIndicator:'close',operator:'gt',rightValue:1000});const r=readStrategy(s);expect(r.success).toBe(true);if(!r.success)throw Error('failed');expect(r.data.risk.positionSizing).toEqual({type:'fixedFraction',allocationPct:15});expect(r.data.rules.exit.all).toHaveLength(2);expect(r.data.rules.entry.all[0]).toMatchObject({operator:'approxEq',absoluteTolerance:.0001});});
  it('S03 exact canonical equality remains exact through the UI/engine adapter',()=>{const v=readStrategy(strategy());if(!v.success)throw Error('failed');v.data.rules.entry.all[0]={left:{kind:'price',field:'close'},operator:'eq',right:{kind:'constant',value:100}};const s=toLegacyStrategy(v.data);expect(s.rules.entry[0].equality).toBe('exact');expect(readStrategy(s)).toMatchObject({success:true,data:{rules:{entry:{all:[{operator:'eq'}]}}}});const data=bars([[100,101,99,100.000001],[100,101,99,100]]);expect(simulate(s,data,{robustness:false}).trades).toHaveLength(0);});
  it('S04 aliases are normalized but conflicting aliases are rejected',()=>{const s=strategy();s.indicators=[{id:'m',type:'MACD',params:{fast:3,slow:5,signal:2}}];expect(validateStrategy(s).data?.indicators[0].params).toEqual({fastPeriod:3,slowPeriod:5,signalPeriod:2});s.indicators[0].params.fastPeriod=4;expect(validateStrategy(s).success).toBe(false);});
  it('S05 rejects duplicates, dangling references, namespace collisions and extra parameters',()=>{const s=strategy();s.indicators=[{id:'a',type:'EMA',params:{period:2}},{id:'a',type:'SMA',params:{period:3}}];expect(validateStrategy(s).success).toBe(false);s.indicators=[{id:'close',type:'EMA',params:{period:2}}];expect(validateStrategy(s).success).toBe(false);s.indicators=[];s.rules.entry[0].leftIndicator='missing';expect(()=>repairStrategyAST(s)).toThrow();s.rules.entry[0].leftIndicator='volume';s.indicators=[{id:'a',type:'SMA',params:{period:2,unknown:4}}];expect(validateStrategy(s).success).toBe(false);});
  it('S06 rejects unsupported timeframes, shorting, limits and ambiguous legacy fixed risk',()=>{const s=strategy();s.universe.timeframe='5m';expect(validateStrategy(s).success).toBe(false);s.universe.timeframe='1D';s.execution.allowShort=true;expect(validateStrategy(s).success).toBe(false);s.execution.allowShort=false;s.execution.orderType='LIMIT';expect(validateStrategy(s).success).toBe(false);s.execution.orderType='MARKET';s.version=1;s.risk.positionSizing={type:'fixedRisk',riskPerTrade:.01};expect(validateStrategy(s).success).toBe(false);});
  it('S07 preserves canonical revision 1 through the legacy adapter without weakening the legacy fixedRisk guard',()=>{
    const parsed=readStrategy(strategy());if(!parsed.success)throw Error('failed');
    const v=parsed.data;v.revision=1;v.risk.positionSizing={type:'fixedRisk',riskPct:25};
    const legacy=toLegacyStrategy(v);
    expect(legacy.version).toBe(1);
    expect(legacy.canonicalOrigin).toBe(true);
    const roundtrip=readStrategy(legacy);expect(roundtrip.success).toBe(true);if(!roundtrip.success)throw Error('roundtrip failed');
    expect(roundtrip.data.revision).toBe(1);
    expect(roundtrip.data.risk.positionSizing).toEqual({type:'fixedRisk',riskPct:25});
    // A genuinely legacy v1 document (no canonical marker) is still rejected.
    const ambiguous=strategy();ambiguous.version=1;ambiguous.risk.positionSizing={type:'fixedRisk',riskPerTrade:.01};
    expect(readStrategy(ambiguous).success).toBe(false);
    // Claiming the marker without declaring canonical execution semantics is not enough.
    expect(readStrategy({...ambiguous,canonicalOrigin:true}).success).toBe(false);
  });
});
describe('indicator and rule arithmetic',()=>{
  const data=bars([[1,2,.5,1],[2,3,1,2],[3,4,2,3],[4,5,3,4]]);
  it('I01 SMA and seeded EMA have explicit warmup',()=>{expect(calcSMA(data,3)).toEqual([null,null,2,3]);expect(calcEMA(data,3)).toEqual([null,null,2,3]);expect(()=>calcSMA(data,0)).toThrow();});
  it('I02 volume averaging uses volume, not closing price',()=>{const d=data.map((b,i)=>({...b,volume:[10,20,30,40][i]}));expect(calculateAllIndicators(d,[{id:'v',type:'VOLUME_SMA',params:{period:2}}]).v).toEqual([null,15,25,35]);});
  it('I03 flat RSI is 50, rising RSI is 100; ATR uses prior close gaps',()=>{expect(calcRSI(bars([[10,11,9,10],[10,11,9,10],[10,11,9,10]]),2)).toEqual([null,null,50]);expect(calcRSI(data,2).at(-1)).toBe(100);expect(calcATR(bars([[100,102,98,100],[110,112,109,111]]),1)).toEqual([4,12]);});
  it('I04 indicators are prefix-invariant and compound aliases agree',()=>{const inds:IndicatorConfig[]=[{id:'m',type:'MACD' as const,params:{fastPeriod:2,slowPeriod:3,signalPeriod:2}},{id:'st',type:'SUPERTREND' as const,params:{period:2,multiplier:2}}];const a=calculateAllIndicators(data,inds),b=calculateAllIndicators([...data,...bars([[200,201,199,200]]).map(x=>({...x,date:'2026-02-01',timestamp:Date.UTC(2026,1,1,10)}))],inds);for(const key of Object.keys(a))expect(b[key].slice(0,data.length)).toEqual(a[key]);expect(a.m_hist).toEqual(a.m_histogram);expect(a.st_dir).toEqual(a.st_direction);});
  it('I05 crossovers require finite previous operands and groups are AND',()=>{const s={a:[null,1,3],b:[2,2,2]};expect(evaluateCondition({leftIndicator:'a',operator:'crossesAbove',rightIndicator:'b'},1,s)).toBe(false);expect(evaluateCondition({leftIndicator:'a',operator:'crossesAbove',rightIndicator:'b'},2,s)).toBe(true);expect(evaluateRuleSet([{leftIndicator:'a',operator:'gt',rightValue:0},{leftIndicator:'a',operator:'gt',rightValue:100}],2,s)).toBe(false);expect(evaluateCondition({leftIndicator:'a',operator:'eq',rightValue:3.000001},2,s)).toBe(false);});
});
