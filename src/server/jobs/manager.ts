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
export interface ResearchJob { id: string; kind: 'backtest' | 'scan' | 'market'; status: JobStatus; stage: string; createdAt: string; startedAt?: string; finishedAt?: string; result?: ResearchResult; error?: { code: string; message: string }; }
export class JobError extends Error { constructor(public code: string, message: string, public status = 422) { super(message); } }
interface Record { job: ResearchJob; payload: ResearchPayload; hash: string; controller: AbortController; stop?: () => Promise<void>; timer?: ReturnType<typeof setTimeout>; }
type Executor = (payload: ResearchPayload, context: { signal: AbortSignal; progress: (stage: string) => void }) => Promise<ResearchResult>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function canonical(v: unknown): unknown { return Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, canonical(value)])) : v; }
export class JobManager {
  private records = new Map<string, Record>();
  private keys = new Map<string, { id: string; hash: string }>();
  private queue: string[] = [];
  private active = new Set<string>();
  private closed = false;
  private terminations = new Set<Promise<void>>();
  constructor(private options: { maxQueue?: number; maxMs?: number; maxRetained?: number; workers?: number; workerPath?: string; executor?: Executor } = {}) {}
  enqueue(input: ResearchPayload, key?: string): ResearchJob {
    if (this.closed) throw new JobError('SHUTTING_DOWN', 'New jobs are disabled during shutdown.', 503);
    if (!input || typeof input !== 'object') throw new JobError('INVALID_JOB_INPUT', 'A normalized research payload is required.');
    const text = JSON.stringify(input);
    if (Buffer.byteLength(text) > 2_000_000 || (!input.kind || input.kind === 'backtest') && (!Array.isArray(input.bars) || !input.bars.length || input.bars.length > 5000)) throw new JobError('JOB_BUDGET_EXCEEDED', 'Job input exceeds its validated budget.');
    const payload = clone(input);
    const hash = createHash('sha256').update(JSON.stringify(canonical({ ...payload, provenance: undefined }))).digest('hex');
    if (key && (key.length > 100 || !/^[A-Za-z0-9_.:-]+$/.test(key))) throw new JobError('INVALID_IDEMPOTENCY_KEY', 'Invalid idempotency key.');
    if (key && this.keys.has(key)) { const existing = this.keys.get(key)!; if (existing.hash !== hash) throw new JobError('IDEMPOTENCY_CONFLICT', 'The key was already used with different inputs.', 409); const record = this.records.get(existing.id); if (record) return clone(record.job); this.keys.delete(key); }
    if (this.queue.length >= (this.options.maxQueue ?? 8)) throw new JobError('QUEUE_FULL', 'Research queue is full. Retry later.', 429);
    const id = randomUUID(), job: ResearchJob = { id, kind: payload.kind ?? 'backtest', status: 'queued', stage: 'queued', createdAt: new Date().toISOString() };
    this.records.set(id, { job, payload, hash, controller: new AbortController() });
    if (key) this.keys.set(key, { id, hash });
    this.queue.push(id); this.dispatch(); return clone(job);
  }
  get(id: string): ResearchJob | undefined { const record = this.records.get(id); return record ? clone(record.job) : undefined; }
  cancel(id: string): ResearchJob | undefined {
    const record = this.records.get(id); if (!record) return undefined;
    if (!['queued', 'running'].includes(record.job.status)) return clone(record.job);
    this.finish(record, 'cancelled', undefined, { code: 'JOB_CANCELLED', message: 'Cancelled by the requester.' });
    record.controller.abort(); return clone(record.job);
  }
  private finish(record: Record, status: 'succeeded' | 'failed' | 'cancelled', result?: ResearchResult, error?: ResearchJob['error']) {
    if (!['queued', 'running'].includes(record.job.status)) return;
    if (record.timer) clearTimeout(record.timer);
    Object.assign(record.job, { status, stage: status, finishedAt: new Date().toISOString(), ...(result ? { result: clone(result) } : {}), ...(error ? { error } : {}) });
    this.queue = this.queue.filter(id => id !== record.job.id);
    // Release large request snapshots after work, keeping only immutable public result/status.
    record.payload = undefined as unknown as ResearchPayload;
    const terminal = [...this.records.values()].filter(r => !['queued', 'running'].includes(r.job.status));
    while (terminal.length > (this.options.maxRetained ?? 20)) { const removed = terminal.shift()!; this.records.delete(removed.job.id); for (const [key, value] of this.keys) if (value.id === removed.job.id) this.keys.delete(key); }
    const release = () => { this.active.delete(record.job.id); queueMicrotask(() => this.dispatch()); };
    if (record.stop) { const stopped = record.stop().catch(() => {}).then(release); this.terminations.add(stopped); void stopped.then(() => this.terminations.delete(stopped)); } else release();
  }
  private dispatch() {
    while (!this.closed && this.queue.length && this.active.size < (this.options.workers ?? 1)) {
      const id = this.queue.shift()!, record = this.records.get(id);
      if (!record || record.job.status !== 'queued') continue;
      this.active.add(id); record.job.status = 'running'; record.job.stage = 'simulation'; record.job.startedAt = new Date().toISOString();
      record.timer = setTimeout(() => { this.finish(record, 'failed', undefined, { code: 'JOB_TIMEOUT', message: 'Execution deadline exceeded.' }); record.controller.abort(); }, this.options.maxMs ?? 30000);
      const progress = (stage: string) => { if (record.job.status === 'running') record.job.stage = stage.slice(0, 80); };
      const work = Promise.resolve().then(() => { if (record.job.status !== 'running') throw new JobError('JOB_CANCELLED', 'Work cancelled before execution.'); return this.options.executor ? this.options.executor(record.payload, { signal: record.controller.signal, progress }) : this.runWorker(record, progress); });
      Promise.resolve(work).then(result => this.finish(record, 'succeeded', result), error => this.finish(record, 'failed', undefined, { code: error instanceof JobError ? error.code : 'WORKER_FAILED', message: error instanceof JobError ? error.message : 'The computation worker did not complete.' }));
    }
  }
  private runWorker(record: Record, progress: (stage: string) => void): Promise<BacktestResponse> {
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
