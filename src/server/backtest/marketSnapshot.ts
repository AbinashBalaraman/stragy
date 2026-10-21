import type { StockTrendData, MarketMoversData } from '../../shared/strategy/types';
import { UNIVERSE_OPTIONS, filterSymbolsByUniverse, type MarketUniverseType } from '../data/symbols';
import { loadMarketSeries, MarketDataError, type DataMode } from '../data/marketSeries';
import { calculateStockTrends, calculateMarketMovers } from '../data/smartApi';
import { resolveObservedUniverse, forEachMarketSymbol, type ObservedUniverse } from '../data/observedUniverse';
import { redact } from '../config';
export interface MarketSnapshot { trends: StockTrendData[]; movers?: MarketMoversData; errors: {symbolId:number;code:string;ticker?:string}[]; provenance?: unknown; coverage:{requested:number;succeeded:number;unavailable:number}; sourceCoverage:Record<string,number>; universe:string; requestedDate?:string; mode:DataMode; observationDates?:{earliest:string;latest:string;staleSymbols:number};membership?:Omit<ObservedUniverse,'symbols'>;warnings?:string[];status?:'complete'|'partial'|'unavailable'; }
/** Runs on the bounded computation worker, not the HTTP event loop. */
export async function buildMarketSnapshot(universe:string,date?:string,mode:DataMode='demo'):Promise<MarketSnapshot> {
  if(!UNIVERSE_OPTIONS.some(u=>u.id===universe))throw new MarketDataError('INVALID_UNIVERSE','Unknown universe.');
  const membership=mode==='real'?await resolveObservedUniverse(universe):undefined;
  const symbols=membership?.symbols??filterSymbolsByUniverse(universe as MarketUniverseType);
  if(symbols.length>2500)throw new MarketDataError('SCAN_BUDGET_EXCEEDED','Universe exceeds scan budget.');
  const result:MarketSnapshot={trends:[],errors:[],coverage:{requested:symbols.length,succeeded:0,unavailable:0},sourceCoverage:{},universe,requestedDate:date,mode};
  if(membership){const {symbols:_,...metadata}=membership;result.membership=metadata;result.coverage.requested=membership.requested;result.warnings=membership.warnings;for(const m of membership.unmapped)result.errors.push({symbolId:0,ticker:m.ticker,code:'IDENTITY_UNVERIFIED'});}
  await forEachMarketSymbol(symbols,async symbol=>{
    try{const series=await loadMarketSeries(symbol.id,{mode,asOf:date});if(series.bars.length<252)throw new MarketDataError('INSUFFICIENT_HISTORY','At least 252 bars required for the available-history snapshot indicators.');const asOf=series.provenance.asOf;const dates=result.observationDates??{earliest:asOf,latest:asOf,staleSymbols:0};dates.earliest=dates.earliest<asOf?dates.earliest:asOf;dates.latest=dates.latest>asOf?dates.latest:asOf;if(series.provenance.freshness.startsWith('stale'))dates.staleSymbols++;result.observationDates=dates;result.provenance=series.provenance;result.sourceCoverage[series.provenance.source]=(result.sourceCoverage[series.provenance.source]??0)+1;result.trends.push(calculateStockTrends(series.bars,symbol,date));}
    catch(error){result.errors.push({symbolId:symbol.id,code:error instanceof MarketDataError?error.code:redact('DATA_UNAVAILABLE')});}
  });
  result.trends.sort((a,b)=>a.id-b.id);
  result.status=result.trends.length===0?'unavailable':result.trends.length===result.coverage.requested?'complete':'partial';
  if(!result.trends.length)result.warnings=[...(result.warnings??[]),'No usable observations; empty results do not establish no market movers'];
  if(result.observationDates&&result.observationDates.earliest!==result.observationDates.latest)result.warnings=[...(result.warnings??[]),'Latest observed dates vary across symbols: '+result.observationDates.earliest+' through '+result.observationDates.latest];
  result.movers=calculateMarketMovers(result.trends,universe,result.trends[0]?.date);result.coverage.succeeded=result.trends.length;result.coverage.unavailable=result.errors.length;return result;
}
