import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestMarketSnapshot, requestScan } from '../../client/api';
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
  it('bounds a stalled poll and even stalled cleanup to a finite deadline', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => init?.method === 'POST' ? Promise.resolve(response(receipt, 202)) : new Promise(() => {}));
    const result = requestScan(input()).catch(error => error);
    await vi.advanceTimersByTimeAsync(121501);
    expect(await result).toMatchObject({ code: 'CLIENT_DEADLINE' });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v2/jobs/fixture-job', expect.objectContaining({ method: 'DELETE' }));
  });
  it('bounds a stalled response body rather than waiting forever after HTTP headers', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 202, json: () => new Promise(() => {}) } as Response);
    const result = requestScan(input()).catch(error => error);
    await vi.advanceTimersByTimeAsync(120001);
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
