import type { BacktestResponse, StrategyAST } from '../shared/strategy/types';
import { snapshotStrategy } from './workspace';
import { parseBacktestResult } from '../shared/contracts/research';
import { canonicalStrategyJSON, validateStrategy } from '../shared/strategy/schema';
import { parseMarketSnapshotResult, parseScanResult, type MarketSnapshotResult, type ScanResult } from '../shared/contracts/scanner-results';
export type { MarketSnapshotResult, ScanResult } from '../shared/contracts/scanner-results';
/** Real milestones from the job lifecycle; never a simulated percentage. */
export type ResearchPhase = 'waiting' | 'preparing' | 'running';
export interface ResearchJobProgress { status: 'queued' | 'running'; stage?: string; queuedBehind?: number; progress?: { processed: number; total: number }; }
/**
 * Execution deadlines start only when the job leaves the queue. The server caps a
 * market snapshot at 90 s (150 s for the broad 200-symbol universes), so the
 * client never waits the old 600 s for a blank screen.
 */
export const RESEARCH_DEADLINE_MS = { backtest: 45_000, scan: 300_000, market: 240_000 } as const;
/** A queued job may wait behind long work, but never forever. */
export const RESEARCH_QUEUE_LIMIT_MS = 300_000;
/**
 * A client deadline never stops the server job (the id rides on the error), so
 * the copy says it is still running. A genuine server timeout keeps its own
 * message from the job payload.
 */
const deadlineMessage = (kind: 'backtest' | 'scan' | 'market') => kind === 'backtest'
  ? 'The backtest is still running. Check again.'
  : kind === 'scan'
    ? 'The scan is still running. Check again.'
    : 'The market snapshot is still loading. Check again.';
const jobLostMessage = (kind: 'backtest' | 'scan' | 'market') => kind === 'backtest'
  ? 'The server restarted and the backtest was lost. Try again.'
  : kind === 'scan'
    ? 'The server restarted and the scan was lost. Try again.'
    : 'The server restarted and the market load was lost. Try again.';
const POLL_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;
export interface RunRequestOptions { initialCapital?: number; start?: string; end?: string; asOf?: string; seed?: number; robustness?: boolean; }
export class ApiError extends Error { constructor(message: string, public code = 'API_FAILED', public status = 0) { super(message); } }
export async function readJson(response: Response): Promise<Record<string, unknown>> {
  let raw: unknown;
  try { raw = await response.json(); } catch { throw new ApiError('The server is temporarily unavailable. Try again.', 'SERVER_UNAVAILABLE', response.status); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError('The server returned an unexpected response. Try again.', 'INVALID_RESPONSE', response.status);
  const data = raw as Record<string, unknown>;
  if (!response.ok) {
    const error = data.error;
    const structured = error && typeof error === 'object' ? error as Record<string, unknown> : undefined;
    throw new ApiError(typeof structured?.message === 'string' ? structured.message : typeof error === 'string' ? error : 'Request failed (' + response.status + ')', typeof structured?.code === 'string' ? structured.code : typeof data.code === 'string' ? data.code : 'API_FAILED', response.status);
  }
  return data;
}
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); reject(signal?.reason instanceof Error ? signal.reason : new DOMException('Request cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve(); }, ms);
    if (signal?.aborted) aborted(); else signal?.addEventListener('abort', aborted, { once: true });
  });
}
function cancellation(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Request cancelled', 'AbortError');
}
/** Bound even a mocked/stalled fetch or JSON body that ignores AbortSignal. */
function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(cancellation(signal)); };
    if (signal.aborted) { void work.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    work.then(value => { signal.removeEventListener('abort', abort); if (signal.aborted) reject(cancellation(signal)); else resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
async function cancelJob(id: string): Promise<void> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 1500);
  try { await bounded(fetch('/api/v2/jobs/' + encodeURIComponent(id), { method: 'DELETE', signal: controller.signal }), controller.signal); }
  catch { /* Cancellation is best effort, but can never hang the caller. */ }
  finally { clearTimeout(timer); }
}
async function researchJob<T>(kind: 'backtest' | 'scan' | 'market', body: unknown, parseResult: (input: unknown) => T, signal?: AbortSignal, onPhase?: (phase: ResearchPhase) => void, onProgress?: (progress: ResearchJobProgress) => void): Promise<T> {
  const routes = { backtest: '/api/v2/backtests', scan: '/api/v2/scans', market: '/api/v2/market-snapshots' };
  const controller = new AbortController(), key = globalThis.crypto?.randomUUID?.();
  const relay = () => controller.abort(signal?.reason ?? new DOMException('Request cancelled', 'AbortError'));
  if (signal?.aborted) relay(); else signal?.addEventListener('abort', relay, { once: true });
  /** A deadline never discards the server job: the id rides on the error. */
  const deadline = (): ApiError => {
    const error = new ApiError(deadlineMessage(kind), 'CLIENT_DEADLINE') as ApiError & { jobId?: string; keepJob?: boolean };
    if (jobId) error.jobId = jobId;
    error.keepJob = true;
    return error;
  };
  const overallTimer = setTimeout(() => controller.abort(deadline()), RESEARCH_QUEUE_LIMIT_MS);
  let executionTimer: ReturnType<typeof setTimeout> | undefined;
  const startExecutionDeadline = () => {
    if (executionTimer) return;
    executionTimer = setTimeout(() => controller.abort(deadline()), RESEARCH_DEADLINE_MS[kind]);
  };
  let jobId: string | undefined, terminal = false;
  const json = async (route: string, init: RequestInit = {}) => {
    if (controller.signal.aborted) throw cancellation(controller.signal);
    const response = await bounded(fetch(route, { ...init, signal: controller.signal }), controller.signal);
    return bounded(readJson(response), controller.signal);
  };
  const pollJob = async (): Promise<Record<string, unknown>> => {
    let lastStatus = 0;
    for (let attempt = 0; attempt <= POLL_RETRY_DELAYS_MS.length; attempt++) {
      try {
        const response = await bounded(fetch('/api/v2/jobs/' + encodeURIComponent(jobId!), { signal: controller.signal }), controller.signal);
        lastStatus = response.status;
        if (response.ok) {
          const raw = await bounded(response.json(), controller.signal);
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
        } else if (response.status !== 404 && response.status !== 429 && response.status < 500) {
          return await bounded(readJson(response), controller.signal);
        }
      } catch (error) {
        if (controller.signal.aborted) throw cancellation(controller.signal);
      }
      if (attempt === POLL_RETRY_DELAYS_MS.length) break;
      await pause(POLL_RETRY_DELAYS_MS[attempt], controller.signal);
    }
    if (lastStatus === 404) throw new ApiError(jobLostMessage(kind), 'JOB_LOST');
    throw new ApiError('The server is temporarily unavailable. Try again.', 'SERVER_UNAVAILABLE');
  };
  try {
    const accepted = await json(routes[kind], { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) });
    if (accepted.schemaVersion !== 2 || typeof accepted.jobId !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(accepted.jobId) || !['queued', 'running', 'succeeded'].includes(String(accepted.status))) throw new ApiError('Invalid job receipt.', 'INVALID_RESPONSE');
    jobId = accepted.jobId;
    if (accepted.status === 'queued' || accepted.status === 'running') onProgress?.({ status: accepted.status });
    if (accepted.status === 'queued') onPhase?.('waiting');
    else {
      if (accepted.status === 'running') startExecutionDeadline();
      onPhase?.('preparing');
    }
    for (;;) {
      const job = await pollJob();
      if (job.id !== jobId || job.kind !== kind) throw new ApiError('The response belongs to a different research job.', 'RESULT_IDENTITY_MISMATCH');
      if (job.status === 'succeeded') {
        terminal = true;
        try { return parseResult(job.result); }
        catch (error) { if (error instanceof ApiError) throw error; throw new ApiError('The computation worker returned an invalid result. Results are unavailable.', 'INVALID_RESPONSE'); }
      }
      if (onProgress && (job.status === 'queued' || job.status === 'running')) {
        const counts = job.progress as { processed?: unknown; total?: unknown } | undefined;
        onProgress({
          status: job.status,
          ...(typeof job.stage === 'string' ? { stage: job.stage } : {}),
          ...(typeof job.queuedBehind === 'number' ? { queuedBehind: job.queuedBehind } : {}),
          ...(typeof counts?.processed === 'number' && typeof counts?.total === 'number' ? { progress: { processed: counts.processed, total: counts.total } } : {}),
        });
      }
      const waiting = job.status === 'queued' || job.stage === 'waiting' || typeof job.queuedBehind === 'number';
      if (waiting) onPhase?.('waiting');
      else if (job.status === 'running') {
        startExecutionDeadline();
        onPhase?.('running');
      }
      if (job.status === 'failed' || job.status === 'cancelled') {
        terminal = true;
        const error = job.error as { message?: string; code?: string } | undefined;
        throw new ApiError(error?.message ?? 'Research job did not complete.', error?.code ?? 'JOB_FAILED');
      }
      if (!['queued', 'running'].includes(String(job.status))) throw new ApiError('Invalid job status.', 'INVALID_RESPONSE');
      // At most 30 polls/minute, leaving room for other bounded API activity.
      await pause(2000, controller.signal);
    }
  } finally {
    clearTimeout(overallTimer);
    if (executionTimer) clearTimeout(executionTimer);
    signal?.removeEventListener('abort', relay); controller.abort();
    const deadlineReason = controller.signal.reason as (ApiError & { keepJob?: boolean }) | undefined;
    if (jobId && !terminal && !deadlineReason?.keepJob) await cancelJob(jobId);
  }
}
export async function requestBacktest(strategy: StrategyAST, signal?: AbortSignal, options: RunRequestOptions = {}, onPhase?: (phase: ResearchPhase) => void): Promise<BacktestResponse> {
  const input = snapshotStrategy(strategy);
  return researchJob('backtest', { strategy: input, ...options }, raw => {
    const result = parseBacktestResult(raw);
    const submitted = validateStrategy(input).canonicalData!, returned = validateStrategy(result.strategy).canonicalData!;
    if (canonicalStrategyJSON(submitted) !== canonicalStrategyJSON(returned)) throw new ApiError('Result belongs to a different strategy snapshot.', 'RESULT_IDENTITY_MISMATCH');
    return result;
  }, signal, onPhase);
}
/** What a re-poll of an existing job found. */
export type ResumedJob<T> = { state: 'running'; stage?: string; queuedBehind?: number } | { state: 'done'; result: T };

async function readJob(jobId: string, kind: 'backtest' | 'scan' | 'market', signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch('/api/v2/jobs/' + encodeURIComponent(jobId), { signal });
  const job = await readJson(response);
  if (job.id !== jobId || (job.kind && job.kind !== kind)) throw new ApiError('The response belongs to a different research job.', 'RESULT_IDENTITY_MISMATCH');
  return job;
}

/** Re-poll a scan the client gave up waiting for. A 404 surfaces as JOB_NOT_FOUND. */
export async function checkScanJob(jobId: string, signal?: AbortSignal): Promise<ResumedJob<ScanResult>> {
  const job = await readJob(jobId, 'scan', signal);
  if (job.status === 'succeeded') return { state: 'done', result: parseScanResult(job.result) };
  if (job.status === 'failed' || job.status === 'cancelled') {
    const error = job.error as { message?: string; code?: string } | undefined;
    throw new ApiError(error?.message ?? 'Research job did not complete.', error?.code ?? 'JOB_FAILED');
  }
  return {
    state: 'running',
    ...(typeof job.stage === 'string' ? { stage: job.stage } : {}),
    ...(typeof job.queuedBehind === 'number' ? { queuedBehind: job.queuedBehind } : {}),
  };
}

/** Re-poll a backtest the client gave up waiting for. */
export async function checkBacktestJob(jobId: string, signal?: AbortSignal): Promise<ResumedJob<BacktestResponse>> {
  const job = await readJob(jobId, 'backtest', signal);
  if (job.status === 'succeeded') return { state: 'done', result: parseBacktestResult(job.result) };
  if (job.status === 'failed' || job.status === 'cancelled') {
    const error = job.error as { message?: string; code?: string } | undefined;
    throw new ApiError(error?.message ?? 'Research job did not complete.', error?.code ?? 'JOB_FAILED');
  }
  return {
    state: 'running',
    ...(typeof job.stage === 'string' ? { stage: job.stage } : {}),
    ...(typeof job.queuedBehind === 'number' ? { queuedBehind: job.queuedBehind } : {}),
  };
}

/** Cancel a job the client is no longer waiting for (best effort). */
export async function cancelResearchJob(jobId: string): Promise<void> {
  await cancelJob(jobId);
}

/** Re-poll a market snapshot the client gave up waiting for. */
export async function checkMarketJob(jobId: string, signal?: AbortSignal): Promise<ResumedJob<MarketSnapshotResult>> {
  const job = await readJob(jobId, 'market', signal);
  if (job.status === 'succeeded') return { state: 'done', result: parseMarketSnapshotResult(job.result) };
  if (job.status === 'failed' || job.status === 'cancelled') {
    const error = job.error as { message?: string; code?: string } | undefined;
    throw new ApiError(error?.message ?? 'Research job did not complete.', error?.code ?? 'JOB_FAILED');
  }
  return {
    state: 'running',
    ...(typeof job.stage === 'string' ? { stage: job.stage } : {}),
    ...(typeof job.queuedBehind === 'number' ? { queuedBehind: job.queuedBehind } : {}),
  };
}

export async function requestMarketSnapshot(input: { universe: string; asOf?: string }, signal?: AbortSignal, onProgress?: (progress: ResearchJobProgress) => void): Promise<MarketSnapshotResult> {
  const body = { universe: input.universe, ...(input.asOf ? { asOf: input.asOf } : {}) };
  return researchJob('market', body, raw => {
    const result = parseMarketSnapshotResult(raw);
    if (result.universe !== body.universe || result.requestedDate !== body.asOf) throw new ApiError('Market snapshot belongs to a different universe or cutoff.', 'RESULT_IDENTITY_MISMATCH');
    if (body.asOf && ((result.observationDates?.latest && result.observationDates.latest > body.asOf) || result.trends.some(trend => !trend.date || trend.date > body.asOf!))) throw new ApiError('Market snapshot contains observations after the requested cutoff.', 'RESULT_IDENTITY_MISMATCH');
    return result;
  }, signal, undefined, onProgress);
}
export async function requestScan(input: { universe: string; strategy: StrategyAST; limit?: number; asOf?: string }, signal?: AbortSignal, onPhase?: (phase: ResearchPhase) => void, onProgress?: (progress: ResearchJobProgress) => void): Promise<ScanResult> {
  const body = { universe: input.universe, strategy: snapshotStrategy(input.strategy), limit: input.limit ?? 35, ...(input.asOf ? { asOf: input.asOf } : {}) };
  return researchJob('scan', body, raw => {
    const result = parseScanResult(raw);
    if (result.universe !== body.universe || result.asOf !== body.asOf || result.limit !== body.limit || result.offset !== 0) throw new ApiError('Scan belongs to a different universe, cutoff or page.', 'RESULT_IDENTITY_MISMATCH');
    if (body.asOf && ((result.observationDates?.latest && result.observationDates.latest > body.asOf) || result.matches.some(match => match.lastDate > body.asOf! || match.provenance.asOf > body.asOf!))) throw new ApiError('Scan contains observations after the requested cutoff.', 'RESULT_IDENTITY_MISMATCH');
    return result;
  }, signal, onPhase, onProgress);
}
