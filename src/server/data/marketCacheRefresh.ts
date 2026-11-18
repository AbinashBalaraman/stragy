import { randomUUID } from 'node:crypto';
import { loadMarketSeries, MarketDataError } from './marketSeries';
import { resolveObservedUniverse } from './observedUniverse';
import { getSymbolById } from './symbols';

/**
 * Background, cache-first warm-up for the market data store.
 *
 * This deliberately does NOT run a strategy or a scan: it only asks
 * `loadMarketSeries` for each symbol, which downloads the missing tail and
 * writes it to the candle cache. A warm cache makes later scans and backtests
 * read the same bars without another Angel One request.
 *
 * The public start function is process-local and convenient for an HTTP 202;
 * the job worker calls `runMarketCacheRefresh` directly so it can report
 * progress and stop promptly on cancel.
 */

export interface CacheRefreshInput {
  universe?: string;
  symbolIds?: number[];
  /** Hard cap for a single request. */
  maxSymbols?: number;
}

export interface CacheRefreshError {
  symbolId: number;
  ticker: string;
  code: string;
  message: string;
}

export interface CacheRefreshState {
  id: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  universe: string | null;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  startedAt: string;
  finishedAt?: string;
  errors: CacheRefreshError[];
  /** Honest warning when the universe was capped. */
  warning?: string;
}

export interface CacheRefreshDependencies {
  loadSeries?: typeof loadMarketSeries;
  resolveUniverse?: typeof resolveObservedUniverse;
  getSymbol?: typeof getSymbolById;
  now?: () => number;
}

export interface CacheRefreshRunOptions {
  signal?: AbortSignal;
  onProgress?: (state: Readonly<CacheRefreshState>) => void;
  /** Stable id used by the caller that already published a running state. */
  id?: string;
}

const MAX_REFRESH_SYMBOLS = 500;
const states = new Map<string, CacheRefreshState>();
let activeId: string | null = null;

function boundedError(error: unknown): { code: string; message: string } {
  if (error instanceof MarketDataError) return { code: error.code, message: error.message.slice(0, 300) };
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'CACHE_REFRESH_FAILED', message: message.slice(0, 300) };
}

function abortError(signal: AbortSignal): Error {
  const reason = (signal as AbortSignal & { reason?: unknown }).reason;
  return reason instanceof Error ? reason : new MarketDataError('CACHE_REFRESH_CANCELLED', 'The cache refresh was cancelled.');
}

function prune(): void {
  // Keep a small bounded history so a long-lived server does not grow forever.
  if (states.size <= 20) return;
  for (const [id, state] of states) {
    if (state.status !== 'running' && id !== activeId) states.delete(id);
    if (states.size <= 20) break;
  }
}

function snapshot(state: CacheRefreshState): Readonly<CacheRefreshState> {
  return { ...state, errors: [...state.errors] };
}

/**
 * Run one warm-up to completion. Only one `startMarketCacheRefresh` may run at
 * a time, but the job worker can call this directly because the worker itself
 * is the single owner of its job.
 */
export async function runMarketCacheRefresh(
  input: CacheRefreshInput,
  deps: CacheRefreshDependencies = {},
  run: CacheRefreshRunOptions = {},
): Promise<CacheRefreshState> {
  const requestedCap = input.maxSymbols ?? MAX_REFRESH_SYMBOLS;
  const cap = Math.max(1, Math.min(Math.floor(Number.isFinite(requestedCap) ? requestedCap : MAX_REFRESH_SYMBOLS), MAX_REFRESH_SYMBOLS));
  const id = run.id ?? 'cache-' + randomUUID();
  const now = deps.now ?? (() => Date.now());
  const state: CacheRefreshState = {
    id,
    status: 'running',
    universe: input.universe ?? null,
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    startedAt: new Date(now()).toISOString(),
    errors: [],
  };
  states.set(id, state);
  try {
    let symbols: Array<{ id: number; ticker: string }>;
    if (input.symbolIds?.length) {
      const unique = [...new Set(input.symbolIds)];
      const missing = unique.filter(idValue => !Number.isSafeInteger(idValue) || idValue <= 0);
      if (missing.length) throw new MarketDataError('INVALID_SYMBOL', 'Symbol ids must be positive integers.');
      const getSymbol = deps.getSymbol ?? getSymbolById;
      symbols = unique.slice(0, cap).map(symbolId => {
        const symbol = getSymbol(symbolId);
        return { id: symbol.id, ticker: symbol.ticker };
      });
      if (unique.length > cap) state.warning = 'Refreshed the first ' + cap + ' of ' + unique.length + ' requested symbols.';
    } else {
      const resolveUniverse = deps.resolveUniverse ?? resolveObservedUniverse;
      const universe = input.universe?.trim() || 'NIFTY_50';
      const resolved = await resolveUniverse(universe);
      symbols = resolved.symbols.slice(0, cap).map(symbol => ({ id: symbol.id, ticker: symbol.ticker }));
      if (resolved.symbols.length > cap) {
        state.warning = 'Refreshed the first ' + cap + ' of ' + resolved.symbols.length + ' configured symbols; this is not full coverage.';
      }
    }
    state.total = symbols.length;
    run.onProgress?.(snapshot(state));
    if (!symbols.length) {
      state.status = 'failed';
      state.warning = state.warning ?? 'No symbols matched that universe.';
      state.finishedAt = new Date(now()).toISOString();
      return state;
    }
    const load = deps.loadSeries ?? loadMarketSeries;
    for (const symbol of symbols) {
      if (run.signal?.aborted) {
        state.status = 'cancelled';
        state.finishedAt = new Date(now()).toISOString();
        return state;
      }
      try {
        await load(symbol.id, { mode: 'real', signal: run.signal });
        state.succeeded += 1;
      } catch (error) {
        if (run.signal?.aborted) {
          state.status = 'cancelled';
          state.finishedAt = new Date(now()).toISOString();
          return state;
        }
        state.failed += 1;
        const typed = boundedError(error);
        state.errors.push({ symbolId: symbol.id, ticker: symbol.ticker, ...typed });
      } finally {
        state.processed += 1;
        run.onProgress?.(snapshot(state));
      }
    }
    state.status = 'done';
    state.finishedAt = new Date(now()).toISOString();
    return state;
  } catch (error) {
    state.status = run.signal?.aborted ? 'cancelled' : 'failed';
    if (!run.signal?.aborted) {
      const typed = boundedError(error);
      state.errors.push({ symbolId: 0, ticker: '', ...typed });
    }
    state.finishedAt = new Date(now()).toISOString();
    return state;
  } finally {
    if (activeId === id) activeId = null;
    prune();
  }
}

/**
 * Start one warm-up in the background. Only one may run at a time so two
 * callers cannot double the provider request load. Returns the existing state
 * when one is already running (`alreadyRunning: true`).
 */
export function startMarketCacheRefresh(
  input: CacheRefreshInput,
  deps: CacheRefreshDependencies = {},
): { state: CacheRefreshState; alreadyRunning: boolean } {
  if (activeId) {
    const state = states.get(activeId);
    if (state && state.status === 'running') return { state: snapshot(state) as CacheRefreshState, alreadyRunning: true };
  }
  const id = 'cache-' + randomUUID();
  // Reserve the active slot before the async body yields, so a second caller
  // cannot start a duplicate.
  const placeholder: CacheRefreshState = {
    id,
    status: 'running',
    universe: input.universe ?? null,
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    startedAt: new Date(deps.now?.() ?? Date.now()).toISOString(),
    errors: [],
  };
  states.set(id, placeholder);
  activeId = id;
  void runMarketCacheRefresh(input, deps, { id })
    .then(finalState => {
      // `runMarketCacheRefresh` keeps the map entry updated under the same id;
      // this assignment keeps the object returned synchronously useful too.
      Object.assign(placeholder, finalState);
    })
    .catch(error => {
      placeholder.status = 'failed';
      placeholder.errors.push({ symbolId: 0, ticker: '', ...boundedError(error) });
      placeholder.finishedAt = new Date(deps.now?.() ?? Date.now()).toISOString();
    })
    .finally(() => {
      if (activeId === id) activeId = null;
      prune();
    });
  return { state: snapshot(placeholder) as CacheRefreshState, alreadyRunning: false };
}

export function getMarketCacheRefresh(id: string): CacheRefreshState | null {
  return states.get(id) ?? null;
}

/** Test seam. */
export function resetMarketCacheRefreshForTests(): void {
  states.clear();
  activeId = null;
}
