import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';

export const LIVE_QUOTE_POLL_MS = 15_000;
export const MAX_LIVE_QUOTE_SYMBOLS = 10;
const STATUS_SYMBOL_ID = 1;

export type LiveQuoteDelay = 'live' | 'unknown';

export interface LiveQuote {
  symbolId: number;
  ticker: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  changePercent: number;
  exchangeTimestamp: string | null;
  fetchedAt: string;
  source: 'ANGEL_SMARTAPI';
  delay: LiveQuoteDelay;
}

export interface LiveQuotesSnapshot {
  quotes: LiveQuote[];
  configured: boolean;
  available: boolean;
  connected: boolean;
  reason: string | null;
  fetchedAt: string | null;
  source: 'ANGEL_SMARTAPI' | null;
}

export interface LiveQuotesHookState extends LiveQuotesSnapshot {
  loading: boolean;
}

export interface LiveQuoteStatus {
  connected: boolean;
  provider: 'angel' | null;
  fetchedAt: string | null;
  /**
   * True only while the very first quote check is in flight. Once any result
   * arrives (success or failure) the footer keeps its settled label; later polls
   * never flip it back to a checking state.
   */
  loading: boolean;
}

const quoteSchema = z.object({
  symbolId: z.number().int().positive(),
  ticker: z.string().min(1),
  ltp: z.number().finite(),
  open: z.number().finite(),
  high: z.number().finite(),
  low: z.number().finite(),
  close: z.number().finite(),
  changePercent: z.number().finite(),
  exchangeTimestamp: z.string().nullable(),
  fetchedAt: z.string().min(1),
  source: z.literal('ANGEL_SMARTAPI'),
  delay: z.enum(['live', 'unknown']),
}).passthrough();

const responseSchema = z.object({
  source: z.literal('ANGEL_SMARTAPI'),
  available: z.boolean(),
  delay: z.enum(['live', 'unknown']),
  fetchedAt: z.string().min(1),
  configured: z.boolean(),
  quotes: z.array(quoteSchema).max(MAX_LIVE_QUOTE_SYMBOLS),
  reason: z.object({ code: z.string(), message: z.string() }).optional(),
}).passthrough();

const emptySnapshot = (reason: string | null = null): LiveQuotesSnapshot => ({
  quotes: [],
  configured: false,
  available: false,
  connected: false,
  reason,
  fetchedAt: null,
  source: null,
});

/** Dedupe, validate and bound quote ids before they reach the API. */
export function normalizeQuoteSymbolIds(symbolIds: number[]): number[] {
  const unique: number[] = [];
  for (const id of symbolIds) {
    if (!Number.isSafeInteger(id) || id <= 0 || unique.includes(id)) continue;
    unique.push(id);
    if (unique.length >= MAX_LIVE_QUOTE_SYMBOLS) break;
  }
  return unique;
}

/**
 * Fetch broker quotes without throwing. Not configured, HTTP failures,
 * malformed responses and cancellation all resolve to an unavailable snapshot.
 */
export async function fetchLiveQuotes(symbolIds: number[], signal?: AbortSignal): Promise<LiveQuotesSnapshot> {
  const ids = normalizeQuoteSymbolIds(symbolIds);
  if (!ids.length) return emptySnapshot('No symbols requested for live quotes.');
  try {
    const response = await fetch('/api/v2/quotes?symbolIds=' + ids.join(','), {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return emptySnapshot('Live quotes request failed (' + response.status + ').');
    let raw: unknown;
    try { raw = await response.json(); }
    catch { return emptySnapshot('Live quotes response was not valid JSON.'); }
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success) return emptySnapshot('Live quotes response was invalid.');
    const quotes = parsed.data.quotes.filter(quote => ids.includes(quote.symbolId));
    const connected = parsed.data.configured && parsed.data.available && quotes.length > 0;
    return {
      quotes,
      configured: parsed.data.configured,
      available: parsed.data.available,
      connected,
      reason: parsed.data.reason?.message ?? (parsed.data.configured ? null : 'Live quotes are not configured.'),
      fetchedAt: parsed.data.fetchedAt,
      source: parsed.data.source,
    };
  } catch (error) {
    if (signal?.aborted) return emptySnapshot('Live quotes request was cancelled.');
    return emptySnapshot(error instanceof Error ? error.message : 'Live quotes are unavailable.');
  }
}

const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/**
 * Poll quotes every 15 s only while the tab is visible. Hidden tabs stop both
 * the timer and any in-flight request; becoming visible refreshes immediately.
 */
export function useLiveQuotes(symbolIds: number[], options: { enabled?: boolean; pollMs?: number } = {}): LiveQuotesHookState {
  const enabled = options.enabled ?? true;
  const pollMs = options.pollMs ?? LIVE_QUOTE_POLL_MS;
  const idsKey = normalizeQuoteSymbolIds(symbolIds).join(',');
  const ids = useMemo(() => idsKey ? idsKey.split(',').map(Number) : [], [idsKey]);
  const [state, setState] = useState<LiveQuotesHookState>(() => ({ ...emptySnapshot(), loading: enabled && ids.length > 0 }));

  useEffect(() => {
    if (!enabled || !ids.length) {
      setState({ ...emptySnapshot(!enabled ? null : 'No symbols requested for live quotes.'), loading: false });
      return;
    }
    let cancelled = false;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const clearTimer = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
    const schedule = () => {
      clearTimer();
      if (cancelled) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (isVisible()) void load();
      }, pollMs);
    };
    const load = async () => {
      if (cancelled || !isVisible()) return;
      controller?.abort();
      controller = new AbortController();
      const owned = ++generation;
      setState(current => ({ ...current, loading: true }));
      const snapshot = await fetchLiveQuotes(ids, controller.signal);
      if (cancelled || owned !== generation) return;
      setState({ ...snapshot, loading: false });
      schedule();
    };
    const onVisibilityChange = () => {
      if (isVisible()) {
        clearTimer();
        void load();
      } else {
        generation++;
        controller?.abort();
        clearTimer();
        setState(current => ({ ...current, loading: false }));
      }
    };
    if (isVisible()) void load();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      generation++;
      clearTimer();
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, idsKey, pollMs]);

  return state;
}

/** The global footer only claims live quotes after an actual Angel quote arrives. */
export function useLiveQuoteStatus(enabled = true): LiveQuoteStatus {
  const state = useLiveQuotes([STATUS_SYMBOL_ID], { enabled });
  return {
    connected: state.connected && state.quotes.some(quote => quote.source === 'ANGEL_SMARTAPI'),
    provider: state.connected ? 'angel' : null,
    fetchedAt: state.fetchedAt,
    // Unknown, not "not live": the first request has not produced any result yet.
    loading: state.loading && state.fetchedAt === null && state.reason === null,
  };
}

export function formatLivePrice(value: number): string {
  return '₹' + value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatLiveChange(value: number): string {
  return (value >= 0 ? '+' : '') + value.toFixed(2) + '%';
}

/** Exchange time where provided, otherwise the broker fetch time (never a delayed close). */
export function liveQuoteTime(quote: Pick<LiveQuote, 'exchangeTimestamp' | 'fetchedAt'>): string {
  const stamp = quote.exchangeTimestamp ?? quote.fetchedAt;
  const time = new Date(stamp);
  if (!Number.isFinite(time.getTime())) return 'time unavailable';
  return time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) + ' IST';
}

export function liveQuoteTimeTitle(quote: Pick<LiveQuote, 'exchangeTimestamp' | 'fetchedAt' | 'delay'>): string {
  const source = quote.exchangeTimestamp
    ? 'Exchange timestamp from Angel One SmartAPI.'
    : 'No exchange timestamp; showing the Angel One fetch time.';
  return source + (quote.delay === 'unknown' ? ' Quote freshness is unverified.' : '');
}
