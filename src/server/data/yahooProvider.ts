import type { OHLCVBar, SymbolMeta } from '../../shared/strategy/types';
import { getSymbolById } from './symbols';
import { MarketDataError, type MarketProvider, type ProviderObservation } from './marketSeries';
export const ZOMATO_RENAME_SOURCE='https://nsearchives.nseindia.com/corporate/apandya_03042025182325_CML67420.pdf';
export function yahooSymbol(s:SymbolMeta):string {
 if(s.ticker==='TATAMOTORS'||s.ticker==='500570.BO')throw new MarketDataError('IDENTITY_UNVERIFIED','Tata Motors demerger identity requires verified instrument mapping');
 if(s.ticker==='ZOMATO')return 'ETERNAL.NS'; // NSE/CML/67420: same issuer renamed 2025-04-09, never SWIGGY.
 if(/^\^[A-Z0-9]+$/.test(s.ticker))return s.ticker;
 if(s.exchange==='BSE'&&/^\d{6}\.BO$/.test(s.ticker))return s.ticker;
 if(s.exchange==='NSE'&&/^[A-Z0-9][A-Z0-9&-]{0,24}$/.test(s.ticker))return s.ticker+'.NS';
 throw new MarketDataError('IDENTITY_UNVERIFIED','Unsupported exchange or ticker identity');
}
export async function boundedPublicText(url:string,signal:AbortSignal,maxBytes:number,fetcher:typeof fetch=fetch):Promise<{text:string;lastModified?:string}> {
 const response=await fetcher(url,{signal,redirect:'error',headers:{'User-Agent':'Stragy-Public-Research/2.0','Accept':'application/json,text/csv'}});
 if(!response.ok)throw new MarketDataError('PROVIDER_HTTP','Public data HTTP '+response.status);
 if(Number(response.headers.get('content-length'))>maxBytes)throw new MarketDataError('RESPONSE_TOO_LARGE','Public response exceeds byte limit');
 if(!response.body)throw new MarketDataError('INVALID_RESPONSE','Missing response body');
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{while(true){signal.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)throw new MarketDataError('RESPONSE_TOO_LARGE','Public response exceeds byte limit');chunks.push(part.value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
 return {text:Buffer.concat(chunks).toString('utf8'),lastModified:response.headers.get('last-modified')??undefined};
}
const exchangeFormatters=new Map<string,Intl.DateTimeFormat>();
export function exchangeDate(timestamp:number,timeZone='Asia/Kolkata'):string {let formatter=exchangeFormatters.get(timeZone);if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});exchangeFormatters.set(timeZone,formatter);}return formatter.format(new Date(timestamp));}
export function parseYahooChart(payload:unknown,expectedSymbol:string,now=Date.now()):ProviderObservation {
 const root=payload as any;const r=root?.chart?.result?.[0];if(root?.chart?.error||!r||r.meta?.symbol!==expectedSymbol)throw new MarketDataError('PROVIDER_UNAVAILABLE','Yahoo returned no data or mismatched identity');
 const m=r.meta;const zone=m.exchangeTimezoneName;if(!['Asia/Kolkata','Asia/Calcutta'].includes(zone)||m.currency!=='INR')throw new MarketDataError('IDENTITY_UNVERIFIED','Unexpected Yahoo exchange timezone or currency');
 const times=r.timestamp;const q=r.indicators?.quote?.[0];if(!Array.isArray(times)||times.length>5000||!q)throw new MarketDataError('INVALID_BARS','Invalid Yahoo daily dataset');
 const bars:OHLCVBar[]=[];let skipped=0,incomplete=0;const today=exchangeDate(now,zone);const ist=new Date(now+19800000);const afterClose=ist.getUTCHours()*60+ist.getUTCMinutes()>=15*60+30;const end=m.currentTradingPeriod?.regular?.end;
 for(let i=0;i<times.length;i++){
  const ts=times[i];if(typeof ts!=='number'||!Number.isFinite(ts)){skipped++;continue;}const date=exchangeDate(ts*1000,zone);
  if(date>today||(date===today&&(!afterClose||(typeof end==='number'&&now<end*1000)))){incomplete++;continue;}
  const values=[q.open?.[i],q.high?.[i],q.low?.[i],q.close?.[i],q.volume?.[i]];
  if(values.some(v=>typeof v!=='number'||!Number.isFinite(v))){skipped++;continue;}
  const [open,high,low,close,volume]=values;if(Math.min(open,high,low,close)<=0||volume<0||high<Math.max(open,close)||low>Math.min(open,close)||low>high)throw new MarketDataError('INVALID_BARS','Invalid observed Yahoo OHLCV');
  bars.push({date,timestamp:ts*1000,open,high,low,close,volume});
 }
 bars.sort((a,b)=>a.date.localeCompare(b.date));if(!bars.length)throw new MarketDataError('PROVIDER_UNAVAILABLE','No completed observed daily bars');
 const latest=bars.at(-1)!.date;const age=Math.floor((Date.parse(today)-Date.parse(latest))/86400000);
 return {bars,evidence:{source:'YAHOO_PUBLIC_CHART',providerSymbol:expectedSymbol,exchangeTimezone:zone,providerMarketTime:typeof m.regularMarketTime==='number'?new Date(m.regularMarketTime*1000).toISOString():undefined,adjustment:'Yahoo quote OHLC (split-adjusted by provider; not dividend total-return adjusted)',freshness:age>4?'stale-end-of-day':'public-delayed-end-of-day',calendarVersion:'provider-observed-sessions',warnings:['Public delayed/end-of-day data, not an exchange live-tick stream','Public endpoint availability and redistribution rights are not guaranteed',...(skipped?[skipped+' null/incomplete OHLCV rows omitted without synthesis']:[]),...(incomplete?[incomplete+' unfinished session rows omitted']:[]),...(bars.length<450?['Less than approximately two years of available daily history']:[])]}};
}
export function createYahooProvider(fetcher:typeof fetch=fetch):MarketProvider {return {name:'YAHOO_PUBLIC_CHART',async load(id,signal){const symbol=yahooSymbol(getSymbolById(id));const response=await boundedPublicText('https://query2.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?range=2y&interval=1d&includePrePost=false',signal,2_000_000,fetcher);let json:unknown;try{json=JSON.parse(response.text);}catch{throw new MarketDataError('INVALID_RESPONSE','Yahoo response was not JSON');}return parseYahooChart(json,symbol);}};}
