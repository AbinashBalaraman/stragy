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

export type AngelInstrumentKind = 'EQUITY' | 'INDEX';
export interface AngelInstrument { ticker: string; token: string; exchange: 'NSE'; symbol: string; kind: AngelInstrumentKind }
export interface AngelMasterInfo { source: 'STATIC' | 'MASTER'; size: number; downloadedAt: string | null; warnings: string[] }

// Documented instrument master (docs/Instruments). Both hosts serve the same bytes;
// the .com host is the one referenced by the documentation.
const MASTER_URLS = [
  'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json',
  'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json'
] as const;
const CACHE_FILE = 'angel-scrip-master.json';
const MAX_MASTER_BYTES = 80_000_000;
const MAX_MASTER_RECORDS = 20_000;
const MASTER_TIMEOUT_MS = 60_000;
const RETRY_AFTER_FAILURE_MS = 10 * 60_000;

type Tuple = [ticker: string, token: string, symbol: string, kind: AngelInstrumentKind];
interface MasterCache { version: 1; downloadedAt: string; source: string; count: number; symbols: Tuple[] }

let master: { map: Map<string, AngelInstrument>; downloadedAt: string; source: string } | null = null;
let loadPromise: Promise<void> | null = null;
let lastFailure: { at: number; message: string } | null = null;

function istDay(now: number): string {
  return new Date(now + 19_800_000).toISOString().slice(0, 10);
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
  if (record.exch_seg !== 'NSE') return null;
  const token = String(record.token ?? '').trim();
  const symbol = String(record.symbol ?? '').trim();
  if (!/^\d{1,12}$/.test(token) || !symbol) return null;
  if (symbol.endsWith('-EQ')) {
    const ticker = symbol.slice(0, -3);
    if (!/^[A-Z0-9][A-Z0-9&-]{0,24}$/.test(ticker)) return null;
    return [ticker, token, symbol, 'EQUITY'];
  }
  if (record.instrumenttype === 'AMXIDX') return [symbol, token, symbol, 'INDEX'];
  return null;
}

/**
 * Streaming scan of the flat JSON array so a 40 MB master never becomes a 200 MB
 * heap object on the 512 MB free instance. Only NSE -EQ equities and NSE indices
 * are retained.
 */
export function collectNseInstruments(text: string): Tuple[] {
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

async function readCached(directory: string, now: number): Promise<{ map: Map<string, AngelInstrument>; downloadedAt: string; source: string } | null> {
  try {
    const raw = await fs.readFile(path.join(directory, CACHE_FILE), 'utf8');
    if (raw.length > MAX_MASTER_BYTES) return null;
    const parsed = JSON.parse(raw) as MasterCache;
    if (parsed?.version !== 1 || !Array.isArray(parsed.symbols) || typeof parsed.downloadedAt !== 'string') return null;
    if (istDay(Date.parse(parsed.downloadedAt)) !== istDay(now)) return null;
    const map = new Map<string, AngelInstrument>();
    for (const tuple of parsed.symbols.slice(0, MAX_MASTER_RECORDS)) {
      if (!Array.isArray(tuple) || tuple.length !== 4) continue;
      const [ticker, token, symbol, kind] = tuple;
      if (typeof ticker !== 'string' || typeof token !== 'string' || (kind !== 'EQUITY' && kind !== 'INDEX')) continue;
      map.set(kind === 'INDEX' ? `^${ticker.toUpperCase()}` : ticker, { ticker, token, exchange: 'NSE', symbol: String(symbol), kind });
    }
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
      const tuples = collectNseInstruments(chunks.join(''));
      if (tuples.length < 1_000) throw new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel instrument master contained too few NSE instruments');
      const map = new Map<string, AngelInstrument>();
      for (const [ticker, token, symbol, kind] of tuples) {
        map.set(kind === 'INDEX' ? `^${ticker.toUpperCase()}` : ticker, { ticker, token, exchange: 'NSE', symbol, kind });
      }
      const downloadedAt = new Date(now).toISOString();
      const cache: MasterCache = { version: 1, downloadedAt, source: url, count: map.size, symbols: [...map.values()].map(v => [v.kind === 'INDEX' ? v.symbol : v.ticker, v.token, v.symbol, v.kind]) };
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

async function ensureMaster(options: { cacheDirectory?: string; fetch?: typeof fetch; now?: () => number }, signal?: AbortSignal): Promise<void> {
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

/**
 * Static verified map first; otherwise the once-per-day instrument master.
 * Missing mappings throw UNKNOWN_MAPPING and are never guessed.
 */
export async function resolveAngelInstrument(
  ticker: string,
  options: { cacheDirectory?: string; fetch?: typeof fetch; now?: () => number; signal?: AbortSignal } = {}
): Promise<AngelInstrument> {
  const verified = staticAngelMapping(ticker);
  if (verified) return verified;
  if (ticker.startsWith('^')) {
    // BSE and sector indices have no verified NSE equity token; never guess.
    throw new MarketDataError('UNKNOWN_MAPPING', `No verified Angel One NSE token for index ${ticker}`);
  }
  await ensureMaster(options, options.signal);
  const found = master?.map.get(ticker);
  if (!found) throw new MarketDataError('UNKNOWN_MAPPING', `No verified Angel One NSE token for ${ticker}`);
  return found;
}

/** Synchronous view for routes/status; never triggers a download. */
export function getAngelMasterInfo(): AngelMasterInfo {
  return master
    ? { source: 'MASTER', size: master.map.size, downloadedAt: master.downloadedAt, warnings: [] }
    : { source: 'STATIC', size: Object.keys(SMARTAPI_TOKEN_MAP).length, downloadedAt: null, warnings: ['Instrument master not loaded; only verified static tokens are mappable'] };
}

/** Test seam. */
export function resetAngelInstrumentCache(): void {
  master = null;
  loadPromise = null;
  lastFailure = null;
}
