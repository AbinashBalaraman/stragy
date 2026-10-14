import type { StockTrendData, MarketMoversData } from '../../shared/strategy/types';
import { UNIVERSE_OPTIONS, filterSymbolsByUniverse, type MarketUniverseType } from '../data/symbols';
import { loadMarketSeries, MarketDataError, type DataMode } from '../data/marketSeries';
import { calculateStockTrends, calculateMarketMovers } from '../data/smartApi';
import { redact } from '../config';
export interface MarketSnapshot { trends: StockTrendData[]; movers?: MarketMoversData; errors: {symbolId:number;code:string}[]; provenance?: unknown; coverage:{requested:number;succeeded:number;unavailable:number}; sourceCoverage:Record<string,number>; universe:string; requestedDate?:string; mode:DataMode; }
/** Runs on the bounded computation worker, not the HTTP event loop. */
export async function buildMarketSnapshot(universe:string,date?:string,mode:DataMode='demo'):Promise<MarketSnapshot> {
  if(!UNIVERSE_OPTIONS.some(u=>u.id===universe))throw new MarketDataError('INVALID_UNIVERSE','Unknown universe.');
  const symbols=filterSymbolsByUniverse(universe as MarketUniverseType);
  if(symbols.length>2500)throw new MarketDataError('SCAN_BUDGET_EXCEEDED','Universe exceeds scan budget.');
  const result:MarketSnapshot={trends:[],errors:[],coverage:{requested:symbols.length,succeeded:0,unavailable:0},sourceCoverage:{},universe,requestedDate:date,mode};
  for(const symbol of symbols){
    try{const series=await loadMarketSeries(symbol.id,{mode,asOf:date});if(series.bars.length<252)throw new MarketDataError('INSUFFICIENT_HISTORY','At least 252 bars required for the available-history snapshot indicators.');result.provenance=series.provenance;result.sourceCoverage[series.provenance.source]=(result.sourceCoverage[series.provenance.source]??0)+1;result.trends.push(calculateStockTrends(series.bars,symbol,date));}
    catch(error){result.errors.push({symbolId:symbol.id,code:error instanceof MarketDataError?error.code:redact('DATA_UNAVAILABLE')});}
  }
  result.movers=calculateMarketMovers(result.trends,universe,result.trends[0]?.date);result.coverage.succeeded=result.trends.length;result.coverage.unavailable=result.errors.length;return result;
}
