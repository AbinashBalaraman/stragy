import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createApp } from '../../server/app';
import { parseConfig } from '../../server/config';
import { getMarketSeries } from '../../server/data/marketSeries';
import { simulate } from '../../server/backtest/engine';
import { JobManager, type ResearchPayload } from '../../server/jobs/manager';
import { ResearchRepository } from '../../server/storage/repository';
import { strategy } from '../fixtures/research';

const repositories: ResearchRepository[] = [], managers: JobManager[] = [];
let externalFetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv('DATA_MODE', 'demo'); vi.stubEnv('AI_PROVIDER', 'none');
  vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 13, 12));
  externalFetch = vi.fn(async () => { throw new Error('Network forbidden in ranged-backtest tests'); });
  vi.stubGlobal('fetch', externalFetch);
});
afterEach(async () => {
  try {
    await Promise.all(managers.splice(0).map(manager => manager.shutdown()));
    await Promise.all(repositories.splice(0).map(repository => repository.close()));
    expect(externalFetch).not.toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});
function movingAverageStrategy() {
  const ast = strategy();
  ast.name = 'Warm moving average regression';
  ast.indicators = [{ id: 'sma30', type: 'SMA', params: { period: 30 } }];
  ast.rules = { entry: [{ leftIndicator: 'sma30', operator: 'gt', rightValue: 0 }], exit: [{ leftIndicator: 'volume', operator: 'gt', rightValue: 1e12 }] };
  ast.costs.brokerageFlat = 1;
  return ast;
}
const input = () => ({ strategy: movingAverageStrategy(), start: '2025-06-02', end: '2025-06-06', asOf: '2025-06-30', initialCapital: 100000, seed: 7, robustness: false });
async function setup(withJobs = false) {
  const config = parseConfig({ NODE_ENV: 'test', DATA_MODE: 'demo', AI_PROVIDER: 'none', STORAGE_MODE: 'ephemeral', MAX_JOB_MS: '1000' });
  const repository = await ResearchRepository.open({ maxRuns: 10 }); repositories.push(repository);
  const executor = vi.fn(async (payload: ResearchPayload) => {
    if (payload.kind === 'scan' || payload.kind === 'market') throw new Error('Unexpected job');
    return simulate(payload.strategy, payload.bars, payload.options);
  });
  const manager = new JobManager({ executor, maxMs: 1000 }); managers.push(manager);
  const enqueue = vi.spyOn(manager, 'enqueue');
  const app = await createApp({ config, repository, jobs: withJobs ? manager : undefined, enableVite: false });
  return { app, enqueue, repository };
}

describe('API requested window retains indicator-only warmup', () => {
  it('matches full-history startIndex/endIndex semantics without pre-start executions or charges', async () => {
    const { app, repository } = await setup(), p = input();
    const response = await request(app).post('/api/backtests').send(p);
    expect(response.status).toBe(200);
    const result = response.body.result, full = getMarketSeries(1, { mode: 'demo' });
    const startIndex = full.bars.findIndex(bar => bar.date >= p.start), endIndex = full.bars.findIndex(bar => bar.date > p.end);
    const expected = simulate(p.strategy, full.bars, { initialCapital: p.initialCapital, startIndex, endIndex });
    for (const field of ['bars', 'indicatorsData', 'equityCurve', 'trades', 'costs', 'ledger', 'metrics', 'reconciliation'] as const) expect(result[field]).toEqual(expected[field]);
    expect(result.bars).toHaveLength(5);
    expect(result.equityCurve[0].equity).toBe(p.initialCapital);
    expect(result.indicatorsData.sma30[0]).not.toBeNull();
    expect(result.trades.length).toBeGreaterThan(0);
    // Warmup signals must not create pending orders at the first evaluation open.
    expect(result.ledger[0].timestamp).toBe(result.bars[1].timestamp);
    expect(result.ledger.every((fill: { timestamp: number }) => fill.timestamp >= result.bars[1].timestamp)).toBe(true);
    const cold = simulate(p.strategy, full.bars.slice(startIndex, endIndex), { initialCapital: p.initialCapital });
    expect(cold.trades).toHaveLength(0);
    expect(cold.indicatorsData.sma30.every(value => value === null)).toBe(true);
    const permitted = full.bars.slice(0, endIndex);
    expect(result.provenance).toMatchObject({ requestedRange: { start: p.start, end: p.end }, requestWindow: { start: p.start, end: p.end, asOf: p.asOf }, actualRange: { start: permitted[0].date, end: p.end }, evaluationRange: { start: p.start, end: p.end }, warmupBars: startIndex, checksum: createHash('sha256').update(JSON.stringify(permitted)).digest('hex') });
    expect(result.manifest.options).toMatchObject({ startIndex, endIndex, requestWindow: { start: p.start, end: p.end, asOf: p.asOf } });
    expect(result.manifest.data).toEqual(result.provenance);
    expect(repository.getRun(result.backtestId)?.manifest).toEqual(result.manifest);
  });
  it('clips to the latest completed session and sends exact requested bounds with warmup to jobs', async () => {
    vi.mocked(Date.now).mockReturnValue(Date.UTC(2025, 5, 4, 8)); // Before Indian session close: June 3 cutoff.
    const { app, enqueue } = await setup(true), p = { ...input(), end: '2025-06-10', asOf: '2025-06-12' };
    expect((await request(app).post('/api/v2/backtests').send(p)).status).toBe(202);
    const payload = enqueue.mock.calls[0][0];
    if (payload.kind === 'scan' || payload.kind === 'market') throw new Error('Unexpected job');
    expect(payload.bars[0].date).toBe('2024-01-01');
    expect(payload.bars.at(-1)?.date).toBe('2025-06-03');
    expect(payload.bars.every(bar => bar.date <= '2025-06-03')).toBe(true);
    expect(payload.options).toMatchObject({ startIndex: expect.any(Number), endIndex: payload.bars.length, requestWindow: { start: p.start, end: p.end, asOf: p.asOf } });
    expect(payload.provenance).toMatchObject({ evaluationRange: { start: p.start, end: '2025-06-03' } });
  });
  it('supports asOf without end and a one-session flat evaluation', async () => {
    const { app } = await setup();
    const response = await request(app).post('/api/backtests').send({ ...input(), start: '2025-06-06', end: undefined, asOf: '2025-06-06' });
    expect(response.status).toBe(200);
    expect(response.body.result.bars.map((bar: { date: string }) => bar.date)).toEqual(['2025-06-06']);
    expect(response.body.result.trades).toEqual([]); expect(response.body.result.ledger).toEqual([]);
    expect(response.body.result.costs.totalCharges).toBe(0); expect(response.body.result.metrics.finalEquity).toBe(100000);
    expect(response.body.result.indicatorsData.sma30[0]).not.toBeNull();
  });
  it('keeps exact requested bounds distinct when weekends select identical bars', async () => {
    const { app, enqueue } = await setup(true), p = { ...input(), start: '2025-06-01' };
    const first = await request(app).post('/api/v2/backtests').set('Idempotency-Key', 'window-identity').send(p);
    expect(first.status).toBe(202);
    const repeat = await request(app).post('/api/v2/backtests').set('Idempotency-Key', 'window-identity').send(p);
    expect(repeat.status).toBe(202); expect(repeat.body.jobId).toBe(first.body.jobId);
    const different = await request(app).post('/api/v2/backtests').set('Idempotency-Key', 'window-identity').send(input());
    expect(different.status).toBe(409); expect(different.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    const a = enqueue.mock.calls[0][0], b = enqueue.mock.calls[2][0];
    if (a.kind === 'scan' || a.kind === 'market' || b.kind === 'scan' || b.kind === 'market') throw new Error('Unexpected job');
    expect(a.bars).toEqual(b.bars); expect(a.options?.startIndex).toBe(b.options?.startIndex);
  });
  it.each([
    [{ start: '2025-02-30' }, 'INVALID_DATE'], [{ end: '2025-04-31' }, 'INVALID_DATE'], [{ asOf: '2025-13-01' }, 'INVALID_DATE'], [{ start: '2025-6-02' }, 'VALIDATION_FAILED'],
    [{ start: '2025-06-07' }, 'INVALID_RANGE'], [{ asOf: '2025-06-01' }, 'INVALID_RANGE'], [{ asOf: '2025-06-04' }, 'INVALID_RANGE'],
    [{ start: '2025-06-07', end: '2025-06-08' }, 'OUT_OF_COVERAGE'],
    [{ start: '2027-01-01', end: '2027-01-02', asOf: '2027-01-02' }, 'OUT_OF_COVERAGE'],
    [{ start: '2023-01-01', end: '2023-01-02', asOf: '2023-01-02' }, 'OUT_OF_COVERAGE'],
  ])('rejects invalid or empty window %j before enqueue/persistence', async (overrides, code) => {
    const { app, enqueue, repository } = await setup(true);
    for (const route of ['/api/backtests', '/api/v2/backtests']) {
      const response = await request(app).post(route).send({ ...input(), ...overrides });
      expect(response.status).toBe(422); expect(response.body.error.code).toBe(code);
    }
    expect(enqueue).not.toHaveBeenCalled(); expect(repository.listRuns()).toEqual([]);
  });
});
