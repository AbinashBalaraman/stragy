import type { BacktestResponse, StrategyAST } from '../shared/strategy/types';
import { snapshotStrategy } from './workspace';
import { parseBacktestResult } from '../shared/contracts/research';
import { canonicalStrategyJSON, validateStrategy } from '../shared/strategy/schema';
import { parseMarketSnapshotResult, parseScanResult, type MarketSnapshotResult, type ScanResult } from '../shared/contracts/scanner-results';
export type { MarketSnapshotResult, ScanResult } from '../shared/contracts/scanner-results';
export interface RunRequestOptions { initialCapital?: number; start?: string; end?: string; asOf?: string; seed?: number; robustness?: boolean; }
export class ApiError extends Error { constructor(message: string, public code = 'API_FAILED', public status = 0) { super(message); } }
export async function readJson(response: Response): Promise<Record<string, unknown>> {
  let raw: unknown;
  try { raw = await response.json(); } catch { throw new ApiError('The server did not return JSON.', 'INVALID_RESPONSE', response.status); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError('Malformed API response.', 'INVALID_RESPONSE', response.status);
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
async function researchJob<T>(kind: 'backtest' | 'scan' | 'market', body: unknown, parseResult: (input: unknown) => T, signal?: AbortSignal): Promise<T> {
  const routes = { backtest: '/api/v2/backtests', scan: '/api/v2/scans', market: '/api/v2/market-snapshots' };
  const controller = new AbortController(), key = globalThis.crypto?.randomUUID?.();
  const relay = () => controller.abort(signal?.reason ?? new DOMException('Request cancelled', 'AbortError'));
  if (signal?.aborted) relay(); else signal?.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(() => controller.abort(new ApiError('Research request deadline exceeded. Results are unavailable; no zero-match conclusion was made.', 'CLIENT_DEADLINE')), kind === 'backtest' ? 45000 : 120000);
  let jobId: string | undefined, terminal = false;
  const json = async (route: string, init: RequestInit = {}) => {
    if (controller.signal.aborted) throw cancellation(controller.signal);
    const response = await bounded(fetch(route, { ...init, signal: controller.signal }), controller.signal);
    return bounded(readJson(response), controller.signal);
  };
  try {
    const accepted = await json(routes[kind], { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) });
    if (accepted.schemaVersion !== 2 || typeof accepted.jobId !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(accepted.jobId) || !['queued', 'running', 'succeeded'].includes(String(accepted.status))) throw new ApiError('Invalid job receipt.', 'INVALID_RESPONSE');
    jobId = accepted.jobId;
    for (;;) {
      const job = await json('/api/v2/jobs/' + encodeURIComponent(jobId));
      if (job.id !== jobId || job.kind !== kind) throw new ApiError('The response belongs to a different research job.', 'RESULT_IDENTITY_MISMATCH');
      if (job.status === 'succeeded') {
        terminal = true;
        try { return parseResult(job.result); }
        catch (error) { if (error instanceof ApiError) throw error; throw new ApiError('The computation worker returned an invalid result. Results are unavailable.', 'INVALID_RESPONSE'); }
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
    clearTimeout(timer); signal?.removeEventListener('abort', relay); controller.abort();
    if (jobId && !terminal) await cancelJob(jobId);
  }
}
export async function requestBacktest(strategy: StrategyAST, signal?: AbortSignal, options: RunRequestOptions = {}): Promise<BacktestResponse> {
  const input = snapshotStrategy(strategy);
  return researchJob('backtest', { strategy: input, ...options }, raw => {
    const result = parseBacktestResult(raw);
    const submitted = validateStrategy(input).canonicalData!, returned = validateStrategy(result.strategy).canonicalData!;
    if (canonicalStrategyJSON(submitted) !== canonicalStrategyJSON(returned)) throw new ApiError('Result belongs to a different strategy snapshot.', 'RESULT_IDENTITY_MISMATCH');
    return result;
  }, signal);
}
export async function requestMarketSnapshot(input: { universe: string; asOf?: string }, signal?: AbortSignal): Promise<MarketSnapshotResult> {
  const body = { universe: input.universe, ...(input.asOf ? { asOf: input.asOf } : {}) };
  return researchJob('market', body, raw => {
    const result = parseMarketSnapshotResult(raw);
    if (result.universe !== body.universe || result.requestedDate !== body.asOf) throw new ApiError('Market snapshot belongs to a different universe or cutoff.', 'RESULT_IDENTITY_MISMATCH');
    if (body.asOf && ((result.observationDates?.latest && result.observationDates.latest > body.asOf) || result.trends.some(trend => !trend.date || trend.date > body.asOf!))) throw new ApiError('Market snapshot contains observations after the requested cutoff.', 'RESULT_IDENTITY_MISMATCH');
    return result;
  }, signal);
}
export async function requestScan(input: { universe: string; strategy: StrategyAST; limit?: number; asOf?: string }, signal?: AbortSignal): Promise<ScanResult> {
  const body = { universe: input.universe, strategy: snapshotStrategy(input.strategy), limit: input.limit ?? 35, ...(input.asOf ? { asOf: input.asOf } : {}) };
  return researchJob('scan', body, raw => {
    const result = parseScanResult(raw);
    if (result.universe !== body.universe || result.asOf !== body.asOf || result.limit !== body.limit || result.offset !== 0) throw new ApiError('Scan belongs to a different universe, cutoff or page.', 'RESULT_IDENTITY_MISMATCH');
    if (body.asOf && ((result.observationDates?.latest && result.observationDates.latest > body.asOf) || result.matches.some(match => match.lastDate > body.asOf! || match.provenance.asOf > body.asOf!))) throw new ApiError('Scan contains observations after the requested cutoff.', 'RESULT_IDENTITY_MISMATCH');
    return result;
  }, signal);
}
