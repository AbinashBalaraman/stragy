import type { SymbolMeta } from '../../shared/strategy/types';
import { ALL_SYMBOLS, filterSymbolsByUniverse, UNIVERSE_OPTIONS, type MarketUniverseType } from './symbols';
import { MarketDataError } from './marketSeries';
import { boundedPublicText } from './yahooProvider';
export const NIFTY50_CSV_URL='https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv';
// Linked by https://www.nseindia.com/static/products-services/indices-nifty50-index
export interface ObservedUniverse {symbols:SymbolMeta[];requested:number;unmapped:{ticker:string;reason:string}[];source:string;observedAt:string;asOf?:string;freshness:string;warnings:string[];}
function csvRows(text:string):string[][] {const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===','||c==='\n')){row.push(cell.trim());cell='';if(c==='\n'){if(row.some(Boolean))rows.push(row);row=[];}}else if(c!=='\r')cell+=c;}if(quoted)throw new MarketDataError('MEMBERSHIP_UNAVAILABLE','Malformed constituent CSV');if(cell||row.length){row.push(cell.trim());rows.push(row);}return rows;}
export function parseNifty50Constituents(text:string,observedAt:string,lastModified?:string):ObservedUniverse {
 const rows=csvRows(text.replace(/^\uFEFF/,''));const header=rows.shift();if(!header||header.join(',')!=='Company Name,Industry,Symbol,Series,ISIN Code'||rows.length!==50)throw new MarketDataError('MEMBERSHIP_UNAVAILABLE','Official constituent file must contain exactly 50 equities');
 const seen=new Set<string>();const symbols:SymbolMeta[]=[];const unmapped:ObservedUniverse['unmapped']=[];
 for(const row of rows){const [name,sector,ticker,series,isin]=row;if(series!=='EQ'||!/^INE[A-Z0-9]{9}$/.test(isin)||seen.has(ticker)||!/^[A-Z0-9&-]+$/.test(ticker))throw new MarketDataError('MEMBERSHIP_UNAVAILABLE','Invalid or duplicate official constituent');seen.add(ticker);
 // Eternal is the same issuer as Zomato (NSE/CML/67420), not Swiggy. TMPV is not silently mapped across Tata demerger.
 const oldTicker=ticker==='ETERNAL'?'ZOMATO':ticker;const s=ALL_SYMBOLS.find(x=>x.exchange==='NSE'&&x.ticker===oldTicker);
 if(!s)unmapped.push({ticker,reason:'No verified corresponding instrument ID in bundled catalog'});else symbols.push({...s,name,sector,indices:[...new Set([...(s.indices??[]),'NIFTY_50'])]});
 }
 return {symbols,unmapped,requested:50,source:NIFTY50_CSV_URL,observedAt,asOf:lastModified,freshness:'official-feed-observed; effective date not supplied',warnings:['Present-day membership creates survivorship bias for historical research','Official CSV retrieved at observedAt; publisher supplies no effective membership date',...(unmapped.length?[unmapped.length+' official members have no verified catalog ID']:[])]};
}
let cached:ObservedUniverse|undefined;let pending:Promise<ObservedUniverse>|undefined;
export async function resolveObservedUniverse(name:string):Promise<ObservedUniverse> {
 const aliases:Record<string,string>={NIFTY50:'NIFTY_50',BANKNIFTY:'BANK_NIFTY',INDICES:'POPULAR_INDICES'};const id=aliases[name.toUpperCase()]||name.toUpperCase();
 if(!UNIVERSE_OPTIONS.some(x=>x.id===id))throw new MarketDataError('INVALID_UNIVERSE','Unknown universe');
 if(id!=='NIFTY_50'){
  if(!['ALL','NSE','BSE','POPULAR_INDICES'].includes(id))throw new MarketDataError('MEMBERSHIP_UNAVAILABLE','Verified current membership is available only for NIFTY_50; bundled index pools are illustrative');
  const symbols=filterSymbolsByUniverse(id as MarketUniverseType).map(s=>({...s}));if(symbols.length>100)throw new MarketDataError('SCAN_BUDGET_EXCEEDED','Broad unverified catalog scans are unavailable. Select NIFTY_50 for the official observed 50-stock universe.');return {symbols,requested:symbols.length,unmapped:[],source:'BUNDLED_INSTRUMENT_CATALOG',observedAt:new Date().toISOString(),freshness:'unverified-catalog',warnings:['Catalog instruments are not verified current exchange listings or index membership']};
 }
 if(cached&&Date.now()-Date.parse(cached.observedAt)<300000)return structuredClone(cached);
 if(!pending)pending=(async()=>{const signal=AbortSignal.timeout(5000);try{const r=await boundedPublicText(NIFTY50_CSV_URL,signal,65536);cached=parseNifty50Constituents(r.text,new Date().toISOString(),r.lastModified);return cached;}catch(e){throw new MarketDataError('MEMBERSHIP_UNAVAILABLE','Official NIFTY 50 constituents unavailable; no illustrative pool substituted'+(e instanceof MarketDataError?' ('+e.code+')':''));}})();
 try{return structuredClone(await pending);}finally{pending=undefined;}
}
/** A shared cursor keeps at most four fetch/evaluation operations in flight. */
export async function forEachMarketSymbol<T>(items:T[],run:(item:T)=>Promise<void>):Promise<void>{let cursor=0;await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{while(cursor<items.length){const item=items[cursor++];await run(item);}}));}
