/**
 * Stragy research tools exposed to the embedded OpenCode engine.
 *
 * Every tool wraps existing server code: the bounded jobs manager for
 * scans/charts/backtests, the symbol catalog, the daily-bar loader, the shared
 * indicator engine and rule predicate, the strategy validator and the saved-
 * strategy repository. Nothing here duplicates scanner/backtest logic, writes a
 * strategy, places an order, or invents a price.
 *
 * Long work never blocks a tool call for minutes: read_chart/scan_market enqueue
 * a job and return its id immediately; the get_*_result tools poll for at most
 * 24 s and return `running` so the model can ask again.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ALL_SYMBOLS, UNIVERSE_OPTIONS, filterSymbolsByUniverse, getSymbolById, getSymbolByTicker, type MarketUniverseType } from '../data/symbols';
import { loadMarketSeries } from '../data/realMarketData';
import { getCandleCoverage, getMarketCacheStats, type MarketCacheStats } from '../data/candleStore';
import { getLiveQuotes } from '../data/liveQuotes';
import { calculateAllIndicators } from '../backtest/indicators';
import { evaluateConditionMatch } from '../backtest/rules';
import { canonicalStrategyJSON, validateStrategy, IndicatorConfigSchema, RuleNodeSchema } from '../../shared/strategy/schema';
import { INDICATOR_REGISTRY, RESERVED_SERIES } from '../../shared/strategy/registry';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import { describeBacktestAssumptions } from '../../shared/strategy/backtestReview';
import { plainScanFailure } from '../../shared/contracts/scan-availability';
import type { ResearchPayload } from '../jobs/manager';
import type { StrategyAST, SymbolMeta } from '../../shared/strategy/types';
import { assumptionsHash, ApprovalStore, type ApprovalAssumptions } from './engineApprovals';
import type { EnginePluginDefinition } from './opencodeRuntime';

export interface EngineJobView {
  id: string;
  kind?: string;
  status: string;
  stage?: string;
  queuedBehind?: number;
  progress?: { processed: number; total: number };
  result?: unknown;
  error?: unknown;
  startedAt?: string;
  createdAt?: string;
}

export interface EngineJobSummary {
  id: string;
  kind: string;
  status: string;
  stage?: string;
  createdAt?: string;
  progress?: { processed: number; total: number };
  universe?: string;
}

export interface EngineJobService {
  enqueue: (payload: ResearchPayload, key?: string) => EngineJobView;
  get: (id: string) => EngineJobView | undefined;
  /** Recent durable jobs. Optional: a minimal host may only run jobs it was given. */
  listSummaries?(input?: { limit?: number; status?: string }): EngineJobSummary[];
  /**
   * Optional capability flag. The in-tree durable manager runs `kind:'cache'`
   * warm-up jobs; a host that cannot run them sets this to false and
   * refresh_market_data returns a typed CACHE_REFRESH_UNAVAILABLE instead of
   * queueing work that can never run.
   */
  supportsCacheJobs?: boolean;
}

export interface EngineSavedStrategy {
  id: string;
  revision: number;
  strategy: StrategyAST;
  updatedAt: string;
}

export interface EngineStrategyRepository {
  listStrategies: () => EngineSavedStrategy[];
  getStrategy: (id: string, revision?: number) => EngineSavedStrategy | undefined;
  /** Persist a validated strategy (upsert). `expectedRevision` guards concurrent writes. */
  saveStrategy?: (raw: unknown, expectedRevision?: number) => Promise<EngineSavedStrategy>;
}

export interface EngineAttachment {
  id: string;
  dataUrl: string;
  mimeType: string;
  name: string;
  hint?: string;
  currentStrategy?: StrategyAST;
  createdAt: number;
}

export interface EngineSessionContext {
  attachments: EngineAttachment[];
  currentStrategy?: StrategyAST;
  screenContext?: unknown;
  updatedAt: number;
}

const MAX_ATTACHMENTS = 3;
const JOB_POLL_BUDGET_MS = 24_000;
const JOB_POLL_INTERVAL_MS = 250;
const MAX_QUOTE_SYMBOLS = 20;
const MAX_HISTORY_DAYS = 750;
const MAX_HISTORY_BARS = 30;
const MAX_INDICATORS = 8;
const MAX_CONDITIONS = 8;
const MAX_SEARCH = 25;
/** A scan evaluates at most this many symbols, matching the shared universe cap. */
const MAX_SCAN_SYMBOLS = 200;
const MAX_SCAN_RESULTS = 100;
const MAX_REFRESH_SYMBOLS = 500;
const DEFAULT_REFRESH_SYMBOLS = 200;
/**
 * Cold scan cost measured on this machine on 18 Nov 2026: 200 NSE symbols took
 * 5m39s (339 s) at Angel's 1 candle-request/second pacing plus scan compute.
 * The estimate is deliberately conservative and is labelled as an estimate.
 */
const COLD_SECONDS_PER_SYMBOL = 1.7;
/** Warm cost has no provider request: SQLite read, indicators and rule evaluation only. */
const WARM_SECONDS_PER_SYMBOL = 0.1;
/** The scanner rejects a symbol with fewer than 30 bars. */
const MIN_USABLE_CACHE_BARS = 30;
/** list_universes caps cache lookups per universe and in total, then says it sampled. */
const MAX_UNIVERSE_COVERAGE_LOOKUPS = 400;
const MAX_TOTAL_COVERAGE_LOOKUPS = 2_000;

/** Per-session images and the workspace strategy the client last sent. */
export class EngineContextStore {
  private sessions = new Map<string, EngineSessionContext>();

  touch(sessionId: string): EngineSessionContext {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const created: EngineSessionContext = { attachments: [], updatedAt: Date.now() };
    this.sessions.set(sessionId, created);
    return created;
  }

  setContext(sessionId: string, input: { currentStrategy?: unknown; screenContext?: unknown }): void {
    const context = this.touch(sessionId);
    if (input.currentStrategy !== undefined) {
      const validated = validateStrategy(input.currentStrategy);
      if (validated.success && validated.data) context.currentStrategy = validated.data;
    }
    if (input.screenContext !== undefined) context.screenContext = input.screenContext;
    context.updatedAt = Date.now();
  }

  addAttachment(sessionId: string, input: { dataUrl: string; mimeType: string; name: string; hint?: string; currentStrategy?: StrategyAST }): EngineAttachment {
    const context = this.touch(sessionId);
    const attachment: EngineAttachment = {
      id: 'img_' + randomUUID().replace(/-/g, '').slice(0, 12),
      dataUrl: input.dataUrl,
      mimeType: input.mimeType,
      name: input.name.slice(0, 200),
      ...(input.hint ? { hint: input.hint.slice(0, 1000) } : {}),
      ...(input.currentStrategy ? { currentStrategy: input.currentStrategy } : {}),
      createdAt: Date.now(),
    };
    context.attachments.push(attachment);
    while (context.attachments.length > MAX_ATTACHMENTS) context.attachments.shift();
    context.updatedAt = Date.now();
    return attachment;
  }

  attachment(sessionId: string, imageId?: string): EngineAttachment | undefined {
    const context = this.sessions.get(sessionId);
    if (!context?.attachments.length) return undefined;
    if (!imageId) return context.attachments.at(-1);
    return context.attachments.find(item => item.id === imageId);
  }

  get(sessionId: string): EngineSessionContext | undefined {
    return this.sessions.get(sessionId);
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

/**
 * The strategy a tool should use for this session: the one the chat client last
 * sent, or (for hosts without a Stragy workspace, such as the standalone
 * OpenCode UI) the most recently saved workspace strategy. Nothing is invented.
 */
export function sessionStrategy(deps: EngineToolDeps, sessionId: string): { strategy: StrategyAST; source: string } | null {
  const sent = deps.contexts.get(sessionId)?.currentStrategy;
  if (sent) return { strategy: sent, source: 'workspace message' };
  const saved = deps.repository?.listStrategies?.() ?? [];
  const newest = [...saved].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  if (!newest) return null;
  return { strategy: newest.strategy, source: 'newest saved strategy "' + newest.strategy.name + '" rev ' + newest.revision };
}

export interface EngineToolDeps {
  jobs?: EngineJobService;
  dataMode: 'demo' | 'real';
  /** app.ts prepareRun: validates the window, loads bars, returns a backtest payload. */
  prepareBacktest?: (body: unknown) => Promise<ResearchPayload>;
  /** Persist a finished run through the existing repository. */
  rememberRun?: (result: unknown) => Promise<void>;
  /** Read-only access to saved workspace strategies. */
  repository?: EngineStrategyRepository;
  approvals: ApprovalStore;
  contexts: EngineContextStore;
  /** Unit-test seam for deterministic provenance; production uses loadMarketSeries. */
  loadSeries?: typeof loadMarketSeries;
  /** Unit-test seam for fast polling; production leaves these unset. */
  pollIntervalMs?: number;
  pollBudgetCapMs?: number;
}

export type EngineToolDepsGetter = () => EngineToolDeps;

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const symbolInput = z.union([z.string().trim().min(1).max(40), z.number().int().positive().max(1_000_000)]);
const outputSchema = z.object({ status: z.string() }).passthrough();

function normalizeUniverse(raw: unknown, fallback: unknown): string | null {
  const candidate = typeof raw === 'string' && raw.trim() ? raw.trim() : typeof fallback === 'string' ? fallback : 'NIFTY_50';
  const aliases: Record<string, string> = { NIFTY50: 'NIFTY_50', BANKNIFTY: 'BANK_NIFTY' };
  const normalized = aliases[candidate.toUpperCase()] ?? candidate.toUpperCase();
  return UNIVERSE_OPTIONS.some(item => item.id === normalized) ? normalized : null;
}

/** Some models send a nested AST as a JSON string; accept both honestly. */
function coerceJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return raw;
  try { return JSON.parse(trimmed) as unknown; } catch { return raw; }
}

function strategyFrom(input: unknown, fallback: StrategyAST | undefined): { strategy?: StrategyAST; error?: string } {
  const raw = coerceJson(input ?? fallback);
  if (!raw) return { error: 'A validated strategy is required. Call get_current_strategy or propose_strategy_edit first.' };
  const validated = validateStrategy(raw);
  if (!validated.success || !validated.data) return { error: 'The strategy is invalid: ' + (validated.errors?.slice(0, 5).join('; ') ?? 'unknown validation error') };
  return { strategy: validated.data };
}

function resolveSymbol(raw: string | number): { symbol?: SymbolMeta; error?: string } {
  if (typeof raw === 'number') {
    try { return { symbol: getSymbolById(raw) }; } catch { return { error: 'Unknown symbol id ' + raw + '.' }; }
  }
  const value = raw.trim();
  if (/^\d+$/.test(value)) {
    try { return { symbol: getSymbolById(Number(value)) }; } catch { return { error: 'Unknown symbol id ' + value + '.' }; }
  }
  const match = getSymbolByTicker(value.toUpperCase());
  return match ? { symbol: match } : { error: 'Unknown ticker ' + value + '. Use search_symbols to find the exact symbol.' };
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function num(value: unknown, digits = 2): string {
  const n = finite(value);
  return n === null ? 'unavailable' : n.toFixed(digits);
}

function pct(value: unknown): string {
  const n = finite(value);
  return n === null ? 'unavailable' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

type SeriesProvenance = Awaited<ReturnType<typeof loadMarketSeries>>['provenance'];

interface CacheEvidenceView {
  hit: boolean;
  incremental: boolean;
  bars: number;
  lastFetchAt: string | null;
  candleRequests: number;
}

/** Map the loader's real cache evidence; never invent it when the provider did not report it. */
function cacheEvidence(provenance: SeriesProvenance | undefined): CacheEvidenceView | null {
  const cache = provenance?.cache;
  if (!cache) return null;
  return {
    hit: cache.hit === true,
    incremental: cache.incremental === true,
    bars: finite(cache.bars) ?? 0,
    lastFetchAt: typeof cache.lastFetchAt === 'string' ? cache.lastFetchAt : null,
    candleRequests: finite(cache.candleRequests) ?? 0,
  };
}

/** "cache" means zero provider requests; "provider-incremental" means only the missing tail was fetched. */
function sourceKind(provenance: SeriesProvenance | undefined): 'cache' | 'provider-incremental' | 'provider' | 'demo' | 'unknown' {
  if (!provenance) return 'unknown';
  if (provenance.mode === 'demo') return 'demo';
  const cache = provenance.cache;
  if (!cache) return 'provider';
  if (cache.hit) return 'cache';
  if (cache.incremental) return 'provider-incremental';
  return 'provider';
}

function universeSymbols(universeId: string): SymbolMeta[] {
  try { return filterSymbolsByUniverse(universeId as MarketUniverseType); } catch { return []; }
}

/** The number of configured symbols a scan of this universe actually evaluates. */
function scanCapFor(universeId: string, symbols: SymbolMeta[]): number {
  const option = UNIVERSE_OPTIONS.find(item => item.id === universeId);
  const cap = typeof option?.evaluatedCap === 'number' ? option.evaluatedCap : symbols.length;
  return Math.max(0, Math.min(cap, symbols.length, MAX_SCAN_SYMBOLS));
}

interface CacheCount {
  checked: number;
  cached: number;
  bars: number;
  firstDate: string | null;
  lastDate: string | null;
  sampled: boolean;
}

function emptyCacheCount(checked = 0, sampled = false): CacheCount {
  return { checked, cached: 0, bars: 0, firstDate: null, lastDate: null, sampled };
}

function readCoverage(symbolId: number) {
  try { return getCandleCoverage(symbolId); } catch { return undefined; }
}

/** Add one symbol's durable coverage to a count. Returns false when the cache itself is unavailable. */
function addCoverage(count: CacheCount, symbolId: number): boolean {
  const coverage = readCoverage(symbolId);
  if (coverage === undefined) return false;
  if (!coverage || coverage.bars < MIN_USABLE_CACHE_BARS) return true;
  count.cached += 1;
  count.bars += coverage.bars;
  if (coverage.firstDate && (!count.firstDate || coverage.firstDate < count.firstDate)) count.firstDate = coverage.firstDate;
  if (coverage.lastDate && (!count.lastDate || coverage.lastDate > count.lastDate)) count.lastDate = coverage.lastDate;
  return true;
}

/** Exact coverage for the symbols a scan would evaluate (at most 200 point lookups). */
function countCachedWindow(symbols: SymbolMeta[], windowSize: number): CacheCount | null {
  const window = symbols.slice(0, Math.max(0, Math.min(windowSize, symbols.length)));
  const count = emptyCacheCount(window.length);
  for (const symbol of window) {
    if (!addCoverage(count, symbol.id)) return null;
  }
  return count;
}

/** Evenly spaced sample for a whole configured pool; `sampled` is true when it did not check every symbol. */
function sampleCached(symbols: SymbolMeta[], budget: number): CacheCount | null {
  const take = Math.min(symbols.length, Math.max(0, Math.floor(budget)));
  const count = emptyCacheCount(take, take < symbols.length);
  if (!take) return count;
  const step = symbols.length / take;
  for (let index = 0; index < take; index++) {
    const symbol = symbols[Math.floor(index * step)];
    if (!symbol) continue;
    if (!addCoverage(count, symbol.id)) return null;
  }
  return count;
}

function coldScanSeconds(symbols: number): number {
  return Math.max(1, Math.round(symbols * COLD_SECONDS_PER_SYMBOL));
}

function warmScanSeconds(symbols: number): number {
  return Math.max(1, Math.round(symbols * WARM_SECONDS_PER_SYMBOL));
}

/** Mixed estimate: uncached symbols pay the cold fetch, cached ones pay the warm read. */
function estimatedScanSeconds(symbols: number, cached: number): number {
  const safeCached = Math.max(0, Math.min(cached, symbols));
  return Math.max(1, Math.round((symbols - safeCached) * COLD_SECONDS_PER_SYMBOL + safeCached * WARM_SECONDS_PER_SYMBOL));
}

function durationLabel(seconds: number): string {
  return seconds < 90 ? seconds + ' s' : (seconds / 60).toFixed(1) + ' min';
}

interface JobProgressView {
  progress: { processed: number; total: number } | null;
  percent: number | null;
  elapsedSeconds: number | null;
  estimatedSecondsRemaining: number | null;
  etaBasis: string | null;
}

/** ETA is only computed from real processed/total progress and a real start time; otherwise null. */
function jobProgress(job: EngineJobView, nowMs = Date.now()): JobProgressView {
  const processed = finite(job.progress?.processed);
  const total = finite(job.progress?.total);
  const progress = processed !== null && total !== null && total > 0
    ? { processed: Math.max(0, Math.round(processed)), total: Math.round(total) }
    : null;
  const percent = progress ? Math.min(100, Math.round((progress.processed / progress.total) * 1000) / 10) : null;
  const startedAtMs = job.startedAt ? Date.parse(job.startedAt) : Number.NaN;
  const elapsedSeconds = Number.isFinite(startedAtMs) ? Math.max(0, Math.round((nowMs - startedAtMs) / 1000)) : null;
  let estimatedSecondsRemaining: number | null = null;
  let etaBasis: string | null = null;
  if (progress && elapsedSeconds !== null && progress.processed >= 2 && progress.total > progress.processed) {
    const perSymbol = elapsedSeconds / progress.processed;
    estimatedSecondsRemaining = Math.max(1, Math.round(perSymbol * (progress.total - progress.processed)));
    etaBasis = 'measured from ' + progress.processed + ' of ' + progress.total + ' processed in ' + elapsedSeconds + ' s';
  }
  return { progress, percent, elapsedSeconds, estimatedSecondsRemaining, etaBasis };
}

function typedFailure(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { status: 'failed' as const, error: { code, message }, ...extra };
}

function jobFailure(job: EngineJobView) {
  const error = job.error && typeof job.error === 'object' ? job.error as { code?: unknown; message?: unknown } : undefined;
  return {
    status: 'failed' as const,
    jobId: job.id,
    kind: job.kind,
    error: {
      code: typeof error?.code === 'string' ? error.code : 'JOB_FAILED',
      message: typeof error?.message === 'string' ? error.message : 'The research job did not complete.',
    },
  };
}

async function pollJob(
  jobs: EngineJobService,
  jobId: string,
  budgetMs: number = JOB_POLL_BUDGET_MS,
  intervalMs: number = JOB_POLL_INTERVAL_MS,
): Promise<EngineJobView | { missing: true }> {
  const deadline = Date.now() + Math.max(0, budgetMs);
  const wait = Math.max(1, intervalMs);
  for (;;) {
    const job = jobs.get(jobId);
    if (!job) return { missing: true };
    if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(job.status)) return job;
    if (Date.now() >= deadline) return job;
    await new Promise(resolve => setTimeout(resolve, Math.min(wait, Math.max(1, deadline - Date.now()))));
  }
}

function assumptionLines(strategy: StrategyAST, options: { asOf?: string; start?: string; end?: string; initialCapital?: number }): string[] {
  const review = describeBacktestAssumptions(strategy, {
    ...(options.initialCapital !== undefined ? { initialCapital: options.initialCapital } : {}),
    ...(options.asOf ? { asOf: options.asOf } : {}),
    sourceLabel: 'Engine backtest request',
  });
  const lines = [
    ...review.entrySummary,
    ...review.exitSummary,
    ...review.riskSummary,
    review.sizingSummary,
    review.executionSummary,
    review.capitalSummary,
    review.costSummary,
    review.dataWindow,
    ...review.defaults,
    ...review.limitations,
  ];
  const window = [options.start ? 'Start ' + options.start : '', options.end ? 'end ' + options.end : '', options.asOf ? 'as of ' + options.asOf : ''].filter(Boolean).join(', ');
  if (window) lines.unshift('Data window: ' + window + '.');
  return [...new Set(lines.filter(Boolean))].slice(0, 14);
}

function toAssumptions(strategy: StrategyAST, options: { asOf?: string; start?: string; end?: string; initialCapital?: number }): ApprovalAssumptions {
  const validated = validateStrategy(strategy);
  const canonical = validated.canonicalData ? canonicalStrategyJSON(validated.canonicalData) : canonicalStrategyJSON(strategy);
  return {
    strategy: canonical,
    ...(options.asOf ? { asOf: options.asOf } : {}),
    ...(options.start ? { start: options.start } : {}),
    ...(options.end ? { end: options.end } : {}),
    ...(options.initialCapital !== undefined ? { initialCapital: options.initialCapital } : {}),
  };
}

function scanCacheCoverage(result: {
  matches?: { provenance?: SeriesProvenance }[];
  nearMatches?: { provenance?: SeriesProvenance }[];
} | undefined): { retainedRows: number; cached: number; incremental: number; fetched: number; unknown: number; candleRequests: number; note: string } | null {
  if (!result) return null;
  const rows = [...(result.matches ?? []), ...(result.nearMatches ?? [])];
  if (!rows.length) return null;
  let cached = 0, incremental = 0, fetched = 0, unknown = 0, candleRequests = 0;
  for (const row of rows) {
    const cache = row.provenance?.cache;
    if (!cache) { unknown += 1; continue; }
    candleRequests += finite(cache.candleRequests) ?? 0;
    if (cache.hit) cached += 1;
    else if (cache.incremental) incremental += 1;
    else fetched += 1;
  }
  return {
    retainedRows: rows.length, cached, incremental, fetched, unknown, candleRequests,
    note: 'Cache state is read from the retained match/near-match provenance; the scan does not retain cache evidence for every evaluated symbol.',
  };
}

function scanSummary(job: EngineJobView): { status: string; [key: string]: unknown } {
  const result = job.result as {
    universe?: string; matched?: number; requested?: number; attempted?: number; succeeded?: number; unavailable?: number; failed?: number;
    matches?: { ticker?: string; lastClose?: number; changePercent?: number; score?: number; lastDate?: string; matchedRules?: { rule: string }[]; provenance?: SeriesProvenance }[];
    nearMatches?: { ticker?: string; lastClose?: number; changePercent?: number; unmatchedRules?: { rule: string }[]; provenance?: SeriesProvenance }[];
    warnings?: string[]; observationDates?: unknown; asOf?: string; dataSource?: string; status?: string;
    membership?: { selected?: number; available?: number; cap?: number; truncated?: boolean; basis?: string };
  } | undefined;
  if (!result) return { status: 'succeeded', jobId: job.id, note: 'The job finished but returned no result.' };
  const membership = result.membership;
  return {
    status: 'succeeded',
    jobId: job.id,
    kind: 'scan',
    universe: result.universe,
    matched: result.matched,
    requested: result.requested,
    evaluated: result.attempted,
    succeeded: result.succeeded,
    unavailable: result.unavailable,
    failed: result.failed,
    coverageStatus: result.status,
    coverage: { requested: result.requested, evaluated: result.attempted, succeeded: result.succeeded, unavailable: result.unavailable, failed: result.failed },
    universeMembership: membership ? {
      basis: membership.basis, selected: membership.selected, available: membership.available,
      cap: membership.cap, truncated: membership.truncated,
    } : null,
    asOf: result.asOf,
    dataSource: result.dataSource,
    observationDates: result.observationDates,
    matches: (result.matches ?? []).slice(0, 10).map(match => ({
      ticker: match.ticker, lastDate: match.lastDate, lastClose: match.lastClose, changePercent: match.changePercent,
      score: match.score, rules: (match.matchedRules ?? []).slice(0, 5).map(rule => rule.rule),
      cache: cacheEvidence(match.provenance),
    })),
    nearMatches: (result.nearMatches ?? []).slice(0, 5).map(match => ({ ticker: match.ticker, lastClose: match.lastClose, changePercent: match.changePercent, unmatchedRules: (match.unmatchedRules ?? []).slice(0, 3).map(rule => rule.rule), cache: cacheEvidence(match.provenance) })),
    cacheCoverage: scanCacheCoverage(result),
    warnings: (result.warnings ?? []).slice(0, 8),
    note: 'The scan evaluated ' + (result.attempted ?? 'an unknown number of') + ' symbol(s); matches are paginated by the limit. Full rows and provenance are rendered in the scan card in the UI. Use explain_match for a retained symbol.',
  };
}

function refreshSummary(job: EngineJobView): { status: string; [key: string]: unknown } {
  const result = job.result as {
    id?: string; status?: string; universe?: string | null; total?: number; processed?: number;
    succeeded?: number; failed?: number; startedAt?: string; finishedAt?: string;
    errors?: { ticker?: string; code?: string; message?: string }[]; warning?: string;
  } | undefined;
  if (!result) return { status: 'succeeded', jobId: job.id, kind: 'cache', note: 'The warm-up finished but returned no state.' };
  const status = result.status === 'done' ? 'succeeded' : result.status === 'failed' ? 'failed' : result.status ?? 'succeeded';
  return {
    status,
    jobId: job.id,
    kind: 'cache',
    universe: result.universe ?? null,
    total: result.total,
    processed: result.processed,
    succeeded: result.succeeded,
    failed: result.failed,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    warning: result.warning ?? null,
    errors: (result.errors ?? []).slice(0, 8),
    note: result.status === 'done'
      ? 'Warm-up finished. A later scan of these symbols reads the cache instead of re-downloading them.'
      : result.warning ?? 'The warm-up did not complete; the cache keeps whatever it already stored.',
  };
}

function backtestSummary(job: EngineJobView): { status: string; [key: string]: unknown } {
  const result = job.result as {
    metrics?: Record<string, number | null>; warnings?: string[]; executedAt?: string;
    provenance?: { source?: string; mode?: string; actualRange?: unknown }; symbol?: { ticker?: string; name?: string };
  } | undefined;
  if (!result?.metrics) return { status: 'succeeded', jobId: job.id, note: 'The job finished but returned no backtest result.' };
  const m = result.metrics;
  return {
    status: 'succeeded',
    jobId: job.id,
    kind: 'backtest',
    symbol: result.symbol?.ticker,
    executedAt: result.executedAt,
    dataSource: result.provenance?.source,
    mode: result.provenance?.mode,
    range: result.provenance?.actualRange,
    metrics: {
      totalReturnPercent: m.totalReturnPercent, netPnl: m.netPnl, cagr: m.cagr, sharpeRatio: m.sharpeRatio,
      maxDrawdownPercent: m.maxDrawdownPercent, totalTrades: m.totalTrades, winRate: m.winRate,
      profitFactor: m.profitFactor, benchmarkReturnPercent: m.benchmarkReturnPercent, alpha: m.alpha,
    },
    warnings: (result.warnings ?? []).slice(0, 8),
    note: 'The full result, equity curve and trades are rendered in the backtest card in the UI.',
  };
}

function chartSummary(job: EngineJobView): { status: string; [key: string]: unknown } {
  const result = job.result as {
    kind?: string; message?: string; warnings?: string[]; provider?: { name?: string };
    strategy?: { name?: string; universe?: { ticker?: string } }; universe?: string; confidence?: number;
    summary?: string; observations?: unknown; method?: string;
  } | undefined;
  if (!result) return { status: 'succeeded', jobId: job.id, note: 'The job finished but returned no chart reading.' };
  return {
    status: 'succeeded', jobId: job.id, kind: 'chart', readingKind: result.kind,
    message: result.message, method: result.method, strategyName: result.strategy?.name,
    universe: result.universe ?? result.strategy?.universe?.ticker, confidence: result.confidence,
    summary: result.summary, observations: result.kind === 'screen' ? result.observations : undefined,
    warnings: (result.warnings ?? []).slice(0, 8),
    note: 'The reviewed chart plan is shown in the chart card in the UI. Nothing was scanned or applied.',
  };
}

const INDICATOR_DOCS: Record<string, { constraints: string; example: unknown }> = {
  SMA: { constraints: 'period: integer 1..10000; default 20', example: { id: 'sma50', type: 'SMA', params: { period: 50 } } },
  EMA: { constraints: 'period: integer 1..10000; default 20', example: { id: 'ema20', type: 'EMA', params: { period: 20 } } },
  RSI: { constraints: 'period: integer 1..10000; default 14', example: { id: 'rsi14', type: 'RSI', params: { period: 14 } } },
  RSI_SMA: { constraints: 'rsiPeriod: 2..100 (default 14), period: 2..200 (default 14)', example: { id: 'rsi_signal', type: 'RSI_SMA', params: { rsiPeriod: 14, period: 14 } } },
  RSI_TRENDLINE: { constraints: 'rsiPeriod 2..100, minSpan 5..200, maxSpan 10..500, minSpan<maxSpan, anchorMin 1..100', example: { id: 'rsi_trend', type: 'RSI_TRENDLINE', params: { rsiPeriod: 14, minSpan: 30, maxSpan: 180, anchorMin: 60 } } },
  PCT_ABOVE_LOW: { constraints: 'period: 2..1000, default 250', example: { id: 'pct_low', type: 'PCT_ABOVE_LOW', params: { period: 250 } } },
  PCT_CHANGE: { constraints: 'period: 2..1000, default 126', example: { id: 'pct_change', type: 'PCT_CHANGE', params: { period: 126 } } },
  ATR: { constraints: 'period: integer 1..10000; default 14', example: { id: 'atr14', type: 'ATR', params: { period: 14 } } },
  HIGHEST: { constraints: 'period: 2..500, default 20; excludes the current bar', example: { id: 'high20', type: 'HIGHEST', params: { period: 20 } } },
  LOWEST: { constraints: 'period: 2..500, default 20; excludes the current bar', example: { id: 'low20', type: 'LOWEST', params: { period: 20 } } },
  VOLUME_SMA: { constraints: 'period: integer 1..10000; default 20', example: { id: 'vol_sma', type: 'VOLUME_SMA', params: { period: 20 } } },
  BBANDS: { constraints: 'period: integer 1..10000; stdDev > 0; outputs middle/upper/lower', example: { id: 'bb', type: 'BBANDS', params: { period: 20, stdDev: 2 } } },
  MACD: { constraints: 'fastPeriod<slowPeriod; signalPeriod; outputs line/signal/histogram', example: { id: 'macd', type: 'MACD', params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } } },
  SUPERTREND: { constraints: 'period integer 1..10000; multiplier > 0; outputs line/direction', example: { id: 'st', type: 'SUPERTREND', params: { period: 10, multiplier: 3 } } },
};

const OPERATOR_TEXT: Record<string, string> = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=', approxEq: '≈', crossesAbove: 'crosses above', crossesBelow: 'crosses below' };

interface ConditionLine {
  rule: string;
  left: string;
  right: string;
  operator: string;
  actualLeft: number | null;
  actualRight: number | null;
  matched: boolean;
  matchedDate?: string;
  line: string;
}

function evaluateConditions(rules: z.infer<typeof RuleNodeSchema>[], series: Record<string, (number | null)[]>, bars: { date: string }[]): ConditionLine[] {
  const index = bars.length - 1;
  return rules.map(rule => {
    const actualLeft = typeof rule.leftValue === 'number' && Number.isFinite(rule.leftValue)
      ? rule.leftValue
      : finite(series[rule.leftIndicator]?.[index]);
    const actualRight = rule.rightIndicator
      ? finite(series[rule.rightIndicator]?.[index])
      : typeof rule.rightValue === 'number' && Number.isFinite(rule.rightValue) ? rule.rightValue : null;
    const match = evaluateConditionMatch(rule, index, series, bars);
    const operator = OPERATOR_TEXT[rule.operator] ?? rule.operator;
    const line = rule.leftIndicator + '=' + num(actualLeft) + ' ' + operator + ' ' + (rule.rightIndicator ?? num(actualRight)) + ' ' + (match.matched ? '✓ pass' : '✗ fail') + (match.mostRecentMatchingDate && !match.matched ? '' : match.matched && match.mostRecentMatchingIndex !== index ? ' (matched ' + (match.mostRecentMatchingDate ?? 'earlier') + ')' : '');
    return {
      rule: rule.leftIndicator + ' ' + operator + ' ' + (rule.rightIndicator ?? String(rule.rightValue)),
      left: rule.leftIndicator, right: rule.rightIndicator ?? String(rule.rightValue), operator,
      actualLeft, actualRight, matched: match.matched,
      ...(match.mostRecentMatchingDate ? { matchedDate: match.mostRecentMatchingDate } : {}),
      line,
    };
  });
}

interface EngineToolEditor { add(tool: Record<string, unknown>): void }
interface EnginePluginContext { session?: unknown; tool: { transform(callback: (editor: EngineToolEditor) => void): Promise<unknown> | unknown } }

export function createEnginePlugin(getDeps: EngineToolDepsGetter): EnginePluginDefinition {
  let sessionApi: { instructions: { entry: { list: (input: { sessionID: string }) => Promise<{ key: string; value: unknown }[]>; put: (input: { sessionID: string; key: string; value: unknown }) => Promise<void> } } } | null = null;
  const requireJobs = (): EngineJobService | null => getDeps().jobs ?? null;

  return {
    id: 'stragy-research-tools',
    setup: async (rawContext) => {
      const context = rawContext as EnginePluginContext;
      sessionApi = context.session as unknown as typeof sessionApi;
      await context.tool.transform((editor) => {
        // ---------------------------------------------------------------- chart
        editor.add({
          name: 'read_chart',
          description: 'Start reading an attached chart screenshot. Returns a jobId immediately; call get_chart_result with it. The current workspace strategy is required so exits, risk, sizing and costs are preserved.',
          input: z.object({
            imageId: z.string().max(80).optional().describe('Attachment id from the prompt; omit to use the latest attached image.'),
            hint: z.string().max(1000).optional(),
            currentStrategy: z.unknown().optional().describe('Optional complete strategy; defaults to the workspace strategy sent with the message.'),
          }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input, toolContext) => {
            const deps = getDeps();
            const jobs = requireJobs();
            if (!jobs) return { output: typedFailure('JOB_RUNNER_UNAVAILABLE', 'Chart jobs are unavailable on this server.') };
            const image = deps.contexts.attachment(toolContext.sessionID, input.imageId);
            if (!image) return { output: typedFailure('IMAGE_REQUIRED', 'No chart image is attached to this session. Attach a PNG/JPEG/WebP screenshot and send it with a message.') };
            const picked = strategyFrom(input.currentStrategy ?? image.currentStrategy, sessionStrategy(deps, toolContext.sessionID)?.strategy);
            if (!picked.strategy) return { output: typedFailure('STRATEGY_REQUIRED', picked.error ?? 'A current workspace strategy is required.') };
            try {
              const job = jobs.enqueue({ kind: 'chart', image: image.dataUrl, hint: input.hint ?? image.hint, currentStrategy: picked.strategy });
              return { output: { status: 'queued', kind: 'chart', jobId: job.id, imageId: image.id, note: 'Chart analysis usually takes 20-200 seconds. Call get_chart_result with this jobId; a running answer means call again.' } };
            } catch (error) {
              return { output: typedFailure('CHART_ENQUEUE_FAILED', (error as Error).message || 'The chart job could not be queued.') };
            }
          },
        });

        editor.add({
          name: 'get_chart_result',
          description: 'Read the result of a chart job started by read_chart. Waits up to 24 seconds, then reports running so you can call again.',
          input: z.object({ jobId: z.string().min(1).max(100) }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input) => {
            const jobs = requireJobs();
            if (!jobs) return { output: typedFailure('JOB_RUNNER_UNAVAILABLE', 'Chart jobs are unavailable on this server.') };
            const job = await pollJob(jobs, input.jobId);
            if ('missing' in job) return { output: typedFailure('JOB_NOT_FOUND', 'That chart job is unknown or has expired. Ask the user to send the image again.') };
            if (job.status === 'succeeded') return { output: chartSummary(job) };
            if (['failed', 'cancelled', 'interrupted'].includes(job.status)) return { output: jobFailure(job) };
            return { output: { status: 'running', jobId: job.id, kind: 'chart', ...(job.progress ? { progress: job.progress } : {}), note: 'The chart read is still running. Call get_chart_result again with the same jobId.' } };
          },
        });

        // -------------------------------------------------------------- scanning
        editor.add({
          name: 'scan_market',
          description: 'Queue a read-only universe scan with a validated strategy. Returns a jobId immediately; call get_scan_result with it. The scan never runs a backtest and never applies a strategy.',
          input: z.object({
            universe: z.string().max(40).optional().describe('NIFTY_50, BANK_NIFTY, NIFTY_IT, NIFTY_AUTO, NIFTY_PHARMA, NIFTY_METAL, NIFTY_FMCG, NSE, BSE, ALL.'),
            strategy: z.unknown().optional().describe('Complete strategy; defaults to the workspace strategy sent with the message.'),
            asOf: dateString.optional(),
            maxSymbols: z.number().int().min(1).max(MAX_SCAN_SYMBOLS).optional().describe('Evaluate only the first N configured symbols of the universe (1..200); the universe cap still applies. This is not result pagination.'),
            limit: z.number().int().min(1).max(MAX_SCAN_RESULTS).optional().describe('Result pagination only: maximum matched rows returned (1..100). It does NOT change how many symbols are evaluated; use maxSymbols for that.'),
          }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input, toolContext) => {
            const deps = getDeps();
            const jobs = requireJobs();
            if (!jobs) return { output: typedFailure('JOB_RUNNER_UNAVAILABLE', 'Scan jobs are unavailable on this server.') };
            const contextValue = deps.contexts.get(toolContext.sessionID);
            const screen = contextValue?.screenContext as { universe?: unknown; strategy?: unknown; asOf?: string } | undefined;
            const universe = normalizeUniverse(input.universe ?? screen?.universe, screen?.universe);
            if (!universe) return { output: typedFailure('UNKNOWN_UNIVERSE', 'Unknown universe. Use list_universes to see the valid ids.') };
            const picked = strategyFrom(input.strategy ?? screen?.strategy, sessionStrategy(deps, toolContext.sessionID)?.strategy);
            if (!picked.strategy) return { output: typedFailure('STRATEGY_REQUIRED', picked.error ?? 'A validated strategy is required.') };
            const symbols = universeSymbols(universe);
            const configured = symbols.length;
            if (!configured) return { output: typedFailure('UNIVERSE_EMPTY', 'No configured symbols match that universe. Nothing was scanned.') };
            const scanCap = scanCapFor(universe, symbols);
            const requested = Math.max(1, Math.min(input.maxSymbols ?? scanCap, scanCap));
            const cached = countCachedWindow(symbols, requested);
            const coldSeconds = coldScanSeconds(requested);
            const warmSeconds = warmScanSeconds(requested);
            const estimatedSeconds = cached ? estimatedScanSeconds(requested, cached.cached) : coldSeconds;
            try {
              const job = jobs.enqueue({
                kind: 'scan', strategy: picked.strategy, universe,
                ...(input.asOf ?? screen?.asOf ? { asOf: input.asOf ?? screen?.asOf } : {}),
                mode: deps.dataMode, limit: input.limit ?? 50,
                ...(input.maxSymbols !== undefined || configured > scanCap ? { maxSymbols: requested } : {}),
              });
              const windowLabel = requested < configured
                ? 'first ' + requested + ' of ' + configured + ' configured ' + universe + ' symbols'
                : 'all ' + configured + ' configured ' + universe + ' symbols';
              const capNote = requested < scanCap ? ' (the scan cap is ' + scanCap + ', so this is a bounded subset)' : '';
              return {
                output: {
                  status: 'queued', kind: 'scan', jobId: job.id, universe,
                  ...(input.strategy === undefined ? { strategy: picked.strategy } : {}),
                  evaluation: { requested, scanCap, configuredSymbols: configured },
                  cacheCoverage: {
                    cached: cached?.cached ?? null, total: requested,
                    estimatedSeconds,
                    coldSeconds,
                    warmSeconds,
                    note: cached
                      ? 'Estimated from durable cache coverage; a stale cached tail still makes one incremental provider request.'
                      : 'Cache coverage could not be read; the estimate assumes every symbol needs a cold provider fetch.',
                  },
                  note: windowLabel + capNote + '; cold scan ~' + durationLabel(coldSeconds) + ', warm ~' + durationLabel(warmSeconds) + '. Call get_scan_result with this jobId; a running answer means call it again immediately without narrating progress.',
                },
              };
            } catch (error) {
              return { output: typedFailure('SCAN_ENQUEUE_FAILED', plainScanFailure('SCAN_ENQUEUE_FAILED', (error as Error).message, universe) ?? ((error as Error).message || 'The scan could not be queued.')) };
            }
          },
        });

        editor.add({
          name: 'get_scan_result',
          description: 'Read the result of a scan job started by scan_market. Waits up to 24 seconds by default, then reports running with progress and a measured ETA so you can call again.',
          input: z.object({
            jobId: z.string().min(1).max(100),
            waitSeconds: z.number().int().min(5).max(45).optional().describe('How long to wait for a running scan before returning progress (5..45, default 24).'),
          }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input) => {
            const deps = getDeps();
            const jobs = requireJobs();
            if (!jobs) return { output: typedFailure('JOB_RUNNER_UNAVAILABLE', 'Scan jobs are unavailable on this server.') };
            const requestedBudget = (input.waitSeconds ?? 24) * 1000;
            const budget = Math.min(requestedBudget, deps.pollBudgetCapMs ?? Number.POSITIVE_INFINITY);
            const job = await pollJob(jobs, input.jobId, budget, deps.pollIntervalMs);
            if ('missing' in job) return { output: typedFailure('JOB_NOT_FOUND', 'That scan job is unknown or has expired. Queue the scan again.') };
            if (job.status === 'succeeded') return { output: scanSummary(job) };
            if (['failed', 'cancelled', 'interrupted'].includes(job.status)) return { output: jobFailure(job) };
            const progress = jobProgress(job);
            return {
              output: {
                status: 'running', jobId: job.id, kind: 'scan', stage: job.stage,
                ...progress,
                ...(job.queuedBehind !== undefined ? { queuedBehind: job.queuedBehind, note: 'Queued behind ' + job.queuedBehind + ' other job(s). Do not narrate each poll; call get_scan_result again immediately.' } : { note: 'Do not narrate each poll; call get_scan_result again immediately with the same jobId.' }),
                ...(progress.estimatedSecondsRemaining === null ? { etaNote: 'No ETA because there is not enough measured progress yet.' } : {}),
              },
            };
          },
        });

        // -------------------------------------------------------------- discovery
        editor.add({
          name: 'list_universes',
          description: 'List the scan universes with membership basis, configured symbol count and durable candle-cache coverage. Read-only and network-free.',
          input: z.object({}).strict(),
          output: outputSchema,
          options: { codemode: false },
          execute: async () => {
            let budget = MAX_TOTAL_COVERAGE_LOOKUPS;
            const universes = UNIVERSE_OPTIONS.map(universe => {
              const symbols = universeSymbols(universe.id);
              const allowance = Math.min(MAX_UNIVERSE_COVERAGE_LOOKUPS, budget);
              const coverage = allowance > 0 ? sampleCached(symbols, allowance) : null;
              budget -= coverage?.checked ?? 0;
              return {
                id: universe.id, label: universe.label, category: universe.category,
                evaluatedCap: universe.evaluatedCap ?? null, membershipBasis: universe.membershipBasis ?? null,
                symbols: symbols.length,
                cachedSymbols: coverage && coverage.checked
                  ? (coverage.sampled ? Math.round((coverage.cached / coverage.checked) * symbols.length) : coverage.cached)
                  : null,
                cache: coverage ? {
                  checked: coverage.checked,
                  cached: coverage.cached,
                  sampled: coverage.sampled,
                  cachedSymbolsBasis: coverage.sampled ? 'scaled-estimate-from-even-sample' : 'exact',
                  lastDate: coverage.lastDate,
                } : { checked: 0, cached: 0, sampled: true, cachedSymbolsBasis: 'not-checked', note: 'The lookup budget ran out before this universe; coverage is unknown.' },
              };
            });
            return {
              output: {
                status: 'ok',
                universes,
                note: 'Broad universes are capped; the scan reports checked vs requested honestly. cachedSymbols is exact when cache.sampled is false, otherwise it is scaled from an evenly spaced sample. The UI also offers a curated subset.',
              },
            };
          },
        });

        editor.add({
          name: 'get_data_cache',
          description: 'Inspect the durable daily-candle cache without any network call: totals, per-universe coverage and an honest cold/warm scan estimate. Live quotes are not cached.',
          input: z.object({}).strict(),
          output: outputSchema,
          options: { codemode: false },
          execute: async () => {
            let stats: MarketCacheStats;
            try { stats = getMarketCacheStats(); }
            catch (error) {
              return { output: typedFailure('CACHE_UNAVAILABLE', 'The durable candle cache could not be read: ' + ((error as Error).message || 'unknown storage error')) };
            }
            const universes = UNIVERSE_OPTIONS.map(universe => {
              const symbols = universeSymbols(universe.id);
              const scanCap = scanCapFor(universe.id, symbols);
              const coverage = countCachedWindow(symbols, scanCap);
              return {
                id: universe.id,
                label: universe.label,
                configuredSymbols: symbols.length,
                scanCap,
                scanWindow: 'first ' + scanCap + ' configured symbols (the scan cap)',
                cachedSymbols: coverage?.cached ?? null,
                cachedBars: coverage?.bars ?? null,
                firstDate: coverage?.firstDate ?? null,
                lastDate: coverage?.lastDate ?? null,
                estimatedColdSeconds: coldScanSeconds(scanCap),
                estimatedWarmSeconds: warmScanSeconds(scanCap),
                note: coverage
                  ? coverage.cached + ' of ' + scanCap + ' have at least ' + MIN_USABLE_CACHE_BARS + ' cached bars.'
                  : 'Cache coverage is unavailable.',
              };
            });
            return {
              output: {
                status: 'ok',
                cache: { ...stats },
                scanDefaults: {
                  maxSymbols: MAX_SCAN_SYMBOLS,
                  coldSecondsPerSymbol: COLD_SECONDS_PER_SYMBOL,
                  warmSecondsPerSymbol: WARM_SECONDS_PER_SYMBOL,
                  estimateBasis: 'cold observed 18 Nov 2026 (200 symbols in 5m39s at Angel 1 request/s plus compute); warm is a cached SQLite read with no provider request',
                },
                universes,
                quotes: {
                  cached: false,
                  note: 'Quotes are not cached. get_quote may show a live Angel One LTP; the daily close it returns is the latest observed/cached bar, delayed and end-of-day.',
                },
                generatedAt: new Date().toISOString(),
                note: 'This tool never calls a provider. A cached symbol saves the download; it does not make the data live. A warm scan still reads SQLite and recomputes indicators.',
              },
            };
          },
        });

        editor.add({
          name: 'refresh_market_data',
          description: 'Queue a background cache warm-up for one universe or an explicit symbol list. Returns a jobId immediately and never downloads inline; call get_refresh_result to follow it.',
          input: z.object({
            universe: z.string().max(40).optional().describe('Universe to warm (default NIFTY_50). Ignored when symbolIds is supplied.'),
            symbolIds: z.array(symbolInput).min(1).max(MAX_REFRESH_SYMBOLS).optional().describe('Explicit symbols to warm, by ticker or numeric id.'),
            maxSymbols: z.number().int().min(1).max(MAX_REFRESH_SYMBOLS).optional().describe('Hard cap for this warm-up (1..500). Default 200 for a universe, all supplied ids otherwise.'),
          }).strict(),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input) => {
            const jobs = requireJobs();
            if (!jobs) return { output: typedFailure('CACHE_REFRESH_UNAVAILABLE', 'The bounded job runner is unavailable, so a background warm-up cannot start. Use get_price_history or check_symbol for individual symbols instead.') };
            if (jobs.supportsCacheJobs === false) {
              return { output: typedFailure('CACHE_REFRESH_UNAVAILABLE', 'This job runner does not support cache warm-up jobs (kind:cache). Use get_price_history or check_symbol for individual symbols instead.') };
            }
            let symbolIds: number[] | undefined;
            if (input.symbolIds?.length) {
              const resolved: number[] = [];
              for (const raw of input.symbolIds) {
                const item = resolveSymbol(raw);
                if (!item.symbol) return { output: typedFailure('UNKNOWN_SYMBOL', item.error ?? 'Unknown symbol.') };
                if (!resolved.includes(item.symbol.id)) resolved.push(item.symbol.id);
              }
              symbolIds = resolved;
            }
            const universe = symbolIds ? null : normalizeUniverse(input.universe, 'NIFTY_50');
            if (!symbolIds && !universe) return { output: typedFailure('UNKNOWN_UNIVERSE', 'Unknown universe. Use list_universes to see the valid ids.') };
            const symbols = symbolIds
              ? symbolIds.map(id => { try { return getSymbolById(id); } catch { return undefined; } }).filter((symbol): symbol is SymbolMeta => Boolean(symbol))
              : universeSymbols(universe!);
            const total = Math.max(0, Math.min(
              symbols.length,
              input.maxSymbols ?? (symbolIds ? symbols.length : DEFAULT_REFRESH_SYMBOLS),
              MAX_REFRESH_SYMBOLS,
            ));
            if (!total) return { output: typedFailure('CACHE_REFRESH_EMPTY', 'No configured symbols matched that request.') };
            const cached = symbolIds
              ? (() => {
                const count = emptyCacheCount(total);
                for (const symbol of symbols.slice(0, total)) if (!addCoverage(count, symbol.id)) return null;
                return count;
              })()
              : countCachedWindow(symbols, total);
            const estimatedSeconds = cached ? estimatedScanSeconds(total, cached.cached) : coldScanSeconds(total);
            try {
              const job = jobs.enqueue(universe
                ? { kind: 'cache', universe, maxSymbols: total }
                : { kind: 'cache', symbolIds: symbols.slice(0, total).map(symbol => symbol.id), maxSymbols: total });
              return {
                output: {
                  status: 'queued',
                  kind: 'cache',
                  jobId: job.id,
                  jobStatus: job.status,
                  universe: universe ?? null,
                  total,
                  estimatedSeconds,
                  ...(symbolIds && symbolIds.length > total ? { droppedSymbols: symbolIds.length - total } : {}),
                  cacheCoverage: {
                    cached: cached?.cached ?? null, total,
                    estimatedSeconds,
                    coldSeconds: coldScanSeconds(total),
                    warmSeconds: warmScanSeconds(total),
                    note: 'The estimate is not a promise; Angel pacing and provider throttles can make it longer.',
                  },
                  note: 'The warm-up runs in the background and never blocks this chat. Call get_refresh_result with this jobId for real progress; do not write a progress paragraph between polls.',
                },
              };
            } catch (error) {
              return { output: typedFailure('CACHE_REFRESH_UNAVAILABLE', (error as Error).message || 'The cache warm-up could not be queued on this job runner.') };
            }
          },
        });

        editor.add({
          name: 'get_refresh_result',
          description: 'Read a cache warm-up job started by refresh_market_data. Waits up to 24 seconds by default, then reports real progress so you can call again.',
          input: z.object({
            jobId: z.string().min(1).max(100),
            waitSeconds: z.number().int().min(5).max(45).optional().describe('How long to wait before returning progress (5..45, default 24).'),
          }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input) => {
            const deps = getDeps();
            const jobs = requireJobs();
            if (!jobs) return { output: typedFailure('CACHE_REFRESH_UNAVAILABLE', 'The bounded job runner is unavailable.') };
            const budget = Math.min((input.waitSeconds ?? 24) * 1000, deps.pollBudgetCapMs ?? Number.POSITIVE_INFINITY);
            const job = await pollJob(jobs, input.jobId, budget, deps.pollIntervalMs);
            if ('missing' in job) return { output: typedFailure('JOB_NOT_FOUND', 'That warm-up job is unknown or has expired. Queue it again with refresh_market_data.') };
            if (job.status === 'succeeded') return { output: refreshSummary(job) };
            if (['failed', 'cancelled', 'interrupted'].includes(job.status)) return { output: jobFailure(job) };
            const progress = jobProgress(job);
            return {
              output: {
                status: 'running', jobId: job.id, kind: 'cache', stage: job.stage,
                ...progress,
                note: 'Do not narrate each poll; call get_refresh_result again immediately with the same jobId.',
                ...(progress.estimatedSecondsRemaining === null ? { etaNote: 'No ETA because there is not enough measured progress yet.' } : {}),
              },
            };
          },
        });

        editor.add({
          name: 'list_indicators',
          description: 'List the indicator types the strategy engine supports, with params, constraints, outputs and a copyable example.',
          input: z.object({}).strict(),
          output: outputSchema,
          options: { codemode: false },
          execute: async () => ({
            output: {
              status: 'ok',
              priceSeries: [...RESERVED_SERIES],
              indicators: Object.entries(INDICATOR_REGISTRY).map(([type, definition]) => ({
                type, defaults: 'defaults' in definition ? definition.defaults : {}, outputs: definition.outputs, unit: definition.unit,
                params: INDICATOR_DOCS[type]?.constraints ?? 'see strategy schema',
                example: INDICATOR_DOCS[type]?.example ?? null,
              })),
              note: 'Indicators are declared on the strategy, then referenced by id in rules (for example leftIndicator: "rsi14").',
            },
          }),
        });

        editor.add({
          name: 'search_symbols',
          description: 'Search the configured NSE/BSE catalog by ticker, company name or sector. Returns metadata only, never prices.',
          input: z.object({ query: z.string().trim().min(1).max(80), exchange: z.enum(['NSE', 'BSE']).optional(), limit: z.number().int().min(1).max(MAX_SEARCH).optional() }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input) => {
            const query = input.query.toLowerCase();
            const matches = ALL_SYMBOLS.filter(symbol => (!input.exchange || symbol.exchange === input.exchange)
              && (symbol.ticker.toLowerCase().includes(query) || symbol.name.toLowerCase().includes(query) || (symbol.sector ?? '').toLowerCase().includes(query)));
            const limit = Math.min(input.limit ?? 15, MAX_SEARCH);
            return {
              output: {
                status: 'ok', query: input.query, totalMatched: matches.length, returned: Math.min(matches.length, limit),
                dropped: Math.max(0, matches.length - limit),
                symbols: matches.slice(0, limit).map(symbol => ({ id: symbol.id, ticker: symbol.ticker, name: symbol.name, exchange: symbol.exchange, sector: symbol.sector, indices: symbol.indices ?? [] })),
                note: matches.length > limit ? 'Showing the first ' + limit + ' matches; refine the query for the rest.' : undefined,
              },
            };
          },
        });

        editor.add({
          name: 'get_symbol_info',
          description: 'Get one catalog symbol by ticker or numeric id: name, exchange, sector and universe memberships. No price data.',
          input: z.object({ symbol: symbolInput }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input) => {
            const resolved = resolveSymbol(input.symbol);
            if (!resolved.symbol) return { output: typedFailure('UNKNOWN_SYMBOL', resolved.error ?? 'Unknown symbol.') };
            const symbol = resolved.symbol;
            return { output: { status: 'ok', symbol: { id: symbol.id, ticker: symbol.ticker, name: symbol.name, exchange: symbol.exchange, sector: symbol.sector, indices: symbol.indices ?? [] }, note: 'Catalog metadata only. Use get_quote or get_price_history for observed prices.' } };
          },
        });

        // -------------------------------------------------------------------- data
        editor.add({
          name: 'get_quote',
          description: 'Latest observed daily close (and a live LTP when the server has Angel One quotes) for up to 20 symbols, with source and freshness. Never a guessed price.',
          input: z.object({ symbols: z.array(symbolInput).min(1).max(MAX_QUOTE_SYMBOLS) }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input) => {
            const deps = getDeps();
            const load = deps.loadSeries ?? loadMarketSeries;
            const resolved: SymbolMeta[] = [];
            const errors: { symbol: string; code: string; message: string }[] = [];
            for (const raw of input.symbols) {
              const item = resolveSymbol(raw);
              if (item.symbol) resolved.push(item.symbol);
              else errors.push({ symbol: String(raw), code: 'UNKNOWN_SYMBOL', message: item.error ?? 'Unknown symbol.' });
            }
            let live: Awaited<ReturnType<typeof getLiveQuotes>> | null = null;
            if (resolved.length && (process.env.QUOTES_PROVIDER ?? 'none') === 'angel') {
              try { live = await getLiveQuotes(resolved.map(symbol => symbol.id)); } catch { live = null; }
            }
            const quotes: Record<string, unknown>[] = [];
            const deadline = Date.now() + 20_000;
            for (const symbol of resolved) {
              if (Date.now() > deadline) { errors.push({ symbol: symbol.ticker, code: 'DEADLINE_REACHED', message: 'Stopped before this symbol; retry it separately.' }); continue; }
              try {
                const series = await load(symbol.id, { mode: deps.dataMode });
                const last = series.bars.at(-1);
                if (!last) throw new Error('No bars');
                const liveQuote = live?.quotes.find(quote => quote.symbolId === symbol.id);
                const previous = series.bars.at(-2);
                quotes.push({
                  symbolId: symbol.id, ticker: symbol.ticker, exchange: symbol.exchange,
                  lastDate: last.date, close: last.close,
                  changePercent: previous && previous.close > 0 ? Math.round(((last.close - previous.close) / previous.close) * 10000) / 100 : null,
                  closeBasis: 'latest-observed-daily-close',
                  ...(liveQuote ? { liveLtp: liveQuote.ltp, liveChangePercent: liveQuote.changePercent, liveTimestamp: liveQuote.exchangeTimestamp, liveBasis: 'live-quote' } : {}),
                  source: series.provenance.source, sourceKind: sourceKind(series.provenance),
                  freshness: series.provenance.freshness, asOf: series.provenance.asOf,
                  cache: cacheEvidence(series.provenance),
                  delayed: true,
                });
              } catch (error) {
                errors.push({ symbol: symbol.ticker, code: (error as { code?: string }).code ?? 'QUOTE_UNAVAILABLE', message: (error as Error).message || 'Daily bars unavailable.' });
              }
            }
            return {
              output: {
                status: errors.length && !quotes.length ? 'failed' : errors.length ? 'partial' : 'ok',
                quotes, errors: errors.slice(0, 25),
                ...(live ? { live: { available: live.available, delay: live.delay, reason: live.reason?.message } } : {}),
                note: quotes.length ? 'close is the latest observed daily close (delayed/end-of-day), never a live price; liveLtp is a live quote only when present. Equity quotes are in INR.' : 'No observed price was available; nothing was invented.',
              },
            };
          },
        });

        editor.add({
          name: 'get_price_history',
          description: 'Daily OHLCV history for one symbol: a summary, provenance, and the last 30 bars. Lookback is capped at 750 sessions.',
          input: z.object({ symbol: symbolInput, lookbackDays: z.number().int().min(5).max(MAX_HISTORY_DAYS).optional() }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input) => {
            const deps = getDeps();
            const load = deps.loadSeries ?? loadMarketSeries;
            const resolved = resolveSymbol(input.symbol);
            if (!resolved.symbol) return { output: typedFailure('UNKNOWN_SYMBOL', resolved.error ?? 'Unknown symbol.') };
            const symbol = resolved.symbol;
            try {
              const series = await load(symbol.id, { mode: deps.dataMode });
              const lookback = Math.min(input.lookbackDays ?? 120, MAX_HISTORY_DAYS);
              const window = series.bars.slice(-lookback);
              const first = window[0], last = window.at(-1);
              if (!first || !last) return { output: typedFailure('NO_HISTORY', 'No daily bars are available for this symbol.') };
              return {
                output: {
                  status: 'ok',
                  symbol: { id: symbol.id, ticker: symbol.ticker, name: symbol.name, exchange: symbol.exchange },
                  summary: {
                    sessions: window.length, firstDate: first.date, lastDate: last.date,
                    firstClose: first.close, lastClose: last.close,
                    changePercent: first.close > 0 ? Math.round(((last.close - first.close) / first.close) * 10000) / 100 : null,
                    highestHigh: Math.max(...window.map(bar => bar.high)), lowestLow: Math.min(...window.map(bar => bar.low)),
                  },
                  bars: window.slice(-MAX_HISTORY_BARS).map(bar => ({ date: bar.date, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume })),
                  droppedBars: Math.max(0, window.length - MAX_HISTORY_BARS),
                  source: series.provenance.source,
                  sourceKind: sourceKind(series.provenance),
                  freshness: series.provenance.freshness,
                  cache: cacheEvidence(series.provenance),
                  provenance: { ...series.provenance, warnings: (series.provenance.warnings ?? []).slice(0, 5) },
                  note: 'The bars are the observed daily series used by the research engine. No intraday data is available.',
                },
              };
            } catch (error) {
              return { output: typedFailure((error as { code?: string }).code ?? 'HISTORY_UNAVAILABLE', (error as Error).message || 'Daily bars unavailable.') };
            }
          },
        });

        editor.add({
          name: 'compute_indicators',
          description: 'Compute up to 8 indicators on one symbol\'s observed daily bars. Returns the latest value and the last 5 values per series; null is honest missing warmup.',
          input: z.object({ symbol: symbolInput, indicators: z.union([z.array(IndicatorConfigSchema).min(1).max(MAX_INDICATORS), z.string().max(20_000)]) }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input) => {
            const deps = getDeps();
            const load = deps.loadSeries ?? loadMarketSeries;
            const resolved = resolveSymbol(input.symbol);
            if (!resolved.symbol) return { output: typedFailure('UNKNOWN_SYMBOL', resolved.error ?? 'Unknown symbol.') };
            const symbol = resolved.symbol;
            const parsedIndicators = z.array(IndicatorConfigSchema).min(1).max(MAX_INDICATORS).safeParse(coerceJson(input.indicators));
            if (!parsedIndicators.success) return { output: typedFailure('INVALID_INDICATORS', 'Indicators must be an array of indicator objects: ' + parsedIndicators.error.issues.map(issue => issue.path.join('.') + ': ' + issue.message).slice(0, 4).join('; ')) };
            const indicators = parsedIndicators.data;
            try {
              const series = await load(symbol.id, { mode: deps.dataMode });
              const computed = calculateAllIndicators(series.bars, indicators as never);
              const index = series.bars.length - 1;
              const last = series.bars[index];
              const seriesRows = indicators.flatMap(indicator => {
                const names = Object.keys(computed).filter(key => key === indicator.id || key.startsWith(indicator.id + '_'));
                return names.map(name => ({
                  indicatorId: indicator.id, type: indicator.type, series: name,
                  latest: finite(computed[name]?.[index]),
                  recent: [4, 3, 2, 1, 0].map(offset => finite(computed[name]?.[index - offset])),
                  dates: [4, 3, 2, 1, 0].map(offset => series.bars[index - offset]?.date ?? null),
                }));
              });
              return {
                output: {
                  status: 'ok', symbol: { id: symbol.id, ticker: symbol.ticker }, lastDate: last?.date ?? null, lastClose: last?.close ?? null,
                  indicators: seriesRows, barsUsed: series.bars.length,
                  source: series.provenance.source,
                  sourceKind: sourceKind(series.provenance),
                  freshness: series.provenance.freshness,
                  cache: cacheEvidence(series.provenance),
                  provenance: { source: series.provenance.source, freshness: series.provenance.freshness, asOf: series.provenance.asOf, cache: cacheEvidence(series.provenance) },
                  note: 'Values use completed daily bars only. Warmup or missing data is null, never zero-filled.',
                },
              };
            } catch (error) {
              return { output: typedFailure((error as { code?: string }).code ?? 'INDICATOR_FAILED', (error as Error).message || 'Indicators could not be computed.') };
            }
          },
        });

        editor.add({
          name: 'market_overview',
          description: 'Queue a bounded market snapshot for a universe (breadth, top movers, coverage). Returns a jobId when cold; call get_market_result with it.',
          input: z.object({ universe: z.string().max(40).optional(), asOf: dateString.optional() }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input) => {
            const deps = getDeps();
            const jobs = requireJobs();
            if (!jobs) return { output: typedFailure('JOB_RUNNER_UNAVAILABLE', 'Market snapshots require the bounded job runner.') };
            const universe = normalizeUniverse(input.universe, undefined);
            if (!universe) return { output: typedFailure('UNKNOWN_UNIVERSE', 'Unknown universe. Use list_universes.') };
            try {
              const job = jobs.enqueue({ kind: 'market', universe, ...(input.asOf ? { asOf: input.asOf } : {}), mode: deps.dataMode });
              return { output: { status: 'queued', kind: 'market', jobId: job.id, universe, note: 'Call get_market_result with this jobId; a running answer means call again.' } };
            } catch (error) {
              return { output: typedFailure('MARKET_ENQUEUE_FAILED', (error as Error).message || 'The market snapshot could not be queued.') };
            }
          },
        });

        editor.add({
          name: 'get_market_result',
          description: 'Read a market snapshot started by market_overview. Waits up to 24 seconds, then reports running so you can call again.',
          input: z.object({ jobId: z.string().min(1).max(100) }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input) => {
            const jobs = requireJobs();
            if (!jobs) return { output: typedFailure('JOB_RUNNER_UNAVAILABLE', 'Market snapshots require the bounded job runner.') };
            const job = await pollJob(jobs, input.jobId);
            if ('missing' in job) return { output: typedFailure('JOB_NOT_FOUND', 'That market job is unknown or has expired.') };
            if (job.status === 'succeeded') {
              const result = job.result as {
                universe?: string; coverage?: { requested?: number; succeeded?: number; unavailable?: number };
                trends?: { ticker?: string; changePercent?: number; trendLabel?: string }[];
                movers?: { topGainers?: unknown[]; topLosers?: unknown[]; marketBreadth?: unknown };
                sourceCoverage?: Record<string, number>; warnings?: string[]; status?: string; observationDates?: unknown; deadline?: unknown;
              } | undefined;
              const trends = [...(result?.trends ?? [])].sort((a, b) => (finite(b.changePercent) ?? 0) - (finite(a.changePercent) ?? 0));
              return {
                output: {
                  status: 'succeeded', jobId: job.id, kind: 'market', universe: result?.universe,
                  coverage: result?.coverage, coverageStatus: result?.status, observationDates: result?.observationDates,
                  breadth: result?.movers?.marketBreadth ?? {
                    advances: (result?.trends ?? []).filter(item => (finite(item.changePercent) ?? 0) > 0).length,
                    declines: (result?.trends ?? []).filter(item => (finite(item.changePercent) ?? 0) < 0).length,
                  },
                  topGainers: trends.slice(0, 5).map(item => ({ ticker: item.ticker, changePercent: item.changePercent, trend: item.trendLabel })),
                  topLosers: trends.slice(-5).reverse().map(item => ({ ticker: item.ticker, changePercent: item.changePercent, trend: item.trendLabel })),
                  sourceCoverage: result?.sourceCoverage,
                  warnings: (result?.warnings ?? []).slice(0, 8),
                  ...(result?.deadline ? { deadline: result.deadline } : {}),
                  note: 'This snapshot is observed daily data, may be partial, and is rendered in the market UI.',
                },
              };
            }
            if (['failed', 'cancelled', 'interrupted'].includes(job.status)) return { output: jobFailure(job) };
            return { output: { status: 'running', jobId: job.id, kind: 'market', ...(job.progress ? { progress: job.progress } : {}), note: 'The snapshot is still building. Call get_market_result again.' } };
          },
        });

        // ---------------------------------------------------------------- screening
        editor.add({
          name: 'check_symbol',
          description: 'Evaluate conditions against one symbol\'s observed daily bars without scanning a universe. Returns each condition with the actual value and pass/fail. Use this to sanity-check a rule before a full scan.',
          input: z.object({
            symbol: symbolInput,
            conditions: z.union([z.array(RuleNodeSchema).min(1).max(MAX_CONDITIONS), z.string().max(20_000)]).optional().describe('Rules to check. Defaults to the current strategy entry rules. A JSON-string array is also accepted.'),
            strategy: z.unknown().optional().describe('Optional complete strategy that supplies indicators and default conditions.'),
          }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input, toolContext) => {
            const deps = getDeps();
            const load = deps.loadSeries ?? loadMarketSeries;
            const resolved = resolveSymbol(input.symbol);
            if (!resolved.symbol) return { output: typedFailure('UNKNOWN_SYMBOL', resolved.error ?? 'Unknown symbol.') };
            const picked = input.strategy !== undefined
              ? strategyFrom(input.strategy, sessionStrategy(deps, toolContext.sessionID)?.strategy)
              : { strategy: sessionStrategy(deps, toolContext.sessionID)?.strategy };
            if (!picked.strategy) return { output: typedFailure('STRATEGY_REQUIRED', 'A current strategy or explicit conditions are required.') };
            const rawConditions = coerceJson(input.conditions) ?? picked.strategy.rules.entry;
            const parsedConditions = z.array(RuleNodeSchema).min(1).max(MAX_CONDITIONS).safeParse(rawConditions);
            if (!parsedConditions.success) return { output: typedFailure('INVALID_CONDITIONS', 'Conditions must be an array of rule objects: ' + parsedConditions.error.issues.map(issue => issue.path.join('.') + ': ' + issue.message).slice(0, 4).join('; ')) };
            const rules = parsedConditions.data;
            if (!rules.length) return { output: typedFailure('NO_CONDITIONS', 'The strategy has no entry rules to check.') };
            try {
              const series = await load(resolved.symbol.id, { mode: deps.dataMode });
              const computed = calculateAllIndicators(series.bars, picked.strategy.indicators as never);
              const lines = evaluateConditions(rules, computed, series.bars);
              const last = series.bars.at(-1);
              return {
                output: {
                  status: 'ok', symbol: { id: resolved.symbol.id, ticker: resolved.symbol.ticker, name: resolved.symbol.name },
                  lastDate: last?.date ?? null, lastClose: last?.close ?? null, barsUsed: series.bars.length,
                  matched: lines.every(line => line.matched), conditions: lines,
                  source: series.provenance.source,
                  sourceKind: sourceKind(series.provenance),
                  freshness: series.provenance.freshness,
                  cache: cacheEvidence(series.provenance),
                  provenance: { source: series.provenance.source, freshness: series.provenance.freshness, asOf: series.provenance.asOf, cache: cacheEvidence(series.provenance), warnings: (series.provenance.warnings ?? []).slice(0, 5) },
                  note: 'Conditions are evaluated on the latest completed daily bar. The scan uses the same predicate.',
                },
              };
            } catch (error) {
              return { output: typedFailure((error as { code?: string }).code ?? 'CHECK_FAILED', (error as Error).message || 'The symbol could not be checked.') };
            }
          },
        });

        editor.add({
          name: 'explain_match',
          description: 'Explain why a symbol matched or missed a finished scan job, using the per-condition diagnostics the scan retained.',
          input: z.object({ jobId: z.string().min(1).max(100), symbol: symbolInput }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input) => {
            const jobs = requireJobs();
            if (!jobs) return { output: typedFailure('JOB_RUNNER_UNAVAILABLE', 'Scan jobs are unavailable on this server.') };
            const resolved = resolveSymbol(input.symbol);
            if (!resolved.symbol) return { output: typedFailure('UNKNOWN_SYMBOL', resolved.error ?? 'Unknown symbol.') };
            const job = jobs.get(input.jobId);
            if (!job) return { output: typedFailure('JOB_NOT_FOUND', 'That scan job is unknown or has expired.') };
            if (job.status !== 'succeeded') return { output: { status: 'not_ready', jobId: job.id, jobStatus: job.status, note: 'Wait for the scan to finish, then ask again.' } };
            const result = job.result as {
              matches?: { symbolId: number; ticker: string; lastClose: number; lastDate: string; score?: number; matchedRules?: unknown[]; unmatchedRules?: unknown[]; indicatorValues?: Record<string, number> }[];
              nearMatches?: { symbolId: number; ticker: string; lastClose: number; lastDate: string; score?: number; matchedRules?: unknown[]; unmatchedRules?: unknown[]; indicatorValues?: Record<string, number> }[];
              requested?: number; succeeded?: number; unavailable?: number; failed?: number;
            } | undefined;
            const match = (result?.matches ?? []).find(item => item.symbolId === resolved.symbol!.id || item.ticker?.toUpperCase() === resolved.symbol!.ticker.toUpperCase());
            const near = (result?.nearMatches ?? []).find(item => item.symbolId === resolved.symbol!.id || item.ticker?.toUpperCase() === resolved.symbol!.ticker.toUpperCase());
            const found = match ?? near;
            if (!found) {
              return {
                output: {
                  status: 'not_in_scan', jobId: job.id, symbol: resolved.symbol.ticker,
                  coverage: { requested: result?.requested, succeeded: result?.succeeded, unavailable: result?.unavailable, failed: result?.failed },
                  note: 'The scan result only retains matches and the top near-misses, so this symbol may not be retained. It is not evidence of no match. Use check_symbol with the same conditions for a direct answer.',
                },
              };
            }
            return {
              output: {
                status: match ? 'matched' : 'near_match', jobId: job.id, symbol: found.ticker,
                lastDate: found.lastDate, lastClose: found.lastClose, score: found.score,
                matchedRules: found.matchedRules ?? [], unmatchedRules: found.unmatchedRules ?? [], indicatorValues: found.indicatorValues ?? {},
                note: match ? 'This symbol satisfied every entry condition in the scan.' : 'This symbol was retained as a near-miss; the unmatched rules show what failed.',
              },
            };
          },
        });

        // ---------------------------------------------------------------- strategy
        editor.add({
          name: 'get_current_strategy',
          description: 'Return the workspace strategy the chat client last sent with a message. It is the source for exits, risk, sizing and costs.',
          input: z.object({}).strict(),
          output: outputSchema,
          options: { codemode: false },
          execute: async (_input, toolContext) => {
            const deps = getDeps();
            const picked = sessionStrategy(deps, toolContext.sessionID);
            return picked
              ? { output: { status: 'ok', source: picked.source, strategy: picked.strategy } }
              : { output: { status: 'unavailable', note: 'No workspace strategy has been sent in this session and none is saved. Ask the user to pick or build one; do not invent exits or sizing.' } };
          },
        });

        editor.add({
          name: 'validate_strategy',
          description: 'Validate a strategy AST with the same schema the engine executes. Returns errors, warnings and a short summary; never applies it.',
          input: z.object({ strategy: z.unknown() }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input) => {
            const validated = validateStrategy(coerceJson(input.strategy));
            if (!validated.success || !validated.data) {
              return { output: { status: 'invalid', errors: (validated.errors ?? ['Invalid strategy']).slice(0, 12), warnings: (validated.warnings ?? []).slice(0, 8) } };
            }
            const strategy = validated.data;
            return {
              output: {
                status: 'valid', warnings: (validated.warnings ?? []).slice(0, 8),
                summary: {
                  name: strategy.name, universe: strategy.universe, indicators: strategy.indicators.length,
                  entryRules: strategy.rules.entry.length, exitRules: strategy.rules.exit.length,
                  stopLoss: strategy.risk.stopLoss, positionSizing: strategy.risk.positionSizing,
                },
                strategy,
                note: 'Valid means executable by this build; it does not mean profitable or approved.',
              },
            };
          },
        });

        editor.add({
          name: 'list_strategy_templates',
          description: 'List built-in strategy templates with their full ASTs so you can adapt one instead of inventing JSON from scratch.',
          input: z.object({}).strict(),
          output: outputSchema,
          options: { codemode: false },
          execute: async () => ({
            output: {
              status: 'ok',
              templates: STRATEGY_TEMPLATES.slice(0, 10).map(template => ({
                id: template.id, name: template.name, category: template.category, description: template.description,
                suitability: template.suitability, expectedWinRate: template.expectedWinRate, strategy: template.strategy,
              })),
              dropped: Math.max(0, STRATEGY_TEMPLATES.length - 10),
              note: 'Templates are starting points, not recommendations. Exit, risk and cost fields are included and must be preserved.',
            },
          }),
        });

        editor.add({
          name: 'list_saved_strategies',
          description: 'List saved workspace strategies (id, revision, name, universe). Read-only.',
          input: z.object({}).strict(),
          output: outputSchema,
          options: { codemode: false },
          execute: async () => {
            const repository = getDeps().repository;
            if (!repository) return { output: typedFailure('STORAGE_UNAVAILABLE', 'Saved strategies are not available on this server.') };
            const saved = repository.listStrategies().slice(0, 20).map(item => ({
              id: item.id, revision: item.revision, name: item.strategy.name, universe: item.strategy.universe, updatedAt: item.updatedAt,
            }));
            return { output: { status: 'ok', strategies: saved, note: saved.length ? 'Use load_saved_strategy with an id to read the full AST.' : 'No strategies are saved in this workspace.' } };
          },
        });

        editor.add({
          name: 'load_saved_strategy',
          description: 'Load one saved workspace strategy by id (read-only). Returns the full AST and revision.',
          input: z.object({ id: z.string().min(1).max(100), revision: z.number().int().min(0).optional() }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input) => {
            const repository = getDeps().repository;
            if (!repository) return { output: typedFailure('STORAGE_UNAVAILABLE', 'Saved strategies are not available on this server.') };
            const record = repository.getStrategy(input.id, input.revision);
            if (!record) return { output: typedFailure('STRATEGY_NOT_FOUND', 'No saved strategy has that id/revision.') };
            return { output: { status: 'ok', id: record.id, revision: record.revision, updatedAt: record.updatedAt, strategy: record.strategy } };
          },
        });

        editor.add({
          name: 'save_strategy',
          description: 'Apply a reviewed strategy draft by persisting it with the same validator the engine uses. A new name is saved; an existing name requires confirm:true so nothing is overwritten silently. The OpenCode UI asks for native permission before forwarding this call.',
          input: z.object({
            strategy: z.unknown().describe('The complete validated strategy AST to save.'),
            name: z.string().trim().min(1).max(200).optional().describe('Override the strategy name; defaults to the AST name.'),
            confirm: z.boolean().optional().describe('Set true to overwrite an existing strategy with the same name.'),
          }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input) => {
            const deps = getDeps();
            const repository = deps.repository;
            if (!repository?.saveStrategy) return { output: typedFailure('STORAGE_UNAVAILABLE', 'Saving strategies is not available on this server.') };
            const validated = validateStrategy(coerceJson(input.strategy));
            if (!validated.success || !validated.data) {
              return { output: typedFailure('INVALID_STRATEGY', 'The strategy is invalid: ' + (validated.errors?.slice(0, 6).join('; ') ?? 'unknown validation error')) };
            }
            const name = input.name ?? validated.data.name;
            const existing = repository.listStrategies().find(item => item.strategy.name === name);
            // On a confirmed overwrite, keep the existing id so the repository
            // bumps that record's revision instead of creating a duplicate.
            const strategy = { ...validated.data, ...(existing ? { id: existing.id } : {}), name };
            if (existing && input.confirm !== true) {
              return { output: typedFailure('NEEDS_CONFIRM', 'A strategy named "' + name + '" already exists (id ' + existing.id + ', revision ' + existing.revision + '). Ask the operator to confirm before overwriting it.', { name, existingId: existing.id, existingRevision: existing.revision }) };
            }
            try {
              const record = existing
                ? await repository.saveStrategy(strategy, existing.revision)
                : await repository.saveStrategy(strategy);
              return { output: { status: 'saved', id: record.id, revision: record.revision, name: record.strategy.name } };
            } catch (error) {
              const failure = error as { code?: string; status?: number };
              return { output: typedFailure(failure.code ?? 'SAVE_STRATEGY_FAILED', (error as Error).message || 'The strategy could not be saved.') };
            }
          },
        });

        editor.add({
          name: 'propose_strategy_edit',
          description: 'Return a reviewed draft strategy change. It NEVER applies or saves the strategy and never scans or backtests. The UI shows it as a draft for the operator to accept.',
          input: z.object({
            candidate: z.unknown().describe('The complete candidate strategy after the edit.'),
            rationale: z.string().min(1).max(2000),
            changes: z.array(z.string().max(500)).max(30).optional(),
            warnings: z.array(z.string().max(500)).max(20).optional(),
          }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input) => {
            const validated = validateStrategy(coerceJson(input.candidate));
            if (!validated.success || !validated.data) {
              return { output: typedFailure('INVALID_STRATEGY', 'The candidate strategy is invalid: ' + (validated.errors?.slice(0, 6).join('; ') ?? 'unknown validation error')) };
            }
            const proposal = {
              schemaVersion: 2 as const, id: 'draft_' + randomUUID().replace(/-/g, '').slice(0, 18), status: 'draft' as const,
              createdAt: new Date().toISOString(), originatingRevision: null, method: 'external_ai' as const,
              provider: { name: 'OpenCode engine', model: null, aiGenerated: true },
              candidate: validated.data, rationale: input.rationale.slice(0, 2000),
              warnings: (input.warnings ?? []).slice(0, 20), changes: (input.changes ?? []).slice(0, 30),
              changeDetails: [], applied: false as const, executes: false as const,
            };
            return { output: { status: 'ok', kind: 'proposal', proposal, note: 'Draft only. Nothing was applied, saved, scanned or backtested.' } };
          },
        });

        // ---------------------------------------------------------------- backtest
        editor.add({
          name: 'run_backtest',
          description: 'Run the existing daily-bar backtest engine. Gated: without operator approval for these exact assumptions it returns approval_required with the review text. After approval, call again with the same strategy/options.',
          input: z.object({
            strategy: z.unknown(),
            asOf: dateString.optional(), start: dateString.optional(), end: dateString.optional(),
            initialCapital: z.number().finite().min(100).max(1_000_000_000).optional(),
            approvalToken: z.string().max(200).optional().describe('Only when the operator explicitly supplied one; normal approval is read from the session.'),
          }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input, toolContext) => {
            const deps = getDeps();
            const jobs = requireJobs();
            if (!jobs) return { output: typedFailure('JOB_RUNNER_UNAVAILABLE', 'Backtests are unavailable on this server.') };
            const picked = strategyFrom(input.strategy, sessionStrategy(deps, toolContext.sessionID)?.strategy);
            if (!picked.strategy) return { output: typedFailure('STRATEGY_REQUIRED', picked.error ?? 'A validated strategy is required.') };
            const strategy = picked.strategy;
            const options = { ...(input.asOf ? { asOf: input.asOf } : {}), ...(input.start ? { start: input.start } : {}), ...(input.end ? { end: input.end } : {}), ...(input.initialCapital !== undefined ? { initialCapital: input.initialCapital } : {}) };
            const assumptions = toAssumptions(strategy, options);
            const hash = assumptionsHash(assumptions);
            const lines = assumptionLines(strategy, options);
            const approved = input.approvalToken ? deps.approvals.consume(input.approvalToken, hash) : deps.approvals.consumeForSession(toolContext.sessionID, hash);
            if (!approved) {
              const pending = deps.approvals.createPending({ sessionId: toolContext.sessionID, tool: 'run_backtest', title: 'Run backtest: ' + strategy.name, summary: lines, assumptions });
              return {
                output: {
                  status: 'approval_required', approvalId: pending.id,
                  approval: { id: pending.id, tool: pending.tool, status: pending.status, title: pending.title, summary: pending.summary },
                  assumptions: lines,
                  note: 'State these assumptions in plain English, then wait for the operator to approve in the UI. Do not claim the backtest is running.',
                },
              };
            }
            if (!deps.prepareBacktest) return { output: typedFailure('BACKTEST_PREPARE_UNAVAILABLE', 'The backtest data window could not be prepared on this server.') };
            let payload: ResearchPayload;
            try { payload = await deps.prepareBacktest({ strategy, ...options }); }
            catch (error) { return { output: typedFailure((error as { code?: string }).code ?? 'BACKTEST_PREPARE_FAILED', (error as Error).message || 'The backtest data window could not be prepared.') }; }
            try {
              const job = jobs.enqueue(payload);
              return { output: { status: 'queued', kind: 'backtest', jobId: job.id, assumptions: lines, note: 'Call get_backtest_result with this jobId. It waits up to 24 seconds, then reports running so you can call again.' } };
            } catch (error) {
              return { output: typedFailure('BACKTEST_ENQUEUE_FAILED', (error as Error).message || 'The backtest could not be queued.') };
            }
          },
        });

        editor.add({
          name: 'get_backtest_result',
          description: 'Read a backtest job started by run_backtest. Waits up to 24 seconds, then reports running so you can call again. The UI renders the full metrics, equity curve and trades.',
          input: z.object({ jobId: z.string().min(1).max(100) }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input) => {
            const deps = getDeps();
            const jobs = requireJobs();
            if (!jobs) return { output: typedFailure('JOB_RUNNER_UNAVAILABLE', 'Backtests are unavailable on this server.') };
            const job = await pollJob(jobs, input.jobId);
            if ('missing' in job) return { output: typedFailure('JOB_NOT_FOUND', 'That backtest job is unknown or has expired. Run it again after review.') };
            if (job.status === 'succeeded') {
              if (job.kind === 'backtest' && deps.rememberRun) {
                try { await deps.rememberRun(job.result); } catch { /* the result is still returned; persistence is best effort */ }
              }
              return { output: backtestSummary(job) };
            }
            if (['failed', 'cancelled', 'interrupted'].includes(job.status)) return { output: jobFailure(job) };
            return { output: { status: 'running', jobId: job.id, kind: 'backtest', ...(job.progress ? { progress: job.progress } : {}), note: 'The backtest is still running. Call get_backtest_result again with the same jobId.' } };
          },
        });

        editor.add({
          name: 'list_jobs',
          description: 'List recent research jobs (scans, backtests, chart reads, cache refreshes) with their status, so a job started in an earlier or interrupted turn can be found and read with its result tool.',
          input: z.object({
            limit: z.number().int().min(1).max(50).optional().describe('How many recent jobs to return (1..50, default 10).'),
            status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted']).optional(),
          }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input) => {
            const jobs = requireJobs();
            if (!jobs?.listSummaries) return { output: typedFailure('JOB_LIST_UNAVAILABLE', 'This host cannot list past jobs.') };
            const rows = jobs.listSummaries({ limit: input.limit ?? 10, ...(input.status ? { status: input.status } : {}) });
            return {
              output: {
                status: 'ok',
                jobs: rows.map(row => ({
                  jobId: row.id, kind: row.kind, status: row.status, stage: row.stage,
                  ...(row.createdAt ? { createdAt: row.createdAt } : {}),
                  ...(row.progress ? { progress: row.progress } : {}),
                  ...(row.universe ? { universe: row.universe } : {}),
                })),
                note: rows.length ? 'Read a scan with get_scan_result, a backtest with get_backtest_result, a chart with get_chart_result and a cache refresh with get_refresh_result.' : 'No jobs matched.',
              },
            };
          },
        });

        // ---------------------------------------------------------------- memory
        editor.add({
          name: 'remember_preference',
          description: 'Remember one durable research preference for this session (for example risk tolerance or preferred universe). Stored as an OpenCode session instruction entry.',
          input: z.object({ key: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/), value: z.union([z.string().max(2000), z.number().finite(), z.boolean()]), note: z.string().max(500).optional() }),
          output: outputSchema,
          options: { codemode: false },
          execute: async (input, toolContext) => {
            if (!sessionApi) return { output: typedFailure('MEMORY_UNAVAILABLE', 'Session preferences are unavailable on this host.') };
            try {
              await sessionApi.instructions.entry.put({
                sessionID: toolContext.sessionID,
                key: 'stragy.preference.' + input.key,
                value: { value: input.value, ...(input.note ? { note: input.note } : {}), updatedAt: new Date().toISOString() },
              });
              return { output: { status: 'ok', key: input.key, note: 'Preference saved for this conversation. It is not a trading rule.' } };
            } catch (error) {
              return { output: typedFailure('MEMORY_WRITE_FAILED', (error as Error).message || 'The preference could not be saved.') };
            }
          },
        });

        editor.add({
          name: 'get_preferences',
          description: 'Read the durable research preferences saved for this session.',
          input: z.object({}).strict(),
          output: outputSchema,
          options: { codemode: false },
          execute: async (_input, toolContext) => {
            if (!sessionApi) return { output: typedFailure('MEMORY_UNAVAILABLE', 'Session preferences are unavailable on this host.') };
            try {
              const entries = await sessionApi.instructions.entry.list({ sessionID: toolContext.sessionID });
              const preferences = entries
                .filter(entry => entry.key.startsWith('stragy.preference.'))
                .map(entry => {
                  const value = entry.value && typeof entry.value === 'object' ? entry.value as Record<string, unknown> : {};
                  return { key: entry.key.slice('stragy.preference.'.length), value: value.value, ...(typeof value.note === 'string' ? { note: value.note } : {}), ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}) };
                });
              return { output: { status: 'ok', preferences, note: preferences.length ? 'These are the user\'s stated preferences, not validated trading rules.' : 'No preferences have been saved in this session.' } };
            } catch (error) {
              return { output: typedFailure('MEMORY_READ_FAILED', (error as Error).message || 'Preferences could not be read.') };
            }
          },
        });
      });
    },
  };
}
