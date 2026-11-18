import type { OHLCVBar } from '../../shared/strategy/types';
import { threadId } from 'node:worker_threads';
import { getSymbolById } from './symbols';
import { MarketDataError, type MarketCacheEvidence, type MarketProvider, type ProviderObservation } from './marketSeries';
import { getAngelCandles, type AngelCandle } from './angelClient';
import { resolveAngelInstrument } from './angelSymbols';
import {
  acquireFetchLease,
  getCandleCoverage,
  markCandleFetch,
  readCandles,
  recordCacheEvent,
  recordMarketFetch,
  releaseFetchLease,
  upsertCandles,
  type CandleCoverage
} from './candleStore';

const IST_OFFSET_MS = 19_800_000;
const SESSION_CLOSE_MINUTES = 15 * 60 + 30;
const COLD_HISTORY_DAYS = 1_100;
const DAY_MS = 86_400_000;
const MAX_BARS = 5_000;
const OVERLAP_TRADING_DAYS = 2;
const SHARED_FETCH_WAIT_MS = 3_000;

/** Angel candles include the in-progress session; the research pipeline only accepts
 * completed sessions. Mirror the Yahoo rule: drop today until 15:30 IST. */
export function completedAngelBars(candles: AngelCandle[], now: number = Date.now()): { bars: OHLCVBar[]; skipped: number; incomplete: number; truncated: number } {
  const ist = new Date(now + IST_OFFSET_MS);
  const today = ist.toISOString().slice(0, 10);
  const afterClose = ist.getUTCHours() * 60 + ist.getUTCMinutes() >= SESSION_CLOSE_MINUTES;
  const byDate = new Map<string, OHLCVBar>();
  let skipped = 0;
  let incomplete = 0;
  for (const candle of candles) {
    if (candle.date > today || (candle.date === today && !afterClose)) { incomplete++; continue; }
    const { date, timestamp, open, high, low, close, volume } = candle;
    if (![open, high, low, close, volume].every(Number.isFinite) || Math.min(open, high, low, close) <= 0 || volume < 0 || high < Math.max(open, close) || low > Math.min(open, close) || low > high) {
      skipped++;
      continue;
    }
    byDate.set(date, { date, timestamp, open, high, low, close, volume });
  }
  const sorted = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const truncated = Math.max(0, sorted.length - MAX_BARS);
  return { bars: sorted.slice(-MAX_BARS), skipped, incomplete, truncated };
}

export interface LastCompletedSession {
  /** IST calendar date of the last completed weekday session. */
  date: string;
  /** UTC epoch milliseconds of that session's 15:30 IST close. */
  closeMs: number;
}

/** The refresh rule needs the session close, not just a 5-minute wall-clock TTL. */
export function lastCompletedSession(now: number = Date.now()): LastCompletedSession {
  const ist = new Date(now + IST_OFFSET_MS);
  let day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  if (ist.getUTCHours() * 60 + ist.getUTCMinutes() < SESSION_CLOSE_MINUTES) day -= DAY_MS;
  let date = new Date(day);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date = new Date(date.getTime() - DAY_MS);
  const value = date.toISOString().slice(0, 10);
  return { date: value, closeMs: Date.parse(value + 'T15:30:00+05:30') };
}

function istDate(at: number): string {
  return new Date(at + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function subtractTradingDays(date: string, count: number): string {
  let cursor = Date.parse(date + 'T00:00:00Z');
  let remaining = Math.max(0, count);
  while (remaining > 0) {
    cursor -= DAY_MS;
    const day = new Date(cursor).getUTCDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return new Date(cursor).toISOString().slice(0, 10);
}

function requestDate(date: string): Date {
  return new Date(date + 'T00:00:00+05:30');
}

function isCoverageFresh(coverage: CandleCoverage | null, session: LastCompletedSession): boolean {
  if (!coverage || coverage.bars < 1 || !coverage.lastDate || !coverage.fetchedAt) return false;
  const checked = coverage.checkedThrough ?? coverage.lastDate;
  if (!checked || checked < session.date) return false;
  // A symbol that has returned no bar for more than a week is not silently
  // treated as fresh forever; the next load checks the provider again.
  if (coverage.lastDate < subtractTradingDays(session.date, 5)) return false;
  const fetched = Date.parse(coverage.fetchedAt);
  return Number.isFinite(fetched) && fetched >= session.closeMs;
}

export function angelEvidence(bars: OHLCVBar[], token: string, now: number, skipped: number, incomplete: number, exchange: 'NSE' | 'BSE' = 'NSE', cache?: MarketCacheEvidence): ProviderObservation['evidence'] {
  const today = new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
  const latest = bars[bars.length - 1];
  return {
    source: 'ANGEL_SMARTAPI',
    providerSymbol: `${exchange}:${token}`,
    exchangeTimezone: 'Asia/Kolkata',
    providerMarketTime: new Date(latest.timestamp).toISOString(),
    adjustment: `Unadjusted ${exchange} daily OHLCV from Angel One SmartAPI`,
    freshness: latest.date === today ? 'same-day-broker-close' : 'last-completed-session',
    calendarVersion: 'provider-observed-sessions',
    ...(cache ? { cache } : {}),
    warnings: [
      "Owner's Angel One SmartAPI entitlement; Angel One redistribution terms apply to any public display",
      'End-of-day daily bars only, not an exchange tick stream',
      ...(incomplete ? [`${incomplete} unfinished session row(s) omitted`] : []),
      ...(skipped ? [`${skipped} invalid row(s) omitted without synthesis`] : [])
    ]
  };
}

function mergeBars(existing: readonly OHLCVBar[], incoming: readonly OHLCVBar[]): OHLCVBar[] {
  const byDate = new Map<string, OHLCVBar>();
  for (const bar of existing) byDate.set(bar.date, bar);
  for (const bar of incoming) byDate.set(bar.date, bar);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_BARS);
}

function sleepUntil(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(abortError(signal)); return; }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort(): void { clearTimeout(timer); reject(abortError(signal)); }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(signal: AbortSignal): Error {
  const reason = (signal as AbortSignal & { reason?: unknown }).reason;
  return reason instanceof Error ? reason : new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel request was aborted');
}

export interface AngelProviderOptions {
  now?: () => number;
  cacheDirectory?: string;
  /** Test/opt-out seam. The production provider always uses the durable store. */
  cache?: boolean;
}

interface MemoryCandles {
  bars: OHLCVBar[];
  fetchedAt: string;
  coverage: CandleCoverage | null;
}

export function createAngelProvider(
  fetcher: typeof fetch = fetch,
  options: AngelProviderOptions = {}
): MarketProvider {
  const now = options.now ?? (() => Date.now());
  const cacheEnabled = options.cache !== false;
  const pending = new Map<number, Promise<ProviderObservation>>();
  const memory = new Map<number, MemoryCandles>();
  const leaseOwner = `${process.pid}:${threadId}:${Math.random().toString(36).slice(2, 10)}`;

  function safeCoverage(id: number): CandleCoverage | null {
    if (!cacheEnabled) return null;
    try { return getCandleCoverage(id); } catch { return null; }
  }

  function safeBars(id: number): OHLCVBar[] {
    if (!cacheEnabled) return [];
    try { return readCandles(id); } catch { return []; }
  }

  function count(kind: 'hits' | 'misses' | 'incremental_fetches'): void {
    if (!cacheEnabled) return;
    try { recordCacheEvent(kind); } catch { /* counters must never break a data load */ }
  }

  function servedFromCache(id: number, coverage: CandleCoverage, bars: OHLCVBar[], nowMs: number, incomplete: number, skipped: number): ProviderObservation {
    const token = (coverage.providerSymbol ?? 'NSE:').split(':')[1] || '';
    const exchange: 'NSE' | 'BSE' = coverage.providerSymbol?.startsWith('BSE:') ? 'BSE' : 'NSE';
    const cache: MarketCacheEvidence = {
      hit: true,
      incremental: false,
      candleRequests: 0,
      requestedFrom: null,
      requestedTo: null,
      changedBars: 0,
      firstDate: coverage.firstDate ?? bars[0]?.date ?? null,
      lastDate: coverage.lastDate ?? bars.at(-1)?.date ?? null,
      bars: coverage.bars || bars.length,
      lastFetchAt: coverage.fetchedAt
    };
    const evidence = angelEvidence(bars, token, nowMs, skipped, incomplete, exchange, cache);
    evidence.warnings.push('Served from the local daily-candle cache; zero provider candle requests were made');
    return { bars, evidence, fetchedAt: coverage.fetchedAt ?? new Date(nowMs).toISOString() };
  }

  async function waitForSharedFetch(id: number, session: LastCompletedSession, signal: AbortSignal): Promise<ProviderObservation | null> {
    const deadline = Date.now() + SHARED_FETCH_WAIT_MS;
    while (Date.now() < deadline) {
      await sleepUntil(200, signal);
      const coverage = safeCoverage(id);
      if (coverage && isCoverageFresh(coverage, session)) {
        const bars = safeBars(id);
        if (bars.length) return servedFromCache(id, coverage, bars, now(), 0, 0);
      }
    }
    return null;
  }

  async function performLoad(id: number, signal: AbortSignal): Promise<ProviderObservation> {
    const symbol = getSymbolById(id);
    const nowMs = now();
    const session = lastCompletedSession(nowMs);
    const coverageBefore = safeCoverage(id);

    if (coverageBefore && isCoverageFresh(coverageBefore, session)) {
      const cached = safeBars(id);
      if (cached.length) {
        count('hits');
        const observation = servedFromCache(id, coverageBefore, cached, nowMs, 0, 0);
        memory.set(id, { bars: cached, fetchedAt: observation.fetchedAt ?? new Date(nowMs).toISOString(), coverage: coverageBefore });
        return observation;
      }
    }

    let ownsLease = false;
    if (cacheEnabled) {
      try {
        ownsLease = acquireFetchLease(id, leaseOwner, 60_000);
      } catch { ownsLease = false; }
      if (!ownsLease) {
        const shared = await waitForSharedFetch(id, session, signal);
        if (shared) {
          count('hits');
          memory.set(id, { bars: shared.bars, fetchedAt: shared.fetchedAt ?? new Date(nowMs).toISOString(), coverage: safeCoverage(id) });
          return shared;
        }
      }
    }

    try {
      signal.throwIfAborted();
      const instrument = await resolveAngelInstrument(symbol.ticker, { fetch: fetcher, cacheDirectory: options.cacheDirectory, now, signal });
      signal.throwIfAborted();
      const incremental = !!(coverageBefore && coverageBefore.bars > 0 && coverageBefore.lastDate);
      const fromDate = incremental
        ? subtractTradingDays(coverageBefore!.lastDate!, OVERLAP_TRADING_DAYS)
        : istDate(now() - COLD_HISTORY_DAYS * DAY_MS);
      const at = now();
      const candles = await getAngelCandles(
        { exchange: instrument.exchange, symbolToken: instrument.token, interval: 'ONE_DAY', fromDate: requestDate(fromDate), toDate: new Date(at) },
        // Wait out a rate-limit window, but never past the provider deadline.
        { signal, fetch: fetcher, retryDeadlineAt: Date.now() + 35_000 }
      );
      const parsed = completedAngelBars(candles, at);
      const previous = memory.get(id);
      let cacheWarning: string | null = null;
      let written = 0;
      let skipped = parsed.skipped;
      const fetchedAt = new Date(now()).toISOString();

      if (cacheEnabled) {
        try {
          const result = upsertCandles(id, parsed.bars, 'ANGEL_SMARTAPI', fetchedAt);
          written = result.written;
          skipped += result.skipped;
          markCandleFetch(id, 'ANGEL_SMARTAPI', session.date, fetchedAt, `${instrument.exchange}:${instrument.token}`);
          recordMarketFetch(fetchedAt);
          count(incremental ? 'incremental_fetches' : 'misses');
        } catch (error) {
          cacheWarning = 'Local candle cache write failed; this response kept in memory only (' + (error instanceof Error ? error.message : 'unknown error') + ')';
        }
      }

      // The DB is authoritative, but the freshly returned bars are merged in as
      // well so a failed cache write can never drop the tail of this response.
      let bars = mergeBars(mergeBars(previous?.bars ?? [], cacheEnabled ? safeBars(id) : []), parsed.bars);
      if (!bars.length) throw new MarketDataError('PROVIDER_UNAVAILABLE', 'Angel One returned no completed daily bars');
      if (bars.length > MAX_BARS) bars = bars.slice(-MAX_BARS);

      const finalCoverage = safeCoverage(id);
      const cache: MarketCacheEvidence = {
        hit: false,
        incremental,
        candleRequests: 1,
        requestedFrom: fromDate,
        requestedTo: istDate(at),
        changedBars: parsed.bars.length,
        firstDate: finalCoverage?.firstDate ?? bars[0]?.date ?? null,
        lastDate: finalCoverage?.lastDate ?? bars.at(-1)?.date ?? null,
        bars: finalCoverage?.bars || bars.length,
        lastFetchAt: finalCoverage?.fetchedAt ?? fetchedAt
      };
      const evidence = angelEvidence(bars, instrument.token, at, skipped, parsed.incomplete, instrument.exchange, cache);
      evidence.warnings.push(incremental
        ? `Incremental refresh ${fromDate}..${session.date}; ${parsed.bars.length} provider bar(s), ${written} upserted; ${coverageBefore?.bars ?? 0} covered bar(s) retained`
        : `Cold load: one ${COLD_HISTORY_DAYS}-day request; ${written} bar(s) stored in the local candle cache`);
      if (incremental && parsed.bars.length === 0) {
        evidence.warnings.push(`Angel returned no completed bar after ${coverageBefore?.lastDate}; cached history was kept`);
      }
      if (!incremental && parsed.bars.length) {
        const gapDays = Math.round((Date.parse(parsed.bars[0].date) - Date.parse(fromDate)) / DAY_MS);
        if (gapDays > 10) {
          evidence.warnings.push(`Provider history begins at ${parsed.bars[0].date} (requested from ${fromDate}); older bars are unavailable and were not synthesized`);
        }
      }
      if (parsed.truncated) {
        evidence.warnings.push(`${parsed.truncated} older bar(s) beyond the ${MAX_BARS}-bar response window omitted; stored history is retained`);
      }
      if (cacheWarning) evidence.warnings.push(cacheWarning);
      memory.set(id, { bars, fetchedAt, coverage: finalCoverage });
      return { bars, evidence, fetchedAt };
    } finally {
      if (ownsLease) {
        try { releaseFetchLease(id, leaseOwner); } catch { /* lease expires on its own */ }
      }
    }
  }

  return {
    name: 'ANGEL_SMARTAPI',
    // The first load may fetch the ~39 MB instrument master before requesting candles.
    deadlineMs: 45_000,
    load(id, signal) {
      signal.throwIfAborted();
      const existing = pending.get(id);
      if (existing) return waitFor(existing, signal);
      const task = performLoad(id, signal);
      pending.set(id, task);
      return waitFor(task, signal).finally(() => {
        if (pending.get(id) === task) pending.delete(id);
      });
    }
  };
}

/** Never aborts the shared provider load: only this caller stops waiting. */
function waitFor(task: Promise<ProviderObservation>, signal?: AbortSignal): Promise<ProviderObservation> {
  if (!signal) return task;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<ProviderObservation>((resolve, reject) => {
    const onAbort = (): void => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    task.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); }
    );
  });
}
