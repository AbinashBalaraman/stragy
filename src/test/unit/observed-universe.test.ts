import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseNifty50Constituents,forEachMarketSymbol,NIFTY50_CSV_URL,resolveObservedUniverse,resetObservedUniverseCacheForTests,BUNDLED_UNIVERSE_CAP} from '../../server/data/observedUniverse';
import {ALL_SYMBOLS,UNIVERSE_OPTIONS} from '../../server/data/symbols';
const csv=readFileSync(new URL('../../server/data/nifty50-observed-2026-10-15.csv',import.meta.url),'utf8');
beforeEach(()=>resetObservedUniverseCacheForTests());
afterEach(()=>resetObservedUniverseCacheForTests());
describe('official observed NIFTY50 membership',()=>{
 it('reconciles exactly 50 official equities instead of illustrative pool',()=>{const d=parseNifty50Constituents(csv,'2026-10-15T00:00:00Z');expect(d.requested).toBe(50);expect(d.symbols.length+d.unmapped.length).toBe(50);expect(d.source).toBe(NIFTY50_CSV_URL);expect(d.symbols.some(s=>s.ticker.startsWith('^'))).toBe(false);expect(d.unmapped).toHaveLength(0);expect(d.symbols).toHaveLength(50);expect(d.symbols.find(s=>s.ticker==='TMPV')?.id).toBe(50001);expect(d.freshness).toContain('effective date not supplied');});
 it('preserves issuer IDs for verified rename, never substitutes Swiggy',()=>{const d=parseNifty50Constituents(csv,'2026-10-15T00:00:00Z');const z=d.symbols.find(s=>s.ticker==='ZOMATO')!;expect(z.name).toBe('Eternal Ltd.');expect(z.id).toBe(ALL_SYMBOLS.find(s=>s.ticker==='ZOMATO')!.id);expect(d.symbols.some(s=>s.ticker==='SWIGGY')).toBe(false);});
 it('rejects HTML, duplicate rows and incorrect counts',()=>{expect(()=>parseNifty50Constituents('<html>Unavailable</html>','now')).toThrow();expect(()=>parseNifty50Constituents(csv.replace('ADANIPORTS,EQ','ADANIENT,EQ'),'now')).toThrow();expect(()=>parseNifty50Constituents(csv+'Extra,Industry,FAKE,EQ,INE423A01024\n','now')).toThrow();});
 it('limits concurrent series operations to four and runs all symbols',async()=>{let active=0,max=0,count=0;await forEachMarketSymbol(Array.from({length:50},(_,i)=>i),async()=>{max=Math.max(max,++active);await new Promise(resolve=>setTimeout(resolve,1));active--;count++;});expect(max).toBeLessThanOrEqual(4);expect(count).toBe(50);});
 it('retries the official constituent request once before failing',async()=>{
  const t=Date.parse('2026-11-16T10:00:00Z');
  const fetchText=vi.fn().mockRejectedValueOnce(new Error('network blip')).mockResolvedValueOnce({text:csv,lastModified:'2026-10-15T00:00:00Z'});
  const d=await resolveObservedUniverse('NIFTY_50',{fetchText,now:()=>t});
  expect(fetchText).toHaveBeenCalledTimes(2);
  expect(d.symbols).toHaveLength(50);
  expect(d.source).toBe(NIFTY50_CSV_URL);
 });
 it('falls back to the bundled NIFTY 50 pool after one retry instead of a blank screen',async()=>{
  const fetchText=vi.fn().mockRejectedValue(new Error('offline'));
  const d=await resolveObservedUniverse('NIFTY_50',{fetchText,now:()=>Date.parse('2026-11-16T10:00:00Z')});
  expect(fetchText).toHaveBeenCalledTimes(2);
  expect(d.basis).toBe('bundled-catalog');
  expect(d.verified).toBe(false);
  expect(d.source).toBe('BUNDLED_INSTRUMENT_CATALOG');
  expect(d.symbols.length).toBeGreaterThan(40);
  expect(d.warnings.join(' ')).toMatch(/Official NIFTY 50 constituent feed unavailable/);
  expect(d.warnings.join(' ')).toMatch(/Membership is unverified/);
 });
 it('can still fail strictly when the caller forbids the bundled fallback',async()=>{
  const fetchText=vi.fn().mockRejectedValue(new Error('offline'));
  await expect(resolveObservedUniverse('NIFTY_50',{fetchText,now:()=>Date.parse('2026-11-16T10:00:00Z'),allowBundledFallback:false})).rejects.toThrow(/tried twice/);
  expect(fetchText).toHaveBeenCalledTimes(2);
 });
 it('reuses the last good list for 24 h and labels its retrieval date',async()=>{
  const t=Date.parse('2026-11-16T10:00:00Z');
  const good=vi.fn().mockResolvedValue({text:csv,lastModified:'2026-10-15T00:00:00Z'});
  const first=await resolveObservedUniverse('NIFTY_50',{fetchText:good,now:()=>t});
  expect(first.warnings.join(' ')).not.toMatch(/reused/i);
  const failing=vi.fn().mockRejectedValue(new Error('offline now'));
  const second=await resolveObservedUniverse('NIFTY_50',{fetchText:failing,now:()=>t+60*60*1000});
  expect(failing).not.toHaveBeenCalled();
  expect(second.observedAt).toBe(first.observedAt);
  expect(second.warnings.join(' ')).toContain('retrieval at '+first.observedAt);
 });
});
describe('bundled configured universes',()=>{
 it('keeps the published evaluation cap in the shared universe options',()=>{
  for(const option of UNIVERSE_OPTIONS){
   if(typeof option.evaluatedCap==='number')expect(BUNDLED_UNIVERSE_CAP[option.id]).toBe(option.evaluatedCap);
  }
 });
 it('caps broad NSE and ALL at 200 by configured order instead of failing',async()=>{
  for(const id of ['NSE','ALL'] as const){
   const d=await resolveObservedUniverse(id);
   expect(d.basis).toBe('bundled-catalog');
   expect(d.verified).toBe(false);
   expect(d.selected).toBe(200);
   expect(d.available).toBeGreaterThan(200);
   expect(d.cap).toBe(200);
   expect(d.truncated).toBe(true);
   expect(d.symbols).toHaveLength(200);
   expect(d.warnings.join(' ')).toMatch(/first 200 of/);
   expect(d.symbols.every(symbol=>!symbol.ticker.startsWith('^'))).toBe(true);
  }
 });
 it('caps sector pools at 50 and names the configured-cap limitation',async()=>{
  for(const id of ['BANK_NIFTY','NIFTY_IT','NIFTY_AUTO','NIFTY_PHARMA','NIFTY_METAL','NIFTY_FMCG'] as const){
   const d=await resolveObservedUniverse(id);
   expect(d.selected).toBe(50);
   expect(d.cap).toBe(50);
   expect(d.symbols).toHaveLength(50);
   expect(d.symbols.every(symbol=>!symbol.ticker.startsWith('^'))).toBe(true);
   expect(d.warnings.join(' ')).toContain('Membership is unverified');
  }
 });
 it('screens only BSE-listed Sensex constituents so cross-listings are not double counted',async()=>{
  const d=await resolveObservedUniverse('BSE_SENSEX');
  expect(d.symbols.length).toBe(30);
  expect(d.symbols.every(symbol=>symbol.exchange==='BSE')).toBe(true);
  expect(d.truncated).toBeUndefined();
 });
 it('returns the full popular index set as benchmark metadata',async()=>{
  const d=await resolveObservedUniverse('POPULAR_INDICES');
  expect(d.symbols).toHaveLength(8);
  expect(d.symbols.every(symbol=>symbol.ticker.startsWith('^'))).toBe(true);
  expect(d.role).toBe('benchmark-only');
  expect(d.verified).toBe(false);
 });
 it('resolves aliases without inventing a universe',async()=>{
  expect((await resolveObservedUniverse('BANKNIFTY')).symbols.length).toBe(50);
  expect((await resolveObservedUniverse('NIFTY50',{fetchText:vi.fn().mockRejectedValue(new Error('offline'))})).basis).toBe('bundled-catalog');
  await expect(resolveObservedUniverse('NO_SUCH_UNIVERSE')).rejects.toMatchObject({code:'INVALID_UNIVERSE'});
 });
});
