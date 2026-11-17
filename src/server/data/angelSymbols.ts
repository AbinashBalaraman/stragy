import { promises as fs } from 'node:fs';
import path from 'node:path';
import { MarketDataError } from './marketSeries';

// Verified ticker -> Angel One token map. Reference implementation from the
// original app (git 163a80c:src/server/data/smartApi.ts), where it drove the
// live trends/movers path through fetchSmartApiCandles.
export const SMARTAPI_TOKEN_MAP: Record<string, { token: string; exchange: 'NSE'; symbol: string }> = {
  RELIANCE: { token: '2885', exchange: 'NSE', symbol: 'RELIANCE-EQ' },
  HDFCBANK: { token: '1333', exchange: 'NSE', symbol: 'HDFCBANK-EQ' },
  TCS: { token: '11536', exchange: 'NSE', symbol: 'TCS-EQ' },
  INFY: { token: '1594', exchange: 'NSE', symbol: 'INFY-EQ' },
  ICICIBANK: { token: '4963', exchange: 'NSE', symbol: 'ICICIBANK-EQ' },
  TATAMOTORS: { token: '3456', exchange: 'NSE', symbol: 'TATAMOTORS-EQ' },
  SBIN: { token: '3045', exchange: 'NSE', symbol: 'SBIN-EQ' },
  BHARTIARTL: { token: '10604', exchange: 'NSE', symbol: 'BHARTIARTL-EQ' },
  ITC: { token: '1660', exchange: 'NSE', symbol: 'ITC-EQ' },
  LT: { token: '11483', exchange: 'NSE', symbol: 'LT-EQ' },
  KOTAKBANK: { token: '1922', exchange: 'NSE', symbol: 'KOTAKBANK-EQ' },
  AXISBANK: { token: '5900', exchange: 'NSE', symbol: 'AXISBANK-EQ' },
  MARUTI: { token: '10999', exchange: 'NSE', symbol: 'MARUTI-EQ' },
  SUNPHARMA: { token: '3351', exchange: 'NSE', symbol: 'SUNPHARMA-EQ' },
  TITAN: { token: '3506', exchange: 'NSE', symbol: 'TITAN-EQ' },
  BAJFINANCE: { token: '317', exchange: 'NSE', symbol: 'BAJFINANCE-EQ' },
  TATASTEEL: { token: '3499', exchange: 'NSE', symbol: 'TATASTEEL-EQ' },
  NTPC: { token: '11630', exchange: 'NSE', symbol: 'NTPC-EQ' },
  ADANIPORTS: { token: '15083', exchange: 'NSE', symbol: 'ADANIPORTS-EQ' },
  WIPRO: { token: '3787', exchange: 'NSE', symbol: 'WIPRO-EQ' },
  POWERGRID: { token: '14977', exchange: 'NSE', symbol: 'POWERGRID-EQ' },
  COALINDIA: { token: '20374', exchange: 'NSE', symbol: 'COALINDIA-EQ' },
  ONGC: { token: '2475', exchange: 'NSE', symbol: 'ONGC-EQ' },
  JSWSTEEL: { token: '11723', exchange: 'NSE', symbol: 'JSWSTEEL-EQ' },
  HINDALCO: { token: '1363', exchange: 'NSE', symbol: 'HINDALCO-EQ' },
  DRREDDY: { token: '881', exchange: 'NSE', symbol: 'DRREDDY-EQ' },
  CIPLA: { token: '694', exchange: 'NSE', symbol: 'CIPLA-EQ' },
  'M&M': { token: '2031', exchange: 'NSE', symbol: 'M&M-EQ' },
  ZOMATO: { token: '5097', exchange: 'NSE', symbol: 'ZOMATO-EQ' },
  HAL: { token: '2303', exchange: 'NSE', symbol: 'HAL-EQ' },
  '^NSEI': { token: '99926000', exchange: 'NSE', symbol: 'Nifty 50' },
  '^NSEBANK': { token: '99926009', exchange: 'NSE', symbol: 'Nifty Bank' }
};

export type AngelExchange = 'NSE' | 'BSE';
export type AngelInstrumentKind = 'EQUITY' | 'INDEX';
export interface AngelInstrument { ticker: string; token: string; exchange: AngelExchange; symbol: string; kind: AngelInstrumentKind }
export interface AngelMasterInfo { source: 'STATIC' | 'MASTER'; size: number; downloadedAt: string | null; warnings: string[]; exchanges?: AngelExchange[] }

// Documented instrument master (docs/Instruments). Both hosts serve the same bytes;
// the .com host is the one referenced by the documentation.
const MASTER_URLS = [
  'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json',
  'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json'
] as const;
const CACHE_FILE = 'angel-scrip-master.json';
const MAX_MASTER_BYTES = 80_000_000;
const MAX_MASTER_RECORDS = 40_000;
const MASTER_TIMEOUT_MS = 60_000;
const RETRY_AFTER_FAILURE_MS = 10 * 60_000;

/**
 * Catalog index tickers are Yahoo/NSE shorthand; the provider master names the
 * same series differently. The alias only names the series: the token is always
 * read from the downloaded Angel master, never written here.
 * ^NSEI/^NSEBANK additionally have long-standing static tokens above.
 */
export const INDEX_ALIASES: Record<string, { exchange: AngelExchange; symbol: string }> = {
  '^NSEI': { exchange: 'NSE', symbol: 'Nifty 50' },
  '^NSEBANK': { exchange: 'NSE', symbol: 'Nifty Bank' },
  '^CNXIT': { exchange: 'NSE', symbol: 'Nifty IT' },
  '^CNXAUTO': { exchange: 'NSE', symbol: 'Nifty Auto' },
  '^CNXPHARMA': { exchange: 'NSE', symbol: 'Nifty Pharma' },
  '^CNXMETAL': { exchange: 'NSE', symbol: 'Nifty Metal' },
  '^CNXFMCG': { exchange: 'NSE', symbol: 'Nifty FMCG' },
  '^BSESN': { exchange: 'BSE', symbol: 'SENSEX' }
};

/** [catalog ticker, provider token, exchange, provider symbol, kind] */
type Tuple = [ticker: string, token: string, exchange: AngelExchange, symbol: string, kind: AngelInstrumentKind];
interface MasterCache { version: 2; downloadedAt: string; source: string; count: number; symbols: Tuple[] }

let master: { map: Map<string, AngelInstrument>; downloadedAt: string; source: string } | null = null;
let loadPromise: Promise<void> | null = null;
let lastFailure: { at: number; message: string } | null = null;

function istDay(now: number): string {
  return new Date(now + 19_800_000).toISOString().slice(0, 10);
}

function keyFor(exchange: AngelExchange, kind: AngelInstrumentKind, value: string): string {
  const scope = exchange === 'BSE' ? 'bse' : 'nse';
  if (kind === 'INDEX') return `${scope}:idx:${value.toUpperCase()}`;
  // BSE equities are indexed by scrip code: the Angel master's token for a BSE
  // equity is the BSE scrip code (e.g. RELIANCE -> 500325), which is exactly the
  // numeric prefix of the catalog's Yahoo-style ticker (500325.BO).
  return exchange === 'BSE' ? `bse:code:${value}` : `nse:eq:${value}`;
}

/** Catalog ticker -> provider lookup key. Only shapes with a verified key exist. */
export function providerKeyForTicker(ticker: string): string | null {
  if (ticker.startsWith('^')) {
    const alias = INDEX_ALIASES[ticker];
    return alias ? keyFor(alias.exchange, 'INDEX', alias.symbol) : null;
  }
  const bse = /^(\d{1,12})\.BO$/.exec(ticker);
  if (bse) return keyFor('BSE', 'EQUITY', bse[1]);
  if (/^[A-Z0-9][A-Z0-9&-]{0,24}$/.test(ticker)) return keyFor('NSE', 'EQUITY', ticker);
  return null;
}

export function staticAngelMapping(ticker: string): AngelInstrument | undefined {
  const entry = SMARTAPI_TOKEN_MAP[ticker];
  if (!entry) return undefined;
  return {
    ticker,
    token: entry.token,
    exchange: entry.exchange,
    symbol: entry.symbol,
    kind: ticker.startsWith('^') ? 'INDEX' : 'EQUITY'
  };
}

function selectedRecord(record: Record<string, unknown>): Tuple | null {
  const exchange = record.exch_seg;
  if (exchange !== 'NSE' && exchange !== 'BSE') return null;
  const token = String(record.token ?? '').trim();
  const symbol = String(record.symbol ?? '').trim();
  if (!/^\d{1,12}$/.test(token) || !symbol) return null;
  if (record.instrumenttype === 'AMXIDX') return [symbol, token, exchange, symbol, 'INDEX'];
  if (exchange === 'NSE' && symbol.endsWith('-EQ')) {
    const ticker = symbol.slice(0, -3);
    if (!/^[A-Z0-9][A-Z0-9&-]{0,24}$/.test(ticker)) return null;
    return [ticker, token, 'NSE', symbol, 'EQUITY'];
  }
  // BSE cash equities carry no suffix and no instrumenttype; their token is the
  // BSE scrip code. Anything else (futures, options, debt) is never retained.
  if (exchange === 'BSE' && !record.instrumenttype && !symbol.endsWith('-EQ') && /^[A-Z0-9][A-Z0-9&-]{0,24}$/.test(symbol)) {
    return [symbol, token, 'BSE', symbol, 'EQUITY'];
  }
  return null;
}

/**
 * Streaming scan of the flat JSON array so a 40 MB master never becomes a 200 MB
 * heap object on the 512 MB free instance. Retains NSE -EQ equities, NSE indices,
 * BSE cash equities (by scrip code) and BSE indices.
 */
export function collectInstruments(text: string): Tuple[] {
  const out: Tuple[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (char === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const tuple = selectedRecord(JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>);
          if (tuple) out.push(tuple);
        } catch { /* malformed record: skip, never guess */ }
        if (out.length > MAX_MASTER_RECORDS) throw new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel instrument master exceeded the record cap');
        start = -1;
      }
    }
  }
  return out;
}

/** NSE-only view kept for existing callers and tests. */
export function collectNseInstruments(text: string): Tuple[] {
  return collectInstruments(text).filter(tuple => tuple[2] === 'NSE');
}

function buildMap(tuples: Tuple[]): Map<string, AngelInstrument> {
  const map = new Map<string, AngelInstrument>();
  for (const [ticker, token, exchange, symbol, kind] of tuples) {
    const value = kind === 'INDEX' ? symbol : exchange === 'BSE' ? token : ticker;
    map.set(keyFor(exchange, kind, value), { ticker, token, exchange, symbol, kind });
  }
  return map;
}

async function readCached(directory: string, now: number): Promise<{ map: Map<string, AngelInstrument>; downloadedAt: string; source: string } | null> {
  try {
    const raw = await fs.readFile(path.join(directory, CACHE_FILE), 'utf8');
    if (raw.length > MAX_MASTER_BYTES) return null;
    const parsed = JSON.parse(raw) as MasterCache;
    if (parsed?.version !== 2 || !Array.isArray(parsed.symbols) || typeof parsed.downloadedAt !== 'string') return null;
    if (istDay(Date.parse(parsed.downloadedAt)) !== istDay(now)) return null;
    const tuples: Tuple[] = [];
    for (const tuple of parsed.symbols.slice(0, MAX_MASTER_RECORDS)) {
      if (!Array.isArray(tuple) || tuple.length !== 5) continue;
      const [ticker, token, exchange, symbol, kind] = tuple;
      if (typeof ticker !== 'string' || typeof token !== 'string' || (exchange !== 'NSE' && exchange !== 'BSE') || (kind !== 'EQUITY' && kind !== 'INDEX')) continue;
      tuples.push([ticker, String(token), exchange, String(symbol), kind]);
    }
    const map = buildMap(tuples);
    return map.size ? { map, downloadedAt: parsed.downloadedAt, source: parsed.source } : null;
  } catch {
    return null;
  }
}

async function downloadMaster(directory: string, fetcher: typeof fetch, now: number): Promise<{ map: Map<string, AngelInstrument>; downloadedAt: string; source: string }> {
  let lastError: unknown = null;
  for (const url of MASTER_URLS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MASTER_TIMEOUT_MS);
    try {
      const response = await fetcher(url, { redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'Stragy-Research/2.0 (owner broker entitlement)' } });
      if (!response.ok) throw new MarketDataError('PROVIDER_UNAVAILABLE', `Angel instrument master returned HTTP ${response.status}`);
      if (Number(response.headers.get('content-length')) > MAX_MASTER_BYTES) throw new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel instrument master exceeds the byte cap');
      if (!response.body) throw new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel instrument master was empty');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];
      let size = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_MASTER_BYTES) { await reader.cancel().catch(() => undefined); throw new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel instrument master exceeds the byte cap'); }
        chunks.push(decoder.decode(part.value, { stream: true }));
      }
      chunks.push(decoder.decode());
      const tuples = collectInstruments(chunks.join(''));
      if (tuples.length < 1_000) throw new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel instrument master contained too few NSE/BSE instruments');
      const map = buildMap(tuples);
      const downloadedAt = new Date(now).toISOString();
      const cache: MasterCache = { version: 2, downloadedAt, source: url, count: map.size, symbols: tuples };
      await fs.mkdir(directory, { recursive: true }).catch(() => undefined);
      await fs.writeFile(path.join(directory, CACHE_FILE), JSON.stringify(cache)).catch(() => undefined);
      return { map, downloadedAt, source: url };
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof MarketDataError ? lastError : new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel instrument master download failed');
}

function masterDirectory(options: { cacheDirectory?: string }): string {
  return options.cacheDirectory ?? path.join(process.cwd(), '.cache');
}

export interface AngelMasterOptions { cacheDirectory?: string; fetch?: typeof fetch; now?: () => number }

async function ensureMaster(options: AngelMasterOptions, signal?: AbortSignal): Promise<void> {
  const now = options.now?.() ?? Date.now();
  if (master && istDay(Date.parse(master.downloadedAt)) === istDay(now)) return;
  if (lastFailure && now - lastFailure.at < RETRY_AFTER_FAILURE_MS && !master) throw new MarketDataError('PROVIDER_UNAVAILABLE', lastFailure.message);
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const directory = masterDirectory(options);
    const cached = await readCached(directory, now);
    if (cached) { master = cached; return; }
    try {
      master = await downloadMaster(directory, options.fetch ?? fetch, now);
      lastFailure = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Angel instrument master download failed';
      lastFailure = { at: now, message };
      if (master) return; // an older same-process master still fails closed for unknown tickers
      throw new MarketDataError('PROVIDER_UNAVAILABLE', message);
    }
  })();
  try {
    if (signal) {
      const aborted = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel mapping aborted')), { once: true }));
      await Promise.race([loadPromise, aborted]);
    } else {
      await loadPromise;
    }
  } finally {
    loadPromise = null;
  }
}

/** Boot-time preload so the first scan never pays the 40 MB master download. Best effort. */
export async function warmAngelInstrumentMaster(options: AngelMasterOptions = {}): Promise<AngelMasterInfo> {
  await ensureMaster(options);
  return getAngelMasterInfo();
}

/**
 * Static verified map first; otherwise the once-per-day instrument master.
 * Missing mappings throw UNKNOWN_MAPPING and are never guessed.
 */
export async function resolveAngelInstrument(
  ticker: string,
  options: AngelMasterOptions & { signal?: AbortSignal } = {}
): Promise<AngelInstrument> {
  const verified = staticAngelMapping(ticker);
  if (verified) return verified;
  const key = providerKeyForTicker(ticker);
  if (!key) throw new MarketDataError('UNKNOWN_MAPPING', `No verified Angel One instrument for ${ticker}; the catalog ticker has no registered provider shape`);
  await ensureMaster(options, options.signal);
  const found = master?.map.get(key);
  if (!found) {
    const where = ticker.startsWith('^')
      ? `the ${INDEX_ALIASES[ticker].exchange} index segment of today's instrument master`
      : ticker.endsWith('.BO')
        ? "the BSE cash segment of today's instrument master"
        : "today's NSE instrument master";
    throw new MarketDataError('UNKNOWN_MAPPING', `No verified Angel One token for ${ticker} in ${where}`);
  }
  return { ...found, ticker };
}

/** Synchronous view for routes/status; never triggers a download. */
export function getAngelMasterInfo(): AngelMasterInfo {
  if (!master) return { source: 'STATIC', size: Object.keys(SMARTAPI_TOKEN_MAP).length, downloadedAt: null, warnings: ['Instrument master not loaded; only verified static tokens are mappable'] };
  return {
    source: 'MASTER',
    size: master.map.size,
    downloadedAt: master.downloadedAt,
    warnings: [],
    exchanges: [...new Set([...master.map.values()].map(instrument => instrument.exchange))]
  };
}

/** Test seam. */
export function resetAngelInstrumentCache(): void {
  master = null;
  loadPromise = null;
  lastFailure = null;
}
