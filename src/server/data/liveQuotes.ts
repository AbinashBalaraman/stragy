import { MarketDataError } from './marketSeries';
import { getSymbolById } from './symbols';
import { getAngelQuotes, isAngelConfigured, type AngelRawQuote } from './angelClient';
import { resolveAngelInstrument } from './angelSymbols';

// Live broker quotes only. There is deliberately no Yahoo fallback: delayed closes
// must never be relabelled as live.
export const LIVE_QUOTES_SOURCE = 'ANGEL_SMARTAPI' as const;
export const MAX_LIVE_QUOTE_SYMBOLS = 10;
const CACHE_TTL_MS = 10_000;
const LIVE_FRESHNESS_MS = 15 * 60_000;

export type LiveQuoteDelay = 'live' | 'unknown';

export interface LiveQuote {
  symbolId: number;
  ticker: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  /** Previous session close, as reported by the broker. */
  close: number;
  changePercent: number;
  exchangeTimestamp: string | null;
  fetchedAt: string;
  source: typeof LIVE_QUOTES_SOURCE;
  delay: LiveQuoteDelay;
}

export interface LiveQuoteUnavailable {
  symbolId: number;
  ticker: string;
  code: string;
  message: string;
}

export interface LiveQuotesResult {
  source: typeof LIVE_QUOTES_SOURCE;
  available: boolean;
  delay: LiveQuoteDelay;
  fetchedAt: string;
  cached: boolean;
  configured: boolean;
  quotes: LiveQuote[];
  unavailable: LiveQuoteUnavailable[];
  reason?: { code: string; message: string };
}

interface CacheEntry { at: number; result: LiveQuotesResult }
const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<LiveQuotesResult>>();
let nowImpl: () => number = () => Date.now();

/** Test seam. */
export function configureLiveQuotesClock(now?: () => number): void {
  nowImpl = now ?? (() => Date.now());
  cache.clear();
  pending.clear();
}

/** Test/ops seam. */
export function clearLiveQuoteCache(): void {
  cache.clear();
  pending.clear();
}

function delayFor(exchangeTimestamp: string | null, now: number): LiveQuoteDelay {
  if (!exchangeTimestamp) return 'unknown';
  const at = Date.parse(exchangeTimestamp);
  if (!Number.isFinite(at)) return 'unknown';
  const age = now - at;
  return age >= -5 * 60_000 && age <= LIVE_FRESHNESS_MS ? 'live' : 'unknown';
}

export function quotesUnavailable(symbolIds: number[], code: string, message: string, now = nowImpl()): LiveQuotesResult {
  return {
    source: LIVE_QUOTES_SOURCE,
    available: false,
    delay: 'unknown',
    fetchedAt: new Date(now).toISOString(),
    cached: false,
    configured: isAngelConfigured(),
    quotes: [],
    unavailable: symbolIds.map(symbolId => {
      let ticker = `#${symbolId}`;
      try { ticker = getSymbolById(symbolId).ticker; } catch { /* unknown ids stay numeric */ }
      return { symbolId, ticker, code, message };
    }),
    reason: { code, message }
  };
}

function validateIds(symbolIds: number[]): number[] {
  if (!Array.isArray(symbolIds) || !symbolIds.length) throw new MarketDataError('INVALID_REQUEST', 'At least one symbol id is required');
  if (symbolIds.length > MAX_LIVE_QUOTE_SYMBOLS) throw new MarketDataError('INVALID_REQUEST', `At most ${MAX_LIVE_QUOTE_SYMBOLS} symbol ids are allowed`);
  const unique: number[] = [];
  for (const id of symbolIds) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new MarketDataError('INVALID_REQUEST', 'Symbol ids must be positive integers');
    if (!unique.includes(id)) unique.push(id);
  }
  return unique;
}

function toQuote(symbolId: number, ticker: string, raw: AngelRawQuote, fetchedAt: string, now: number): LiveQuote {
  return {
    symbolId,
    ticker,
    ltp: raw.ltp,
    open: raw.open,
    high: raw.high,
    low: raw.low,
    close: raw.close,
    changePercent: raw.percentChange,
    exchangeTimestamp: raw.exchangeTime,
    fetchedAt,
    source: LIVE_QUOTES_SOURCE,
    delay: delayFor(raw.exchangeTime, now)
  };
}

/**
 * Live quotes for at most 10 catalog symbols. Results are cached for 10 s and
 * concurrent identical requests share one broker call. Missing token mappings fail
 * closed per symbol; the caller never receives a guessed instrument.
 */
export async function getLiveQuotes(
  symbolIds: number[],
  options: { signal?: AbortSignal; fetch?: typeof fetch; cacheDirectory?: string } = {}
): Promise<LiveQuotesResult> {
  const ids = validateIds(symbolIds);
  if ((process.env.QUOTES_PROVIDER ?? 'none') !== 'angel') {
    return quotesUnavailable(ids, 'PROVIDER_UNAVAILABLE', 'Live quotes are not configured; set QUOTES_PROVIDER=angel with Angel One credentials');
  }
  if (!isAngelConfigured()) {
    return quotesUnavailable(ids, 'PROVIDER_AUTH_FAILED', 'Angel One is not configured; set ANGEL_API_KEY, ANGEL_CLIENT_CODE, ANGEL_PASSWORD and ANGEL_TOTP_SECRET (or SMARTAPI_* aliases)');
  }
  const key = ids.join(',');
  const hit = cache.get(key);
  const now = nowImpl();
  if (hit && now - hit.at < CACHE_TTL_MS) return { ...hit.result, cached: true };
  const inflight = pending.get(key);
  if (inflight) return inflight;

  const work = (async (): Promise<LiveQuotesResult> => {
    const at = nowImpl();
    const fetchedAt = new Date(at).toISOString();
    const resolved: { symbolId: number; ticker: string; token: string }[] = [];
    const unavailable: LiveQuoteUnavailable[] = [];
    for (const symbolId of ids) {
      const symbol = getSymbolById(symbolId);
      try {
        options.signal?.throwIfAborted();
        const instrument = await resolveAngelInstrument(symbol.ticker, { signal: options.signal, fetch: options.fetch, cacheDirectory: options.cacheDirectory, now: nowImpl });
        resolved.push({ symbolId, ticker: symbol.ticker, token: instrument.token });
      } catch (error) {
        const code = error instanceof MarketDataError ? error.code : 'UNKNOWN_MAPPING';
        unavailable.push({ symbolId, ticker: symbol.ticker, code, message: `No verified Angel One token for ${symbol.ticker}` });
      }
    }
    if (!resolved.length) {
      const result: LiveQuotesResult = {
        source: LIVE_QUOTES_SOURCE,
        available: false,
        delay: 'unknown',
        fetchedAt,
        cached: false,
        configured: true,
        quotes: [],
        unavailable,
        reason: { code: 'UNKNOWN_MAPPING', message: 'None of the requested symbols has a verified Angel One token' }
      };
      cache.set(key, { at, result });
      return result;
    }
    const raw = await getAngelQuotes([{ exchange: 'NSE', tokens: resolved.map(r => r.token) }], { signal: options.signal, fetch: options.fetch });
    const byToken = new Map<string, AngelRawQuote>();
    for (const quote of raw) byToken.set(quote.symbolToken, quote);
    const quotes: LiveQuote[] = [];
    for (const item of resolved) {
      const match = byToken.get(item.token);
      if (!match) {
        unavailable.push({ symbolId: item.symbolId, ticker: item.ticker, code: 'PROVIDER_UNAVAILABLE', message: `Angel One returned no quote for ${item.ticker}` });
        continue;
      }
      quotes.push(toQuote(item.symbolId, item.ticker, match, fetchedAt, at));
    }
    const result: LiveQuotesResult = {
      source: LIVE_QUOTES_SOURCE,
      available: quotes.length > 0,
      delay: quotes.length > 0 && quotes.every(q => q.delay === 'live') ? 'live' : 'unknown',
      fetchedAt,
      cached: false,
      configured: true,
      quotes,
      unavailable
    };
    cache.set(key, { at, result });
    while (cache.size > 64) cache.delete(cache.keys().next().value!);
    return result;
  })();

  pending.set(key, work);
  try {
    return await work;
  } finally {
    if (pending.get(key) === work) pending.delete(key);
  }
}
