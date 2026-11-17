import { Worker } from 'node:worker_threads';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { BacktestResponse, OHLCVBar, StrategyAST } from '../../shared/strategy/types';
import type { BacktestOptions } from '../backtest/engine';
import type { UniverseScanResponse } from '../backtest/scanner';
import type { MarketSnapshot } from '../backtest/marketSnapshot';
export interface BacktestPayload { kind?: 'backtest'; strategy: StrategyAST; bars: OHLCVBar[]; provenance?: unknown; options?: BacktestOptions; }
export interface ScanPayload { kind: 'scan'; strategy: StrategyAST; universe: string; asOf?: string; mode: 'demo' | 'real'; limit?: number; offset?: number; }
export interface MarketPayload { kind: 'market'; universe: string; asOf?: string; mode: 'demo' | 'real'; }
export type ResearchPayload = BacktestPayload | ScanPayload | MarketPayload;
export type ResearchResult = BacktestResponse | UniverseScanResponse | MarketSnapshot;
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export interface ResearchJob { id: string; kind: 'backtest' | 'scan' | 'market'; status: JobStatus; stage: string; createdAt: string; queuedBehind?: number; startedAt?: string; finishedAt?: string; result?: ResearchResult; error?: { code: string; message: string }; }
export class JobError extends Error { constructor(public code: string, message: string, public status = 422) { super(message); } }
type Lane = 'backtest' | 'scan';
interface JobRecord { job: ResearchJob; payload: ResearchPayload; hash: string; lane: Lane; controller: AbortController; stop?: () => Promise<void>; timer?: ReturnType<typeof setTimeout>; hardDeadlineAt?: number; }
export const SCAN_IDLE_MS = 90_000;
export const SCAN_HARD_CAP_MS = 300_000;
type Executor = (payload: ResearchPayload, context: { signal: AbortSignal; progress: (stage: string) => void }) => Promise<ResearchResult>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function canonical(v: unknown): unknown { return Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, canonical(value)])) : v; }
export class JobManager {
  private records = new Map<string, JobRecord>();
  private keys = new Map<string, { id: string; hash: string }>();
  private lanes: { [lane in Lane]: { queue: string[]; active: Set<string> } } = {
    backtest: { queue: [], active: new Set() },
    scan: { queue: [], active: new Set() },
  };
  private closed = false;
  private terminations = new Set<Promise<void>>();
  constructor(private options: { maxQueue?: number; maxMs?: number; scanIdleMs?: number; scanHardCapMs?: number; maxRetained?: number; workers?: number; workerPath?: string; executor?: Executor } = {}) {}
  enqueue(input: ResearchPayload, key?: string): ResearchJob {
    if (this.closed) throw new JobError('SHUTTING_DOWN', 'New jobs are disabled during shutdown.', 503);
    if (!input || typeof input !== 'object') throw new JobError('INVALID_JOB_INPUT', 'A normalized research payload is required.');
    const text = JSON.stringify(input);
    if (Buffer.byteLength(text) > 2_000_000 || (!input.kind || input.kind === 'backtest') && (!Array.isArray(input.bars) || !input.bars.length || input.bars.length > 5000)) throw new JobError('JOB_BUDGET_EXCEEDED', 'Job input exceeds its validated budget.');
    const payload = clone(input);
    const hash = createHash('sha256').update(JSON.stringify(canonical({ ...payload, provenance: undefined }))).digest('hex');
    if (key && (key.length > 100 || !/^[A-Za-z0-9_.:-]+$/.test(key))) throw new JobError('INVALID_IDEMPOTENCY_KEY', 'Invalid idempotency key.');
    if (key && this.keys.has(key)) { const existing = this.keys.get(key)!; if (existing.hash !== hash) throw new JobError('IDEMPOTENCY_CONFLICT', 'The key was already used with different inputs.', 409); const record = this.records.get(existing.id); if (record) return clone(record.job); this.keys.delete(key); }
    const queued = this.lanes.backtest.queue.length + this.lanes.scan.queue.length;
    if (queued >= (this.options.maxQueue ?? 8)) throw new JobError('QUEUE_FULL', 'Research queue is full. Retry later.', 429);
    const kind = payload.kind ?? 'backtest';
    const lane: Lane = kind === 'backtest' ? 'backtest' : 'scan';
    const id = randomUUID(), job: ResearchJob = { id, kind, status: 'queued', stage: 'waiting', createdAt: new Date().toISOString() };
    this.records.set(id, { job, payload, hash, lane, controller: new AbortController() });
    if (key) this.keys.set(key, { id, hash });
    this.lanes[lane].queue.push(id);
    this.refreshQueuePositions();
    this.dispatch();
    return clone(job);
  }
  get(id: string): ResearchJob | undefined { const record = this.records.get(id); return record ? clone(record.job) : undefined; }
  cancel(id: string): ResearchJob | undefined {
    const record = this.records.get(id); if (!record) return undefined;
    if (!['queued', 'running'].includes(record.job.status)) return clone(record.job);
    this.finish(record, 'cancelled', undefined, { code: 'JOB_CANCELLED', message: 'Cancelled by the requester.' });
    record.controller.abort(); return clone(record.job);
  }
  private finish(record: JobRecord, status: 'succeeded' | 'failed' | 'cancelled', result?: ResearchResult, error?: ResearchJob['error']) {
    if (!['queued', 'running'].includes(record.job.status)) return;
    if (record.timer) clearTimeout(record.timer);
    Object.assign(record.job, { status, stage: status, finishedAt: new Date().toISOString(), ...(result ? { result: clone(result) } : {}), ...(error ? { error } : {}) });
    this.lanes[record.lane].queue = this.lanes[record.lane].queue.filter(id => id !== record.job.id);
    this.refreshQueuePositions();
    // Release large request snapshots after work, keeping only immutable public result/status.
    record.payload = undefined as unknown as ResearchPayload;
    const terminal = [...this.records.values()].filter(r => !['queued', 'running'].includes(r.job.status));
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
      });
    }
  }

  private dispatch() {
    const perLane = Math.max(1, this.options.workers ?? 1);
    for (const lane of ['backtest', 'scan'] as Lane[]) {
      while (!this.closed && this.lanes[lane].queue.length && this.lanes[lane].active.size < perLane) {
        const id = this.lanes[lane].queue.shift()!, record = this.records.get(id);
        if (!record || record.job.status !== 'queued') continue;
        this.lanes[lane].active.add(id);
        record.job.status = 'running';
        record.job.stage = 'simulation';
        record.job.startedAt = new Date().toISOString();
        delete record.job.queuedBehind;
        // The deadline starts with the run, never with time spent in the lane queue.
        const timeout = () => {
          const message = record.lane === 'scan'
            ? 'The scan took too long and was stopped. Try again.'
            : 'The backtest took too long and was stopped. Try again.';
          this.finish(record, 'failed', undefined, { code: 'JOB_TIMEOUT', message });
          record.controller.abort();
        };
        let armTimer = () => {
          record.timer = setTimeout(timeout, this.options.maxMs ?? 30000);
        };
        if (record.lane === 'scan') {
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
        const progress = (stage: string) => {
          if (record.job.status !== 'running') return;
          record.job.stage = stage.slice(0, 80);
          if (record.lane === 'scan') armTimer();
        };
        const work = Promise.resolve().then(() => { if (record.job.status !== 'running') throw new JobError('JOB_CANCELLED', 'Work cancelled before execution.'); return this.options.executor ? this.options.executor(record.payload, { signal: record.controller.signal, progress }) : this.runWorker(record, progress); });
        Promise.resolve(work).then(result => this.finish(record, 'succeeded', result), error => this.finish(record, 'failed', undefined, { code: error instanceof JobError ? error.code : 'WORKER_FAILED', message: error instanceof JobError ? error.message : 'The computation worker did not complete.' }));
      }
    }
    this.refreshQueuePositions();
  }
  private runWorker(record: JobRecord, progress: (stage: string) => void): Promise<BacktestResponse> {
    return new Promise((resolve, reject) => {
      let worker: Worker;
      let receivedTerminal = false;
      try { worker = new Worker(this.options.workerPath ?? path.resolve('dist/server/worker.cjs'), { workerData: record.payload, resourceLimits: { maxOldGenerationSizeMb: 128 }, execArgv: ['--preserve-symlinks', '--preserve-symlinks-main'] }); }
      catch { reject(new JobError('WORKER_UNAVAILABLE', 'Build the worker artifact before running jobs.', 503)); return; }
      record.stop = () => worker.terminate().then(() => {});
      worker.on('message', message => { if (message?.type === 'progress') progress(String(message.stage)); else if (message?.type === 'result') { receivedTerminal = true; if (!message.result || typeof message.result !== 'object') reject(new JobError('WORKER_EMPTY_RESULT', 'Worker returned no research result.')); else resolve(message.result); } else if (message?.type === 'error') { receivedTerminal = true; reject(new JobError(String(message.code ?? 'SIMULATION_FAILED'), String(message.message ?? 'Simulation failed.').slice(0, 500))); } });
      worker.on('error', () => reject(new JobError('WORKER_CRASHED', 'Research worker crashed.')));
      worker.on('exit', () => { if (!receivedTerminal && record.job.status === 'running') reject(new JobError('WORKER_EXITED', 'Worker exited before returning a result.')); });
    });
  }
  async shutdown(): Promise<void> {
    this.closed = true;
    for (const record of this.records.values()) if (['queued', 'running'].includes(record.job.status)) this.cancel(record.job.id);
    await Promise.all([...this.terminations]);
  }
}
