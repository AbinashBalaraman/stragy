import { Worker } from 'node:worker_threads';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { BacktestResponse, OHLCVBar, StrategyAST } from '../../shared/strategy/types';
import type { ResearchChatResponse } from '../../shared/contracts/research-chat';
import type { BacktestOptions } from '../backtest/engine';
import type { UniverseScanResponse } from '../backtest/scanner';
import type { MarketSnapshot } from '../backtest/marketSnapshot';
import { plainScanFailure } from '../../shared/contracts/scan-availability';
import { JobStore, JobStoreError, type JobStoreRecord } from '../storage/jobsDb';
import type { CacheRefreshState } from '../data/marketCacheRefresh';
export interface BacktestPayload { kind?: 'backtest'; strategy: StrategyAST; bars: OHLCVBar[]; provenance?: unknown; options?: BacktestOptions; }
export interface ScanPayload { kind: 'scan'; strategy: StrategyAST; universe: string; asOf?: string; mode: 'demo' | 'real'; limit?: number; offset?: number; maxSymbols?: number; symbolOffset?: number; }
export interface MarketPayload { kind: 'market'; universe: string; asOf?: string; mode: 'demo' | 'real'; }
/** The image arrives as the validated data URL; the worker parses it inside its own thread. */
export interface ChartPayload { kind: 'chart'; image: string; hint?: string; currentStrategy?: StrategyAST; }
/** Cache-first warm-up. `runMarketCacheRefresh` owns symbol resolution and coverage. */
export interface CacheRefreshPayload { kind: 'cache'; universe?: string; symbolIds?: number[]; maxSymbols?: number; }
export type ResearchPayload = BacktestPayload | ScanPayload | MarketPayload | ChartPayload | CacheRefreshPayload;
export type ResearchResult = BacktestResponse | UniverseScanResponse | MarketSnapshot | ResearchChatResponse | CacheRefreshState;
/**
 * `interrupted` is a durable-only state: the process stopped before the job
 * finished. The payload is kept, the job is resumable, and it is never treated
 * as a failure the user has to re-submit by hand.
 */
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export interface ResearchJob {
  id: string;
  kind: 'backtest' | 'scan' | 'market' | 'chart' | 'cache';
  status: JobStatus;
  stage: string;
  createdAt: string;
  queuedBehind?: number;
  startedAt?: string;
  finishedAt?: string;
  progress?: { processed: number; total: number };
  result?: ResearchResult;
  error?: { code: string; message: string; retryable?: boolean };
  /** Set when a resumed job left the interrupted state. */
  resumedAt?: string;
  resumeCount?: number;
  /** Present only when a durable write failed; the live in-memory record still works. */
  persistence?: { durable: boolean; reason?: string };
}
/** Lifecycle-only row for GET /api/v2/jobs. Never includes a result payload. */
export interface JobSummary {
  id: string;
  kind: ResearchJob['kind'];
  status: JobStatus;
  stage: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress?: { processed: number; total: number };
  error?: ResearchJob['error'];
  /** True for an interrupted job whose stored payload can be re-enqueued. */
  resumable: boolean;
  universe?: string;
}
const MAX_JOB_SUMMARIES = 50;
const SUMMARY_SCAN_LIMIT = 200;
export class JobError extends Error { constructor(public code: string, message: string, public status = 422) { super(message); } }
type Lane = 'backtest' | 'scan' | 'chart';
interface JobRecord { job: ResearchJob; payload: ResearchPayload; hash: string; lane: Lane; controller: AbortController; stop?: () => Promise<void>; timer?: ReturnType<typeof setTimeout>; hardDeadlineAt?: number; }
export const SCAN_IDLE_MS = 90_000;
export const SCAN_HARD_CAP_MS = 600_000;
export const MARKET_SNAPSHOT_TTL_MS = 300_000;
/**
 * Chart analysis makes two bounded model passes with a 200 s total budget (see
 * VISION_TOTAL_BUDGET_MS), so the generic 90 s cap would kill every cold read.
 * The extra 10 s keeps the job alive while the worker finishes cleanly.
 */
export const CHART_JOB_MAX_MS = 210_000;
/** A chart data URL is already validated at the route; this only bounds the clone. */
const CHART_PAYLOAD_MAX_BYTES = 8_000_000;
/** Cache refresh carries at most a universe name and 500 ids. */
const CACHE_PAYLOAD_MAX_BYTES = 64 * 1024;
/** The typed reason every unfinished job carries after a restart. */
export const SERVER_RESTARTED_ERROR: NonNullable<ResearchJob['error']> = {
  code: 'SERVER_RESTARTED',
  message: 'The server restarted before this job finished. Resume it to continue.',
  retryable: true,
};
export const DEFAULT_JOBS_DB_PATH = path.resolve('.data/jobs/jobs.db');
type Executor = (payload: ResearchPayload, context: { signal: AbortSignal; progress: (stage: string, counts?: { processed: number; total: number }) => void }) => Promise<ResearchResult>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function canonical(v: unknown): unknown { return Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, canonical(value)])) : v; }
export class JobManager {
  private records = new Map<string, JobRecord>();
  private keys = new Map<string, { id: string; hash: string }>();
  private lanes: { [lane in Lane]: { queue: string[]; active: Set<string> } } = {
    backtest: { queue: [], active: new Set() },
    scan: { queue: [], active: new Set() },
    chart: { queue: [], active: new Set() },
  };
  private closed = false;
  private terminations = new Set<Promise<void>>();
  private snapshotCache = new Map<string, { at: number; job: ResearchJob }>();
  private store?: JobStore;
  /** What durability actually did at boot; reported by tests and the proof script. */
  readonly durability: { enabled: boolean; path?: string; error?: string; recovered: number } = { enabled: false, recovered: 0 };
  constructor(private options: {
    maxQueue?: number; maxMs?: number; chartMaxMs?: number; scanIdleMs?: number; scanHardCapMs?: number; maxRetained?: number; workers?: number; workerPath?: string; executor?: Executor;
    /** SQLite file for job records. Omit for `.data/jobs/jobs.db`; pass null to stay memory-only; tests default to memory-only. */
    dbPath?: string | null;
    /** Terminal rows kept in SQLite before the oldest are pruned. */
    maxPersisted?: number;
  } = {}) {
    const dbPath = options.dbPath === null
      ? undefined
      : options.dbPath ?? (process.env.NODE_ENV === 'test' ? undefined : DEFAULT_JOBS_DB_PATH);
    if (!dbPath) return;
    try {
      this.store = new JobStore(dbPath, { maxPersisted: options.maxPersisted });
      const recovered = this.recover();
      Object.assign(this.durability, { enabled: true, path: dbPath, recovered });
    } catch (error) {
      // Durable jobs are an upgrade, not a boot prerequisite: keep serving with
      // the in-memory cache and record the honest reason instead of crashing.
      const message = error instanceof Error ? error.message : 'The durable job store could not be opened.';
      Object.assign(this.durability, { enabled: false, path: dbPath, error: message });
      console.error(JSON.stringify({ event: 'job_store_unavailable', path: dbPath, message }));
      this.store = undefined;
    }
  }
  /** Rebuild the cache and the idempotency keys from SQLite; unfinished work becomes resumable. */
  private recover(): number {
    if (!this.store) return 0;
    let recovered = 0;
    for (const row of this.store.list()) {
      try {
        const record = this.recordFromRow(row);
        if (['queued', 'running'].includes(record.job.status)) {
          // The process that owned this work is gone. Never pretend it is still
          // running: typed interrupted state, payload preserved, resume offered.
          this.markInterrupted(record);
          this.persist(record);
          this.records.set(record.job.id, record);
        } else if (record.job.status === 'interrupted') {
          // Resume needs the payload; interrupted records stay in memory.
          this.records.set(record.job.id, record);
        } else if (['succeeded', 'failed', 'cancelled'].includes(record.job.status)) {
          // Terminal results are served lazily by get()/restore(): loading every
          // stored result at boot would hold the whole history in memory.
        } else {
          this.records.set(record.job.id, record);
        }
        recovered++;
      } catch (error) {
        console.error(JSON.stringify({ event: 'job_store_record_skipped', jobId: row.id, message: error instanceof Error ? error.message : String(error) }));
      }
    }
    for (const entry of this.store.keys()) this.keys.set(entry.key, { id: entry.jobId, hash: entry.hash });
    return recovered;
  }
  private recordFromRow(row: JobStoreRecord): JobRecord {
    const job: ResearchJob = {
      id: row.id,
      kind: row.kind as ResearchJob['kind'],
      status: row.status as JobStatus,
      stage: row.stage,
      createdAt: row.createdAt,
      ...(row.startedAt ? { startedAt: row.startedAt } : {}),
      ...(row.finishedAt ? { finishedAt: row.finishedAt } : {}),
      ...(row.queuedBehind !== undefined ? { queuedBehind: row.queuedBehind } : {}),
      ...(row.progress ? { progress: row.progress } : {}),
      ...(row.result !== undefined ? { result: row.result as ResearchResult } : {}),
      ...(row.error !== undefined ? { error: row.error as ResearchJob['error'] } : {}),
      ...(row.resumedAt ? { resumedAt: row.resumedAt } : {}),
      ...(row.resumeCount !== undefined ? { resumeCount: row.resumeCount } : {}),
    };
    return { job, payload: row.payload as ResearchPayload, hash: row.hash, lane: row.lane as Lane, controller: new AbortController() };
  }
  private markInterrupted(record: JobRecord): void {
    if (record.timer) { clearTimeout(record.timer); record.timer = undefined; }
    this.lanes[record.lane].queue = this.lanes[record.lane].queue.filter(id => id !== record.job.id);
    this.lanes[record.lane].active.delete(record.job.id);
    delete record.job.queuedBehind;
    delete record.job.progress;
    Object.assign(record.job, { status: 'interrupted' as const, stage: 'interrupted', finishedAt: new Date().toISOString(), error: { ...SERVER_RESTARTED_ERROR } });
  }
  /**
   * Write-through on every state transition. Payload JSON is written once on
   * enqueue/resume; progress updates only touch the small mutable columns.
   * A write failure never loses the live in-memory job; it is labelled instead.
   */
  private persist(record: JobRecord, payload: 'keep' | 'write' | 'clear' = 'keep'): void {
    const store = this.store;
    if (!store) return;
    const { job } = record;
    const save = (result: ResearchResult | undefined) => store.save({
      id: job.id, kind: job.kind, lane: record.lane, hash: record.hash, status: job.status, stage: job.stage,
      createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt,
      queuedBehind: job.queuedBehind, progress: job.progress, result, error: job.error,
      resumedAt: job.resumedAt, resumeCount: job.resumeCount,
      ...(payload === 'write' ? { payload: record.payload } : {}),
    }, { writePayload: payload === 'write', clearPayload: payload === 'clear' });
    try {
      save(job.result);
      delete job.persistence;
    } catch (error) {
      if (error instanceof JobStoreError && error.code === 'JOB_RECORD_TOO_LARGE' && job.result !== undefined) {
        // The live result stays available in this process; persist the honest
        // lifecycle without it and say why the record is not durable.
        job.persistence = { durable: false, reason: error.code };
        try { save(undefined); return; } catch { /* fall through to the generic label */ }
      }
      job.persistence = { durable: false, reason: error instanceof JobStoreError ? error.code : 'STORAGE_WRITE_FAILED' };
      console.error(JSON.stringify({ event: 'job_store_write_failed', jobId: job.id, code: job.persistence.reason, message: error instanceof Error ? error.message : String(error) }));
    }
  }
  enqueue(input: ResearchPayload, key?: string): ResearchJob {
    if (this.closed) throw new JobError('SHUTTING_DOWN', 'New jobs are disabled during shutdown.', 503);
    if (!input || typeof input !== 'object') throw new JobError('INVALID_JOB_INPUT', 'A normalized research payload is required.');
    const text = JSON.stringify(input);
    const isChart = input.kind === 'chart';
    const budget = isChart ? CHART_PAYLOAD_MAX_BYTES : input.kind === 'cache' ? CACHE_PAYLOAD_MAX_BYTES : 2_000_000;
    const invalidChart = isChart && (typeof input.image !== 'string' || !input.image.startsWith('data:image/'));
    if (Buffer.byteLength(text) > budget || invalidChart || ((!input.kind || input.kind === 'backtest') && (!Array.isArray(input.bars) || !input.bars.length || input.bars.length > 5000))) throw new JobError('JOB_BUDGET_EXCEEDED', 'Job input exceeds its validated budget.');
    const payload = clone(input);
    const hash = createHash('sha256').update(JSON.stringify(canonical({ ...payload, provenance: undefined }))).digest('hex');
    if (key && (key.length > 100 || !/^[A-Za-z0-9_.:-]+$/.test(key))) throw new JobError('INVALID_IDEMPOTENCY_KEY', 'Invalid idempotency key.');
    if (key) {
      // The key map is rebuilt from SQLite at boot; consult the store as well so
      // memory retention cannot forget a key that a retry still points at.
      if (!this.keys.has(key)) {
        try {
          const stored = this.store?.loadKey(key);
          if (stored) this.keys.set(key, { id: stored.jobId, hash: stored.hash });
        } catch (error) {
          console.error(JSON.stringify({ event: 'job_store_key_read_failed', message: error instanceof Error ? error.message : String(error) }));
        }
      }
      if (this.keys.has(key)) {
        const existing = this.keys.get(key)!;
        if (existing.hash !== hash) throw new JobError('IDEMPOTENCY_CONFLICT', 'The key was already used with different inputs.', 409);
        const record = this.records.get(existing.id) ?? this.restore(existing.id);
        if (record) return clone(record.job);
        this.keys.delete(key);
        try { this.store?.deleteKey(key); }
        catch (error) { console.error(JSON.stringify({ event: 'job_store_key_delete_failed', message: error instanceof Error ? error.message : String(error) })); }
      }
    }
    const kind = payload.kind ?? 'backtest';
    // Identical scans/cache warm-ups share one active job: a double-click, a
    // reload or a duplicate chat action must not queue a second cold download.
    if (kind === 'scan' || kind === 'cache') {
      const existing = [...this.records.values()].find(record =>
        record.job.kind === kind && record.hash === hash
        && (record.job.status === 'queued' || record.job.status === 'running'));
      if (existing) return clone(existing.job);
    }
    if (kind === 'market') {
      const cached = this.snapshotCache.get(hash);
      if (cached && Date.now() - cached.at < MARKET_SNAPSHOT_TTL_MS) {
        const id = randomUUID();
        const now = new Date().toISOString();
        const job: ResearchJob = { ...clone(cached.job), id, status: 'succeeded', stage: 'succeeded', createdAt: now, startedAt: now, finishedAt: now };
        const record: JobRecord = { job, payload: clone(payload), hash, lane: 'scan', controller: new AbortController() };
        this.records.set(id, record);
        this.persist(record);
        return clone(job);
      }
      if (cached) this.snapshotCache.delete(hash);
      const existing = [...this.records.values()].find(record =>
        record.job.kind === 'market' && record.hash === hash
        && (record.job.status === 'queued' || record.job.status === 'running'));
      if (existing) return clone(existing.job);
    }
    const queued = this.lanes.backtest.queue.length + this.lanes.scan.queue.length + this.lanes.chart.queue.length;
    if (queued >= (this.options.maxQueue ?? 8)) throw new JobError('QUEUE_FULL', 'Research queue is full. Retry later.', 429);
    const lane: Lane = kind === 'backtest' ? 'backtest' : kind === 'chart' ? 'chart' : 'scan';
    const id = randomUUID(), job: ResearchJob = { id, kind, status: 'queued', stage: 'waiting', createdAt: new Date().toISOString() };
    const record: JobRecord = { job, payload, hash, lane, controller: new AbortController() };
    this.records.set(id, record);
    if (key) {
      this.keys.set(key, { id, hash });
      try { this.store?.saveKey(key, id, hash); }
      catch (error) { console.error(JSON.stringify({ event: 'job_store_key_write_failed', jobId: id, message: error instanceof Error ? error.message : String(error) })); }
    }
    this.lanes[lane].queue.push(id);
    this.persist(record, 'write');
    this.refreshQueuePositions();
    this.dispatch();
    return clone(job);
  }
  /** Memory first, then the durable store so a restarted manager can still answer. */
  get(id: string): ResearchJob | undefined { const record = this.records.get(id) ?? this.restore(id); return record ? clone(record.job) : undefined; }
  /**
   * Recent job history for the management UI: newest first, capped at 50, and
   * without result or payload blobs. In-memory records win over stored rows so
   * a live status change is never hidden by an older durable copy.
   */
  listSummaries(input: { limit?: number; status?: JobStatus } = {}): JobSummary[] {
    const requested = input.limit === undefined || !Number.isFinite(input.limit) ? 20 : Math.trunc(input.limit);
    const limit = Math.min(MAX_JOB_SUMMARIES, Math.max(1, requested));
    const summaries = new Map<string, JobSummary>();
    const add = (job: ResearchJob, universe?: string) => {
      summaries.set(job.id, {
        id: job.id,
        kind: job.kind,
        status: job.status,
        stage: job.stage,
        createdAt: job.createdAt,
        ...(job.startedAt ? { startedAt: job.startedAt } : {}),
        ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
        ...(job.progress ? { progress: { ...job.progress } } : {}),
        ...(job.error ? { error: { ...job.error } } : {}),
        resumable: job.status === 'interrupted',
        ...(universe ? { universe } : {}),
      });
    };
    for (const record of this.records.values()) {
      const payload = record.payload as unknown as { universe?: unknown } | undefined;
      add(record.job, typeof payload?.universe === 'string' ? payload.universe : undefined);
    }
    if (this.store) {
      try {
        for (const row of this.store.listSummaries(SUMMARY_SCAN_LIMIT)) {
          if (summaries.has(row.id)) continue;
          add({
            id: row.id,
            kind: row.kind as ResearchJob['kind'],
            status: row.status as JobStatus,
            stage: row.stage,
            createdAt: row.createdAt,
            ...(row.startedAt ? { startedAt: row.startedAt } : {}),
            ...(row.finishedAt ? { finishedAt: row.finishedAt } : {}),
            ...(row.progress ? { progress: row.progress } : {}),
            ...(row.error !== undefined ? { error: row.error as ResearchJob['error'] } : {}),
          }, row.universe);
        }
      } catch (error) {
        console.error(JSON.stringify({ event: 'job_summary_read_failed', message: error instanceof Error ? error.message : String(error) }));
      }
    }
    return [...summaries.values()]
      .filter(summary => !input.status || summary.status === input.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  private restore(id: string): JobRecord | undefined {
    const known = this.records.get(id);
    if (known) return known;
    if (!this.store) return undefined;
    let row: JobStoreRecord | undefined;
    try { row = this.store.load(id); }
    catch (error) { console.error(JSON.stringify({ event: 'job_store_read_failed', jobId: id, message: error instanceof Error ? error.message : String(error) })); return undefined; }
    if (!row) return undefined;
    try {
      const record = this.recordFromRow(row);
      if (['succeeded', 'failed', 'cancelled'].includes(record.job.status)) record.payload = undefined as unknown as ResearchPayload;
      this.records.set(id, record);
      return record;
    } catch (error) {
      console.error(JSON.stringify({ event: 'job_store_record_skipped', jobId: id, message: error instanceof Error ? error.message : String(error) }));
      return undefined;
    }
  }
  cancel(id: string): ResearchJob | undefined {
    const record = this.records.get(id) ?? this.restore(id); if (!record) return undefined;
    if (record.job.status === 'interrupted') {
      // Cancelling interrupted work discards the stored payload so it cannot be
      // resumed later; the client's Cancel button is never a dead control.
      Object.assign(record.job, { status: 'cancelled' as const, stage: 'cancelled', finishedAt: new Date().toISOString(), error: { code: 'JOB_CANCELLED', message: 'Cancelled by the requester.' } });
      this.persist(record, 'clear');
      record.payload = undefined as unknown as ResearchPayload;
      return clone(record.job);
    }
    if (!['queued', 'running'].includes(record.job.status)) return clone(record.job);
    this.finish(record, 'cancelled', undefined, { code: 'JOB_CANCELLED', message: 'Cancelled by the requester.' });
    record.controller.abort(); return clone(record.job);
  }
  /**
   * Re-enqueue an interrupted job with the same id and payload. The safe path is
   * a fresh run: scan/market jobs re-read provider candles (the Yahoo provider's
   * disk cache still applies) and chart jobs re-run the bounded vision call
   * (the image is stored, the model answer is not).
   */
  resume(id: string): ResearchJob {
    if (this.closed) throw new JobError('SHUTTING_DOWN', 'New jobs are disabled during shutdown.', 503);
    const record = this.records.get(id) ?? this.restore(id);
    if (!record) throw new JobError('JOB_NOT_FOUND', 'Job not found.', 404);
    if (record.job.status !== 'interrupted') throw new JobError('JOB_NOT_RESUMABLE', 'Only interrupted jobs can be resumed.', 409);
    if (!record.payload) throw new JobError('JOB_PAYLOAD_LOST', 'The stored payload for this job is no longer available. Start a new job.', 409);
    const queued = this.lanes.backtest.queue.length + this.lanes.scan.queue.length + this.lanes.chart.queue.length;
    if (queued >= (this.options.maxQueue ?? 8)) throw new JobError('QUEUE_FULL', 'Research queue is full. Retry later.', 429);
    record.controller = new AbortController();
    record.stop = undefined;
    const now = new Date().toISOString();
    Object.assign(record.job, {
      status: 'queued' as const,
      stage: 'waiting',
      startedAt: undefined,
      finishedAt: undefined,
      queuedBehind: undefined,
      progress: undefined,
      error: undefined,
      resumedAt: now,
      resumeCount: (record.job.resumeCount ?? 0) + 1,
    });
    delete record.job.result;
    this.lanes[record.lane].queue.push(id);
    this.persist(record, 'write');
    this.refreshQueuePositions();
    this.dispatch();
    return clone(record.job);
  }
  private finish(record: JobRecord, status: 'succeeded' | 'failed' | 'cancelled', result?: ResearchResult, error?: ResearchJob['error']) {
    if (!['queued', 'running'].includes(record.job.status)) return;
    if (record.timer) clearTimeout(record.timer);
    // Membership and other scan-start rejections must reach the chat as the
    // same plain line the plan promised, never as internal provider text.
    if (error && (record.job.kind === 'scan' || record.job.kind === 'market' || record.job.kind === 'cache')) {
      const plain = plainScanFailure(error.code, error.message, 'universe' in record.payload ? record.payload.universe : undefined);
      if (plain) error = { ...error, message: plain };
    }
    Object.assign(record.job, { status, stage: status, finishedAt: new Date().toISOString(), ...(result ? { result: clone(result) } : {}), ...(error ? { error } : {}) });
    if (record.job.kind === 'market' && status === 'succeeded' && result) {
      // A deadline-truncated or empty snapshot is not a reusable answer: a retry
      // must be free to reach the provider again.
      const snapshot = result as MarketSnapshot;
      if (snapshot.status !== 'unavailable' && !snapshot.deadline?.truncated) this.snapshotCache.set(record.hash, { at: Date.now(), job: clone(record.job) });
    }
    this.lanes[record.lane].queue = this.lanes[record.lane].queue.filter(id => id !== record.job.id);
    this.refreshQueuePositions();
    // Terminal jobs are not resumable, so the durable copy drops the payload
    // (the live result stays in this process until retention trims it).
    this.persist(record, 'clear');
    // Release large request snapshots after work, keeping only immutable public result/status.
    record.payload = undefined as unknown as ResearchPayload;
    const terminal = [...this.records.values()].filter(r => !['queued', 'running', 'interrupted'].includes(r.job.status));
    while (terminal.length > (this.options.maxRetained ?? 20)) { const removed = terminal.shift()!; this.records.delete(removed.job.id); for (const [key, value] of this.keys) if (value.id === removed.job.id) this.keys.delete(key); }
    const release = () => { this.lanes[record.lane].active.delete(record.job.id); queueMicrotask(() => this.dispatch()); };
    if (record.stop) { const stopped = record.stop().catch(() => {}).then(release); this.terminations.add(stopped); void stopped.then(() => this.terminations.delete(stopped)); } else release();
  }
  private refreshQueuePositions(): void {
    for (const lane of Object.keys(this.lanes) as Lane[]) {
      this.lanes[lane].queue.forEach((id, index) => {
        const record = this.records.get(id);
        if (!record || record.job.status !== 'queued') return;
        record.job.stage = 'waiting';
        record.job.queuedBehind = this.lanes[lane].active.size + index;
        record.job.startedAt = undefined;
        this.persist(record);
      });
    }
  }

  private dispatch() {
    const perLane = Math.max(1, this.options.workers ?? 1);
    for (const lane of ['backtest', 'scan', 'chart'] as Lane[]) {
      while (!this.closed && this.lanes[lane].queue.length && this.lanes[lane].active.size < perLane) {
        const id = this.lanes[lane].queue.shift()!, record = this.records.get(id);
        if (!record || record.job.status !== 'queued') continue;
        this.lanes[lane].active.add(id);
        record.job.status = 'running';
        record.job.stage = 'simulation';
        record.job.startedAt = new Date().toISOString();
        delete record.job.queuedBehind;
        this.persist(record);
        // The deadline starts with the run, never with time spent in the lane queue.
        const timeout = () => {
          const message = record.job.kind === 'cache'
            ? 'The market data refresh took too long and was stopped. Try a smaller universe.'
            : record.lane === 'scan'
              ? 'The scan took too long and was stopped. Try again.'
              : record.lane === 'chart'
                ? 'The chart analysis took too long and was stopped. Try again.'
                : 'The backtest took too long and was stopped. Try again.';
          this.finish(record, 'failed', undefined, { code: 'JOB_TIMEOUT', message });
          record.controller.abort();
        };
        let armTimer = () => {
          record.timer = setTimeout(timeout, this.options.maxMs ?? 30000);
        };
        if (record.lane === 'chart') {
          // A single fixed cap: chart progress has no resumable milestones, and a
          // progress message must not extend the model budget.
          const cap = this.options.chartMaxMs ?? CHART_JOB_MAX_MS;
          armTimer = () => {
            if (record.timer) clearTimeout(record.timer);
            record.timer = setTimeout(timeout, cap);
          };
        } else if (record.lane === 'scan') {
          const hardCap = this.options.scanHardCapMs ?? SCAN_HARD_CAP_MS;
          const idle = this.options.scanIdleMs ?? SCAN_IDLE_MS;
          record.hardDeadlineAt = Date.now() + hardCap;
          armTimer = () => {
            if (record.timer) clearTimeout(record.timer);
            const remaining = Math.max(0, (record.hardDeadlineAt ?? 0) - Date.now());
            record.timer = setTimeout(timeout, Math.min(idle, remaining));
          };
        }
        armTimer();
        const progress = (stage: string, counts?: { processed: number; total: number }) => {
          if (record.job.status !== 'running') return;
          record.job.stage = stage.slice(0, 80);
          if (counts && Number.isFinite(counts.processed) && Number.isFinite(counts.total)) record.job.progress = { processed: counts.processed, total: counts.total };
          // Every real milestone is durable: after a restart the user sees the
          // last stage the job actually reached, never a fabricated percentage.
          this.persist(record);
          if (record.lane === 'scan') armTimer();
        };
        const work = Promise.resolve().then(() => { if (record.job.status !== 'running') throw new JobError('JOB_CANCELLED', 'Work cancelled before execution.'); return this.options.executor ? this.options.executor(record.payload, { signal: record.controller.signal, progress }) : this.runWorker(record, progress); });
        Promise.resolve(work).then(result => this.finish(record, 'succeeded', result), error => this.finish(record, 'failed', undefined, { code: error instanceof JobError ? error.code : 'WORKER_FAILED', message: error instanceof JobError ? error.message : 'The computation worker did not complete.' }));
      }
    }
    this.refreshQueuePositions();
  }
  private runWorker(record: JobRecord, progress: (stage: string, counts?: { processed: number; total: number }) => void): Promise<ResearchResult> {
    return new Promise((resolve, reject) => {
      let worker: Worker;
      let receivedTerminal = false;
      try { worker = new Worker(this.options.workerPath ?? path.resolve('dist/server/worker.cjs'), { workerData: record.payload, resourceLimits: { maxOldGenerationSizeMb: record.job.kind === 'chart' ? 256 : record.job.kind === 'market' || record.job.kind === 'cache' ? 192 : 128 }, execArgv: ['--preserve-symlinks', '--preserve-symlinks-main'] }); }
      catch { reject(new JobError('WORKER_UNAVAILABLE', 'Build the worker artifact before running jobs.', 503)); return; }
      record.stop = () => worker.terminate().then(() => {});
      worker.on('message', message => { if (message?.type === 'progress') progress(String(message.stage), typeof message.processed === 'number' && typeof message.total === 'number' ? { processed: message.processed, total: message.total } : undefined); else if (message?.type === 'result') { receivedTerminal = true; if (!message.result || typeof message.result !== 'object') reject(new JobError('WORKER_EMPTY_RESULT', 'Worker returned no research result.')); else resolve(message.result); } else if (message?.type === 'error') { receivedTerminal = true; reject(new JobError(String(message.code ?? 'SIMULATION_FAILED'), String(message.message ?? 'Simulation failed.').slice(0, 500))); } });
      worker.on('error', () => reject(new JobError('WORKER_CRASHED', 'Research worker crashed.')));
      worker.on('exit', () => { if (!receivedTerminal && record.job.status === 'running') reject(new JobError('WORKER_EXITED', 'Worker exited before returning a result.')); });
    });
  }
  async shutdown(): Promise<void> {
    if (this.closed) { await Promise.all([...this.terminations]); return; }
    this.closed = true;
    // A graceful restart is still a restart: keep unfinished work resumable
    // instead of burning it as "cancelled". Payloads stay in the durable store.
    for (const record of this.records.values()) {
      if (!['queued', 'running'].includes(record.job.status)) continue;
      this.markInterrupted(record);
      this.persist(record);
      record.controller.abort();
      if (record.stop) { const stopped = record.stop().catch(() => {}); this.terminations.add(stopped); void stopped.then(() => this.terminations.delete(stopped)); }
    }
    await Promise.all([...this.terminations]);
    this.store?.close();
    this.store = undefined;
  }
}
