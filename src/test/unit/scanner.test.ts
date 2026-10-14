import {it,expect,vi,afterEach} from 'vitest';
import {scanUniverse,scanUniverseAsync} from '../../server/backtest/scanner';
import {filterSymbolsByUniverse} from '../../server/data/symbols';
import {StrategyAST} from '../../shared/strategy/types';
const strategy={indicators:[],rules:{entry:[],exit:[]}} as unknown as StrategyAST;
afterEach(()=>vi.unstubAllEnvs());
it('scans complete membership despite response limit and reports historical provenance',()=>{vi.stubEnv('DATA_MODE','demo');const result=scanUniverse(strategy,'nifty50',1,{asOf:'2025-01-10'});expect(result.attempted).toBe(filterSymbolsByUniverse('NIFTY_50').length);expect(result.succeeded+result.unavailable+result.failed).toBe(result.requested);expect(result.matches.length).toBeLessThanOrEqual(1);expect(result.dataSource).not.toBe('NSE_LIVE_STREAM');for(const m of result.matches)expect(m.lastDate<='2025-01-10').toBe(true);});
it('unavailable real symbols are not represented as unmatched successes',async()=>{vi.stubEnv('DATA_MODE','real');const r=await scanUniverseAsync(strategy,'indices');expect(r.unavailable).toBe(r.requested);expect(r.succeeded).toBe(0);expect(r.errors.length).toBe(r.requested);});
it('rejects unsupported universe instead of scanning an unrelated fallback',()=>expect(()=>scanUniverse(strategy,'bogus')).toThrow());
