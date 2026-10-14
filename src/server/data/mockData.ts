import { OHLCVBar } from '../../shared/strategy/types';
import { getMarketSeries } from './marketSeries';
export {loadMarketSeries,getMarketSeries} from './marketSeries';
export {refreshAllRealMarketData} from './realMarketData';
/** Explicit demo or cached observed data only. */
export function getDailyBars(id:number):OHLCVBar[]{return getMarketSeries(id).bars;}
export function generateSymbolBars(id:number,count?:number):OHLCVBar[]{if(count!==undefined&&(!Number.isInteger(count)||count<1))throw new Error('Invalid count');const bars=getDailyBars(id);return count?bars.slice(-count):bars;}
