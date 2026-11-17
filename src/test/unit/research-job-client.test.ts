import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelResearchJob, requestBacktest, requestMarketSnapshot, requestScan, RESEARCH_DEADLINE_MS, RESEARCH_QUEUE_LIMIT_MS } from '../../client/api';
import { strategy } from '../fixtures/research';

const receipt = { schemaVersion: 2, jobId: 'fixture-job', status: 'queued' };
const scan = (overrides = {}) => ({ universe: 'NIFTY_50', scanned: 1, matched: 0, scannedAt: '2026-09-30T10:00:00Z', dataSource: 'PROVENANCE_PER_SYMBOL', matches: [], requested: 1, attempted: 1, succeeded: 1, unavailable: 0, failed: 0, offset: 0, limit: 35, errors: [], sourceCoverage: { OFFLINE_FIXTURE: 1 }, warnings: ['Synthetic offline fixture'], ...overrides });
const market = (overrides = {}) => ({ universe: 'NIFTY_50', mode: 'demo', trends: [], errors: [], coverage: { requested: 0, succeeded: 0, unavailable: 0 }, sourceCoverage: {}, ...overrides });
const response = (value: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value }) as Response;
const done = (kind: string, result: unknown, overrides = {}) => ({ id: receipt.jobId, kind, status: 'succeeded', result, ...overrides });
const input = () => ({ universe: 'NIFTY_50', strategy: strategy() });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { vi.useFakeTimers(); fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('bounded asynchronous research job client', () => {
  it('waits 600s for a cold market snapshot and then keeps the job', async () => {
    expect(RESEARCH_DEADLINE_MS.market).toBe(600_000);
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (String(url) === '/api/v2/market-snapshots') return response(receipt, 202);
      if (init.method === 'DELETE') return response({});
      return response({ id: receipt.jobId, kind: 'market', status: 'running' });
    });
    const promise = requestMarketSnapshot({ universe: 'NIFTY_50' });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'CLIENT_DEADLINE', message: 'The market snapshot is still loading. Check again.' });
    await vi.advanceTimersByTimeAsync(599_000);
    let settled = false;
    void promise.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toBe(true);
    await assertion;
  });

  it('keeps a cold scan alive past 120s and aborts at 300s', async () => {
    expect(RESEARCH_DEADLINE_MS.scan).toBe(300_000);
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (String(url) === '/api/v2/scans') return response(receipt, 202);
      if (init.method === 'DELETE') return response({});
      return response({ id: receipt.jobId, kind: 'scan', status: 'running' });
    });
    const promise = requestScan(input());
    const assertion = expect(promise).rejects.toMatchObject({ code: 'CLIENT_DEADLINE', message: 'The scan is still running. Check again.' });
    await vi.advanceTimersByTimeAsync(119_000);
    let settled = false;
    void promise.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(181_000);
    await assertion;
    // A deadline keeps the job: the user can still check again or cancel it.
    expect(fetchMock.mock.calls.some(call => call[1]?.method === 'DELETE')).toBe(false);
  });

  it('keeps a queued backtest alive and starts its execution deadline only when it runs', async () => {
    expect(RESEARCH_QUEUE_LIMIT_MS).toBe(300_000);
    const phases: string[] = [];
    const started = Date.now();
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (String(url) === '/api/v2/backtests') return response(receipt, 202);
      if (init.method === 'DELETE') return response({});
      if (Date.now() - started < 120_000) return response({ id: receipt.jobId, kind: 'backtest', status: 'queued', stage: 'waiting', queuedBehind: 1 });
      return response({ id: receipt.jobId, kind: 'backtest', status: 'running', stage: 'simulation' });
    });
    const outcome = requestBacktest(strategy(), undefined, {}, phase => phases.push(phase)).catch(error => error);
    await vi.advanceTimersByTimeAsync(163_000);
    let settled = false;
    void outcome.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(phases).toContain('waiting');
    expect(phases.at(-1)).toBe('running');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await outcome).toMatchObject({ code: 'CLIENT_DEADLINE', message: 'The backtest is still running. Check again.' });
  });

  it('stops a backtest that has waited five minutes in the queue', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (String(url) === '/api/v2/backtests') return response(receipt, 202);
      if (init.method === 'DELETE') return response({});
      return response({ id: receipt.jobId, kind: 'backtest', status: 'queued', stage: 'waiting' });
    });
    const outcome = requestBacktest(strategy()).catch(error => error);
    await vi.advanceTimersByTimeAsync(299_000);
    let settled = false;
    void outcome.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await outcome).toMatchObject({ code: 'CLIENT_DEADLINE', message: 'The backtest is still running. Check again.' });
  });

  it('retries a 404 poll and recovers when the server comes back', async () => {
    let polls = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (String(url) === '/api/v2/scans') return response(receipt, 202);
      if (init.method === 'DELETE') return response({});
      polls += 1;
      if (polls < 3) return response({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
      return response(done('scan', scan()));
    });
    const result = requestScan(input());
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await result).universe).toBe('NIFTY_50');
    expect(polls).toBe(3);
  });

  it('turns a persistent 404 into a plain JOB_LOST message after the retry window', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (String(url) === '/api/v2/scans') return response(receipt, 202);
      if (init.method === 'DELETE') return response({});
      return response({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    });
    const result = requestScan(input()).catch(error => error);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await result).toMatchObject({ code: 'JOB_LOST', message: 'The server restarted and the scan was lost. Try again.' });
  });

  it('retries 5xx and non-JSON polls, then reports plain copy instead of a JSON parser error', async () => {
    let polls = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (String(url) === '/api/v2/scans') return response(receipt, 202);
      if (init.method === 'DELETE') return response({});
      polls += 1;
      if (polls === 1) return response({ error: { code: 'UNAVAILABLE' } }, 503);
      if (polls === 2) return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } } as unknown as Response;
      return response(done('scan', scan()));
    });
    const result = requestScan(input());
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await result).universe).toBe('NIFTY_50');

    polls = 0;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (String(url) === '/api/v2/scans') return response(receipt, 202);
      if (init.method === 'DELETE') return response({});
      return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } } as unknown as Response;
    });
    const failed = requestScan(input()).catch(error => error);
    await vi.advanceTimersByTimeAsync(31_000);
    const error = await failed;
    expect(error).toMatchObject({ code: 'SERVER_UNAVAILABLE', message: 'The server is temporarily unavailable. Try again.' });
    expect((error as Error).message).not.toContain('JSON');
  });

  it('uses v2 submission/polling instead of legacy synchronous scan routes', async () => {
    fetchMock.mockResolvedValueOnce(response(receipt, 202))
      .mockResolvedValueOnce(response({ id: receipt.jobId, kind: 'scan', status: 'queued' }))
      .mockResolvedValueOnce(response({ id: receipt.jobId, kind: 'scan', status: 'running' }))
      .mockResolvedValueOnce(response(done('scan', scan())));
    const value = input();
    const promise = requestScan(value);
    value.strategy.risk.stopLoss.value = 99;
    await vi.advanceTimersByTimeAsync(4000);
    expect((await promise).matched).toBe(0);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v2/scans');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).strategy.risk.stopLoss.value).toBe(20);
    expect(fetchMock.mock.calls.slice(1).every(call => call[0] === '/api/v2/jobs/fixture-job')).toBe(true);
    expect(fetchMock.mock.calls.some(call => call[1]?.method === 'DELETE')).toBe(false);
  });
  it('reports queued and running market progress without inventing counts', async () => {
    const events: Array<{ status: string; stage?: string; queuedBehind?: number }> = [];
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (String(url) === '/api/v2/market-snapshots') return response(receipt, 202);
      if (init.method === 'DELETE') return response({});
      if (fetchMock.mock.calls.filter(call => String(call[0]).startsWith('/api/v2/jobs/')).length < 2) {
        return response({ id: receipt.jobId, kind: 'market', status: 'queued', stage: 'waiting', queuedBehind: 2 });
      }
      if (!events.some(event => event.status === 'running')) return response({ id: receipt.jobId, kind: 'market', status: 'running', stage: 'market' });
      return response(done('market', market()));
    });
    const result = requestMarketSnapshot({ universe: 'NIFTY_50' }, undefined, progress => events.push(progress));
    await vi.advanceTimersByTimeAsync(6000);
    expect((await result).universe).toBe('NIFTY_50');
    expect(events).toEqual([
      { status: 'queued' },
      { status: 'queued', stage: 'waiting', queuedBehind: 2 },
      { status: 'running', stage: 'market' },
    ]);
  });

  it('uses one v2 market snapshot job, not parallel legacy trends and movers waits', async () => {
    fetchMock.mockResolvedValueOnce(response(receipt, 202)).mockResolvedValueOnce(response(done('market', market())));
    expect((await requestMarketSnapshot({ universe: 'NIFTY_50' })).coverage.succeeded).toBe(0);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/v2/market-snapshots', '/api/v2/jobs/fixture-job']);
  });
  it('reports a terminal failed job, never a successful zero-match result', async () => {
    fetchMock.mockResolvedValueOnce(response(receipt, 202)).mockResolvedValueOnce(response(done('scan', undefined, { status: 'failed', error: { code: 'JOB_TIMEOUT', message: 'Fixture execution deadline exceeded' } })));
    await expect(requestScan(input())).rejects.toMatchObject({ code: 'JOB_TIMEOUT' });
    expect(fetchMock.mock.calls.some(call => call[1]?.method === 'DELETE')).toBe(false);
  });
  it('rejects a result from another job and cancels only the known submitted job', async () => {
    fetchMock.mockResolvedValueOnce(response(receipt, 202)).mockResolvedValueOnce(response(done('scan', scan(), { id: 'another-job' }))).mockResolvedValueOnce(response({}));
    await expect(requestScan(input())).rejects.toMatchObject({ code: 'RESULT_IDENTITY_MISMATCH' });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v2/jobs/fixture-job', expect.objectContaining({ method: 'DELETE' }));
  });
  it('rejects a mismatched job kind, universe or requested cutoff', async () => {
    for (const job of [done('market', scan()), done('scan', scan({ universe: 'ALL' })), done('scan', scan({ asOf: '2026-09-29' }))]) {
      fetchMock.mockResolvedValueOnce(response(receipt, 202)).mockResolvedValueOnce(response(job)).mockResolvedValue(response({}));
      await expect(requestScan(input())).rejects.toMatchObject({ code: 'RESULT_IDENTITY_MISMATCH' });
      fetchMock.mockReset();
    }
  });
  it('rejects inconsistent coverage rather than displaying misleading counts', async () => {
    fetchMock.mockResolvedValueOnce(response(receipt, 202)).mockResolvedValueOnce(response(done('scan', scan({ succeeded: 2 }))));
    await expect(requestScan(input())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('keeps an all-unavailable scan distinct from evaluated zero matches', async () => {
    fetchMock.mockResolvedValueOnce(response(receipt, 202)).mockResolvedValueOnce(response(done('scan', scan({ succeeded: 0, unavailable: 1, sourceCoverage: {}, errors: [{ symbolId: 1, code: 'PROVIDER_UNAVAILABLE', message: 'No observed fixture' }] }))));
    const result = await requestScan(input());
    expect(result.succeeded).toBe(0);
    expect(result.unavailable).toBe(1);
  });
  it('cancels server work when the requesting view is replaced, even if polling ignores abort', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => init?.method === 'POST' ? Promise.resolve(response(receipt, 202)) : init?.method === 'DELETE' ? Promise.resolve(response({})) : new Promise(() => {}));
    const controller = new AbortController();
    const result = requestScan(input(), controller.signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect((await result).name).toBe('AbortError');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v2/jobs/fixture-job', expect.objectContaining({ method: 'DELETE' }));
  });
  it('bounds a stalled poll to a finite deadline and keeps the job for a re-check', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => init?.method === 'POST' ? Promise.resolve(response(receipt, 202)) : new Promise(() => {}));
    const result = requestScan(input()).catch(error => error);
    await vi.advanceTimersByTimeAsync(301501);
    expect(await result).toMatchObject({ code: 'CLIENT_DEADLINE' });
    // The job is not cancelled: the card offers Check again and Cancel scan.
    expect(fetchMock).not.toHaveBeenCalledWith('/api/v2/jobs/fixture-job', expect.objectContaining({ method: 'DELETE' }));
  });
  it('cancels a kept job with DELETE, and returns even when DELETE hangs', async () => {
    fetchMock.mockResolvedValue(response({}));
    await cancelResearchJob('fixture-job');
    expect(fetchMock).toHaveBeenCalledWith('/api/v2/jobs/fixture-job', expect.objectContaining({ method: 'DELETE' }));

    fetchMock.mockImplementation(() => new Promise(() => {}));
    const cancelled = cancelResearchJob('hung-job');
    await vi.advanceTimersByTimeAsync(1600);
    await expect(cancelled).resolves.toBeUndefined();
  });
  it('bounds a stalled response body rather than waiting forever after HTTP headers', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 202, json: () => new Promise(() => {}) } as Response);
    const result = requestScan(input()).catch(error => error);
    await vi.advanceTimersByTimeAsync(300001);
    expect(await result).toMatchObject({ code: 'CLIENT_DEADLINE' });
  });
  it('does not submit work when the caller is already cancelled', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(requestScan(input(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('preserves a structured HTTP failure instead of inventing a scan result', async () => {
    fetchMock.mockResolvedValue(response({ error: { code: 'QUEUE_FULL', message: 'Fixture queue busy' } }, 429));
    await expect(requestScan(input())).rejects.toMatchObject({ code: 'QUEUE_FULL', status: 429 });
  });
});

it('rejects observation dates beyond the requested cutoff even when no stock matches',async()=>{
  fetchMock.mockResolvedValueOnce(response(receipt,202)).mockResolvedValueOnce(response(done('scan',scan({asOf:'2026-09-29',observationDates:{earliest:'2026-09-30',latest:'2026-09-30',staleSymbols:0}}))));
  await expect(requestScan({...input(),asOf:'2026-09-29'})).rejects.toMatchObject({code:'RESULT_IDENTITY_MISMATCH'});
});
