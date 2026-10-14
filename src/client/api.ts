import type { BacktestResponse, StrategyAST } from '../shared/strategy/types';
import { snapshotStrategy } from './workspace';
import { parseBacktestResult } from '../shared/contracts/research';
import { canonicalStrategyJSON, validateStrategy } from '../shared/strategy/schema';
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
    const aborted = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); reject(new DOMException('Request cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve(); }, ms);
    if (signal?.aborted) aborted(); else signal?.addEventListener('abort', aborted, { once: true });
  });
}
export async function requestBacktest(strategy: StrategyAST, signal?: AbortSignal, options: RunRequestOptions = {}): Promise<BacktestResponse> {
  const input = snapshotStrategy(strategy), key = globalThis.crypto?.randomUUID?.();
  let jobId: string | undefined, completed = false;
  try {
    const accepted = await readJson(await fetch('/api/v2/backtests', { method:'POST', headers:{ 'Content-Type':'application/json', ...(key ? {'Idempotency-Key':key} : {}) }, body:JSON.stringify({strategy:input,...options}), signal }));
    if (typeof accepted.jobId !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(accepted.jobId)) throw new ApiError('Invalid job receipt.', 'INVALID_RESPONSE');
    jobId = accepted.jobId;
    const deadline = Date.now() + 45000;
    for (;;) {
      const job = await readJson(await fetch('/api/v2/jobs/' + encodeURIComponent(jobId), {signal}));
      if (job.status === 'succeeded') {
        const result = parseBacktestResult(job.result);
        const submitted = validateStrategy(input).canonicalData!, returned = validateStrategy(result.strategy).canonicalData!;
        if (canonicalStrategyJSON(submitted) !== canonicalStrategyJSON(returned)) throw new ApiError('Result belongs to a different strategy snapshot.', 'RESULT_IDENTITY_MISMATCH');
        completed = true; return result;
      }
      if (job.status === 'failed' || job.status === 'cancelled') {
        const error = job.error as {message?:string;code?:string} | undefined;
        throw new ApiError(error?.message ?? 'Research job did not complete.', error?.code ?? 'JOB_FAILED');
      }
      if (!['queued','running'].includes(String(job.status))) throw new ApiError('Invalid job status.', 'INVALID_RESPONSE');
      if (Date.now() >= deadline) throw new ApiError('Research deadline exceeded.', 'CLIENT_DEADLINE');
      await pause(1000, signal);
    }
  } finally {
    if (jobId && !completed) await fetch('/api/v2/jobs/' + encodeURIComponent(jobId), {method:'DELETE'}).catch(()=>{});
  }
}
