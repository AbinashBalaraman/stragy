import type { StockTrendData, MarketMoversData } from '../../shared/strategy/types';
import { UNIVERSE_OPTIONS, type MarketUniverseType } from '../data/symbols';
import { loadMarketSeries, MarketDataError, type DataMode } from '../data/marketSeries';
import { calculateStockTrends, calculateMarketMovers } from '../data/smartApi';
import { resolveObservedUniverse, configuredUniversePool, forEachMarketSymbol, BUNDLED_UNIVERSE_CAP, type ObservedUniverse } from '../data/observedUniverse';
import { tradingSessionsFromDates } from '../data/realMarketData';

export type MarketSnapshotStatus = 'complete' | 'partial' | 'unavailable';
export interface MarketSnapshotProgress { processed: number; total: number; stage: string }
export interface MarketSnapshotDeadline { budgetMs: number; reached: boolean; truncated: boolean; elapsedMs: number }
export interface MarketSnapshot {
  trends: StockTrendData[];
  movers?: MarketMoversData;
  errors: { symbolId: number; code: string; ticker?: string }[];
  provenance?: unknown;
  coverage: { requested: number; succeeded: number; unavailable: number };
  sourceCoverage: Record<string, number>;
  universe: string;
  requestedDate?: string;
  mode: DataMode;
  observationDates?: { earliest: string; latest: string; staleSymbols: number };
  membership?: Omit<ObservedUniverse, 'symbols'>;
  warnings?: string[];
  status?: MarketSnapshotStatus;
  /** Plain-language reason when status is 'unavailable'. */
  statusReason?: string;
  recommendations?: string[];
  retryable?: boolean;
  deadline?: MarketSnapshotDeadline;
  progress?: MarketSnapshotProgress;
}
export interface MarketSnapshotOptions { deadlineMs?: number; concurrency?: number; signal?: AbortSignal }

const BROAD_UNIVERSES = new Set(['NSE', 'BSE', 'ALL']);
const BROAD_DEADLINE_MS = 150_000;
const DEFAULT_DEADLINE_MS = 90_000;

/** A cold Nifty 50 snapshot is provider-paced at 2 req/s: 50 symbols never needs 4 minutes. */
export function marketSnapshotDeadlineMs(universe: string): number {
  return BROAD_UNIVERSES.has(universe) ? BROAD_DEADLINE_MS : DEFAULT_DEADLINE_MS;
}

function unavailableRecommendations(): string[] {
  return [
    'Retry once the provider rate-limit window has passed; nothing was fabricated.',
    'Check /api/smartapi/status for the instrument master and broker session.',
    'Select NIFTY 50 for the official observed constituent feed.'
  ];
}

/** Runs on the bounded computation worker, not the HTTP event loop. */
export async function buildMarketSnapshot(universe: string, date?: string, mode: DataMode = 'demo', onProgress?: (stage: string, progress?: MarketSnapshotProgress) => void, options: MarketSnapshotOptions = {}): Promise<MarketSnapshot> {
  if (!UNIVERSE_OPTIONS.some(u => u.id === universe)) throw new MarketDataError('INVALID_UNIVERSE', 'Unknown universe.');
  const startedAt = Date.now();
  const budgetMs = options.deadlineMs ?? marketSnapshotDeadlineMs(universe);
  const deadlineAt = startedAt + budgetMs;
  const controller = new AbortController();
  const external = options.signal;
  const relayAbort = () => controller.abort(external?.reason ?? new MarketDataError('SNAPSHOT_DEADLINE', 'Market snapshot deadline reached'));
  if (external?.aborted) relayAbort(); else external?.addEventListener('abort', relayAbort, { once: true });
  const membership = mode === 'real' ? await resolveObservedUniverse(universe) : undefined;
  const fallbackPool = configuredUniversePool(universe as MarketUniverseType);
  const fallbackCap = BUNDLED_UNIVERSE_CAP[universe as MarketUniverseType];
  const symbols = membership?.symbols ?? (typeof fallbackCap === 'number' ? fallbackPool.slice(0, fallbackCap) : fallbackPool);
  if (symbols.length > 2500) throw new MarketDataError('SCAN_BUDGET_EXCEEDED', 'Universe exceeds scan budget.');
  const unmapped = membership?.unmapped ?? [];
  const result: MarketSnapshot = { trends: [], errors: [], coverage: { requested: symbols.length + unmapped.length, succeeded: 0, unavailable: 0 }, sourceCoverage: {}, universe, requestedDate: date, mode };
  if (membership) {
    const { symbols: _, ...metadata } = membership;
    result.membership = metadata;
    result.warnings = [...membership.warnings];
    for (const missing of unmapped) result.errors.push({ symbolId: 0, ticker: missing.ticker, code: 'IDENTITY_UNVERIFIED' });
  }
  const finish = (stage: string): void => {
    result.trends.sort((a, b) => a.id - b.id);
    result.coverage.succeeded = result.trends.length;
    result.coverage.unavailable = result.errors.length;
    result.progress = { processed: symbols.length, total: symbols.length, stage };
    const refused = result.trends.length === 0;
    result.status = refused ? 'unavailable' : result.deadline?.truncated || result.errors.length ? 'partial' : 'complete';
    // Only a retry that can actually change the answer is advertised as retryable:
    // a provider outage or a deadline stop. Permanent unmapped tickers are not.
    result.retryable = result.status === 'unavailable' || Boolean(result.deadline?.truncated);
    if (refused) {
      const codes = [...new Set(result.errors.map(error => error.code))].slice(0, 4);
      result.statusReason = result.deadline?.truncated
        ? 'No symbol completed before the ' + Math.round(budgetMs / 1000) + ' s deadline. Nothing was fabricated; retry when the provider is responsive.'
        : 'No usable observations for ' + universe + (codes.length ? ' (' + codes.join(', ') + ')' : '') + '. This is not a zero-match market result.';
      result.recommendations = result.membership?.recommendations ?? unavailableRecommendations();
      result.warnings = [...(result.warnings ?? []), result.statusReason];
    }
    result.movers = calculateMarketMovers(result.trends, universe, result.trends[0]?.date ?? date, tradingSessionsFromDates([...observedDates], mode));
  };
  const observedDates = new Set<string>();
  if (!symbols.length) {
    result.deadline = { budgetMs, reached: false, truncated: false, elapsedMs: Date.now() - startedAt };
    finish('market symbols 0/0');
    return result;
  }
  let processed = 0;
  let skipped = 0;
  let reached = false;
  const markSkipped = (symbolId: number, ticker: string): void => {
    reached = true;
    skipped++;
    result.errors.push({ symbolId, ticker, code: 'NOT_ATTEMPTED_DEADLINE' });
    processed++;
    onProgress?.('market symbols ' + processed + '/' + symbols.length, { processed, total: symbols.length, stage: 'market symbols ' + processed + '/' + symbols.length });
  };
  const timer = setTimeout(() => {
    reached = true;
    controller.abort(new MarketDataError('SNAPSHOT_DEADLINE', 'Market snapshot deadline reached'));
  }, budgetMs);
  try {
    await forEachMarketSymbol(symbols, async symbol => {
      if (Date.now() >= deadlineAt || controller.signal.aborted) { markSkipped(symbol.id, symbol.ticker); return; }
      try {
        const series = await loadMarketSeries(symbol.id, { mode, asOf: date, signal: controller.signal });
        if (series.bars.length < 252) throw new MarketDataError('INSUFFICIENT_HISTORY', 'At least 252 bars required for the available-history snapshot indicators.');
        const trend = calculateStockTrends(series.bars, symbol, date);
        for (const bar of series.bars) observedDates.add(bar.date);
        const asOf = series.provenance.asOf;
        const dates = result.observationDates ?? { earliest: asOf, latest: asOf, staleSymbols: 0 };
        dates.earliest = dates.earliest < asOf ? dates.earliest : asOf;
        dates.latest = dates.latest > asOf ? dates.latest : asOf;
        if (series.provenance.freshness.startsWith('stale')) dates.staleSymbols++;
        result.observationDates = dates;
        result.provenance = series.provenance;
        result.sourceCoverage[series.provenance.source] = (result.sourceCoverage[series.provenance.source] ?? 0) + 1;
        result.trends.push(trend);
        processed++;
        onProgress?.('market symbols ' + processed + '/' + symbols.length, { processed, total: symbols.length, stage: 'market symbols ' + processed + '/' + symbols.length });
      } catch (error) {
        if (controller.signal.aborted) { markSkipped(symbol.id, symbol.ticker); return; }
        result.errors.push({ symbolId: symbol.id, ticker: symbol.ticker, code: error instanceof MarketDataError ? error.code : 'DATA_UNAVAILABLE' });
        processed++;
        onProgress?.('market symbols ' + processed + '/' + symbols.length, { processed, total: symbols.length, stage: 'market symbols ' + processed + '/' + symbols.length });
        if (error instanceof MarketDataError && error.code === 'INVALID_UNIVERSE') throw error;
      }
    }, options.concurrency);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', relayAbort);
  }
  result.deadline = { budgetMs, reached, truncated: skipped > 0, elapsedMs: Date.now() - startedAt };
  if (skipped > 0) {
    result.warnings = [...(result.warnings ?? []), 'Snapshot deadline (' + Math.round(budgetMs / 1000) + ' s) reached after ' + (symbols.length - skipped) + ' of ' + symbols.length + ' symbols; ' + skipped + ' were not evaluated. Retry to continue.'];
  }
  const unmappedErrorCount = result.errors.filter(error => error.code === 'UNKNOWN_MAPPING').length;
  if (unmappedErrorCount > 0) {
    result.warnings = [...(result.warnings ?? []), unmappedErrorCount + ' configured symbols have no verified provider token in the Angel One NSE/BSE instrument master; they were not evaluated and no mapping was guessed.'];
  }
  finish('market symbols ' + symbols.length + '/' + symbols.length);
  if (result.observationDates && result.observationDates.earliest !== result.observationDates.latest) {
    result.warnings = [...(result.warnings ?? []), 'Latest observed dates vary across symbols: ' + result.observationDates.earliest + ' through ' + result.observationDates.latest];
  }
  return result;
}
