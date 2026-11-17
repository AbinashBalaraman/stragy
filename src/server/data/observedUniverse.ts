import type { SymbolMeta } from '../../shared/strategy/types';
import { ALL_SYMBOLS, filterSymbolsByUniverse, UNIVERSE_OPTIONS, type MarketUniverseType } from './symbols';
import { MarketDataError } from './marketSeries';
import { boundedPublicText } from './yahooProvider';
export const NIFTY50_CSV_URL='https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv';
// Linked by https://www.nseindia.com/static/products-services/indices-nifty50-index

/**
 * Where the observed universe's membership came from.
 * - official-feed: the exchange's own current constituent file (verified).
 * - bundled-catalog: the shipped configured catalog (identifiers only; membership
 *   is illustrative and never presented as verified current membership).
 * - none: nothing could be selected; the snapshot reports status 'unavailable'.
 */
export type UniverseMembershipBasis = 'official-feed' | 'bundled-catalog' | 'none';

export interface ObservedUniverse {
  symbols: SymbolMeta[];
  requested: number;
  unmapped: { ticker: string; reason: string }[];
  source: string;
  observedAt: string;
  asOf?: string;
  freshness: string;
  warnings: string[];
  /** Membership provenance the scanner surfaces verbatim. */
  basis?: UniverseMembershipBasis;
  verified?: boolean;
  /** Symbols in the source pool before the configured cap. */
  available?: number;
  /** Symbols actually handed to the evaluation loop (after the cap). */
  selected?: number;
  cap?: number;
  truncated?: boolean;
  order?: string;
  role?: 'official-membership' | 'configured-catalog' | 'benchmark-only';
  unavailableReason?: string;
  recommendations?: string[];
}

export type ObservedUniverseDeps = {
  fetchText?: (url: string, signal: AbortSignal, maxBytes: number) => Promise<{ text: string; lastModified?: string }>;
  now?: () => number;
  /** Tests may request the strict throw; production falls back to the bundled catalog. */
  allowBundledFallback?: boolean;
};

/**
 * The bundled catalog is broad (2000+ NSE instruments; 200+ banks). A cold
 * snapshot is provider-paced at Angel's documented 2 historical requests/second,
 * so each universe has a bounded, published evaluation subset. The caps live in
 * the shared universe options so the picker and the server cannot disagree.
 */
export const BUNDLED_UNIVERSE_CAP: Partial<Record<MarketUniverseType, number>> = Object.fromEntries(
  UNIVERSE_OPTIONS.filter(option => typeof option.evaluatedCap === 'number').map(option => [option.id, option.evaluatedCap as number])
) as Partial<Record<MarketUniverseType, number>>;

function csvRows(text:string):string[][] {const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===','||c==='\n')){row.push(cell.trim());cell='';if(c==='\n'){if(row.some(Boolean))rows.push(row);row=[];}}else if(c!=='\r')cell+=c;}if(quoted)throw new MarketDataError('MEMBERSHIP_UNAVAILABLE','Malformed constituent CSV');if(cell||row.length){row.push(cell.trim());rows.push(row);}return rows;}
export function parseNifty50Constituents(text:string,observedAt:string,lastModified?:string):ObservedUniverse {
 const rows=csvRows(text.replace(/^\uFEFF/,''));const header=rows.shift();if(!header||header.join(',')!=='Company Name,Industry,Symbol,Series,ISIN Code'||rows.length!==50)throw new MarketDataError('MEMBERSHIP_UNAVAILABLE','Official constituent file must contain exactly 50 equities');
 const seen=new Set<string>();const symbols:SymbolMeta[]=[];const unmapped:ObservedUniverse['unmapped']=[];
 for(const row of rows){const [name,sector,ticker,series,isin]=row;if(series!=='EQ'||!/^INE[A-Z0-9]{9}$/.test(isin)||seen.has(ticker)||!/^[A-Z0-9&-]+$/.test(ticker))throw new MarketDataError('MEMBERSHIP_UNAVAILABLE','Invalid or duplicate official constituent');seen.add(ticker);
  // Eternal is the same issuer as Zomato (NSE/CML/67420), not Swiggy. TMPV is not silently mapped across Tata demerger.
  const oldTicker=ticker==='ETERNAL'?'ZOMATO':ticker;const s=ALL_SYMBOLS.find(x=>x.exchange==='NSE'&&x.ticker===oldTicker);
  if(!s)unmapped.push({ticker,reason:'No verified corresponding instrument ID in bundled catalog'});else symbols.push({...s,name,sector,indices:[...new Set([...(s.indices??[]),'NIFTY_50'])]});
 }
 return {symbols,unmapped,requested:50,source:NIFTY50_CSV_URL,observedAt,asOf:lastModified,freshness:'official-feed-observed; effective date not supplied',warnings:['Present-day membership creates survivorship bias for historical research','Official CSV retrieved at observedAt; publisher supplies no effective membership date',...(unmapped.length?[unmapped.length+' official members have no verified catalog ID']:[])],basis:'official-feed',verified:true,available:50,selected:symbols.length,role:'official-membership'};
}
let cached:ObservedUniverse|undefined;let cachedAt=0;let pending:Promise<ObservedUniverse>|undefined;
const MEMBERSHIP_CACHE_MS=24*60*60*1000;
/** Test seam: clear the process-level 24 h membership cache. */
export function resetObservedUniverseCacheForTests(): void { cached=undefined; cachedAt=0; pending=undefined; }

/**
 * Configured-catalog pool for a universe. Index rows are metadata for
 * POPULAR_INDICES; they are never mixed into an equity screen. BSE SENSEX is the
 * 30 BSE-listed constituents, not the 25 duplicated NSE cross-listings.
 */
export function configuredUniversePool(id: MarketUniverseType): SymbolMeta[] {
  const pool = filterSymbolsByUniverse(id);
  if (id === 'POPULAR_INDICES') return pool.filter(symbol => symbol.ticker.startsWith('^'));
  const equities = pool.filter(symbol => !symbol.ticker.startsWith('^'));
  if (id === 'BSE_SENSEX') return equities.filter(symbol => symbol.exchange === 'BSE');
  return equities;
}

function bundledResolution(id: MarketUniverseType, officialFailure?: string): ObservedUniverse {
  const pool = configuredUniversePool(id);
  const cap = BUNDLED_UNIVERSE_CAP[id];
  const selected = typeof cap === 'number' ? pool.slice(0, cap) : pool;
  const truncated = selected.length < pool.length;
  const reasons: string[] = [];
  if (id === 'NIFTY_50') {
    reasons.push('Official NIFTY 50 constituent feed unavailable' + (officialFailure ? ' (' + officialFailure + ')' : '') + '; using the bundled configured NIFTY 50 pool. Membership is unverified.');
  } else {
    reasons.push('Membership is unverified: the bundled instrument catalog is not the official current index membership for ' + id + '.');
  }
  if (truncated) reasons.push('Evaluated the first ' + selected.length + ' of ' + pool.length + ' configured symbols (cap ' + cap + ', configured catalog order); this is not full coverage.');
  const unavailableReason = selected.length === 0
    ? 'No configured instruments are available for ' + id + '; no rows could be evaluated.'
    : undefined;
  return {
    symbols: selected.map(symbol => ({ ...symbol })),
    requested: id === 'NIFTY_50' ? 50 : pool.length,
    unmapped: [],
    source: 'BUNDLED_INSTRUMENT_CATALOG',
    observedAt: new Date().toISOString(),
    freshness: 'unverified-catalog',
    warnings: reasons,
    basis: selected.length ? 'bundled-catalog' : 'none',
    verified: false,
    available: pool.length,
    selected: selected.length,
    ...(truncated ? { cap, truncated: true } : {}),
    order: 'configured-catalog-order',
    role: id === 'POPULAR_INDICES' ? 'benchmark-only' : 'configured-catalog',
    ...(unavailableReason ? { unavailableReason, recommendations: ['Select NIFTY 50 for the official observed constituent feed.', 'Retry after the instrument catalog and provider are available.'] } : {})
  };
}

async function fetchOfficialConstituents(deps: ObservedUniverseDeps): Promise<ObservedUniverse> {
  const fetchText=deps.fetchText??boundedPublicText;
  // One retry: a transient NSE blip must not make the starter screen a dead end.
  let lastError: unknown;
  for(let attempt=0;attempt<2;attempt++){
    try{const signal=AbortSignal.timeout(5000);const r=await fetchText(NIFTY50_CSV_URL,signal,65536);return parseNifty50Constituents(r.text,new Date().toISOString(),r.lastModified);}
    catch(error){lastError=error;/* retry once, then fail to the bundled fallback */}
  }
  throw new MarketDataError('MEMBERSHIP_UNAVAILABLE',"Couldn't load today's Nifty 50 member list (tried twice). No stocks were checked, so this is not a zero-match result."+(lastError instanceof Error?' Last error: '+lastError.message:''));
}

export async function resolveObservedUniverse(name:string,deps:ObservedUniverseDeps={}):Promise<ObservedUniverse> {
 const aliases:Record<string,string>={NIFTY50:'NIFTY_50',BANKNIFTY:'BANK_NIFTY',INDICES:'POPULAR_INDICES'};const id=(aliases[name.toUpperCase()]||name.toUpperCase()) as MarketUniverseType;
 if(!UNIVERSE_OPTIONS.some(x=>x.id===id))throw new MarketDataError('INVALID_UNIVERSE','Unknown universe');
 if(id!=='NIFTY_50') return bundledResolution(id);
 const now=deps.now??Date.now;
 // A successful NIFTY 50 list is reused for 24 h and always carries its retrieval date.
 if(cached&&now()-cachedAt<MEMBERSHIP_CACHE_MS){const copy=structuredClone(cached);const warning='Membership reused from the last successful NIFTY 50 retrieval at '+cached.observedAt+' (24 h cache).';if(!copy.warnings.includes(warning))copy.warnings.push(warning);return copy;}
 if(!pending)pending=(async()=>{const fresh=await fetchOfficialConstituents(deps);cached=fresh;cachedAt=now();return fresh;})();
 try{return structuredClone(await pending);}
 catch(error){
  if(deps.allowBundledFallback===false)throw error;
  // The scanner must never dead-end on a blank screen because the exchange
  // archive blipped. Identifiers come from the bundled catalog; membership is
  // labelled unverified and the owner can retry the official feed.
  return bundledResolution('NIFTY_50',error instanceof Error?error.message:undefined);
 }
 finally{pending=undefined;}
}

/** Bounded, provider-paced evaluation. Angel's historical endpoint is 2 req/s. */
export const MARKET_SYMBOL_CONCURRENCY = 4;
export async function forEachMarketSymbol<T>(items:T[],run:(item:T)=>Promise<void>,concurrency:number=MARKET_SYMBOL_CONCURRENCY):Promise<void>{
 const limit=Math.max(1,Math.min(Math.floor(Number.isFinite(concurrency)?concurrency:MARKET_SYMBOL_CONCURRENCY),8));
 let cursor=0;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(cursor<items.length){const item=items[cursor++];await run(item);}}));
}
