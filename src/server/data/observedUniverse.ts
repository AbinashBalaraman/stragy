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
let cached:ObservedUniverse|undefined;let cachedAt=0;let pending:Promise<ObservedUniverse>|undefined;
const MEMBERSHIP_CACHE_MS=24*60*60*1000;
export interface ObservedUniverseDeps {
  fetchText?: (url: string, signal: AbortSignal, maxBytes: number) => Promise<{ text: string; lastModified?: string }>;
  now?: () => number;
}
/** Test seam: clear the process-level 24 h membership cache. */
export function resetObservedUniverseCacheForTests(): void { cached=undefined; cachedAt=0; pending=undefined; }
async function fetchOfficialConstituents(deps: ObservedUniverseDeps): Promise<ObservedUniverse> {
  const fetchText=deps.fetchText??boundedPublicText;
  // One retry: a transient NSE blip must not make the starter screen a dead end.
  for(let attempt=0;attempt<2;attempt++){
    try{const signal=AbortSignal.timeout(5000);const r=await fetchText(NIFTY50_CSV_URL,signal,65536);return parseNifty50Constituents(r.text,new Date().toISOString(),r.lastModified);}
    catch{/* retry once, then fail closed */}
  }
  throw new MarketDataError('MEMBERSHIP_UNAVAILABLE',"Couldn't load today's Nifty 50 member list (tried twice). No stocks were checked, so this is not a zero-match result.");
}
export async function resolveObservedUniverse(name:string,deps:ObservedUniverseDeps={}):Promise<ObservedUniverse> {
 const aliases:Record<string,string>={NIFTY50:'NIFTY_50',BANKNIFTY:'BANK_NIFTY',INDICES:'POPULAR_INDICES'};const id=aliases[name.toUpperCase()]||name.toUpperCase();
 if(!UNIVERSE_OPTIONS.some(x=>x.id===id))throw new MarketDataError('INVALID_UNIVERSE','Unknown universe');
 if(id!=='NIFTY_50'){
  if(!['ALL','NSE','BSE','POPULAR_INDICES'].includes(id))throw new MarketDataError('MEMBERSHIP_UNAVAILABLE','Verified current membership is available only for NIFTY_50; bundled index pools are illustrative');
  const symbols=filterSymbolsByUniverse(id as MarketUniverseType).map(s=>({...s}));if(symbols.length>100)throw new MarketDataError('SCAN_BUDGET_EXCEEDED','Broad unverified catalog scans are unavailable. Select NIFTY_50 for the official observed 50-stock universe.');return {symbols,requested:symbols.length,unmapped:[],source:'BUNDLED_INSTRUMENT_CATALOG',observedAt:new Date().toISOString(),freshness:'unverified-catalog',warnings:['Catalog instruments are not verified current exchange listings or index membership']};
 }
 const now=deps.now??Date.now;
 // A successful NIFTY 50 list is reused for 24 h and always carries its retrieval date.
 if(cached&&now()-cachedAt<MEMBERSHIP_CACHE_MS){const copy=structuredClone(cached);const warning='Membership reused from the last successful NIFTY 50 retrieval at '+cached.observedAt+' (24 h cache).';if(!copy.warnings.includes(warning))copy.warnings.push(warning);return copy;}
 if(!pending)pending=(async()=>{const fresh=await fetchOfficialConstituents(deps);cached=fresh;cachedAt=now();return fresh;})();
 try{return structuredClone(await pending);}finally{pending=undefined;}
}
/** Production observed data is sequential and provider-paced; offline/demo work remains bounded by four. */
export async function forEachMarketSymbol<T>(items:T[],run:(item:T)=>Promise<void>):Promise<void>{let cursor=0;const concurrency=process.env.NODE_ENV==='production'&&process.env.DATA_MODE==='real'?1:4;await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(cursor<items.length){const item=items[cursor++];await run(item);}}));}
