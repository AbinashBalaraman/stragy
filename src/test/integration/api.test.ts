import request, { type Response, type Test } from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type AppJobService } from '../../server/app';
import { parseConfig, type RuntimeConfig } from '../../server/config';
import { JobManager, type ResearchPayload } from '../../server/jobs/manager';
import { ResearchRepository } from '../../server/storage/repository';
import { simulate } from '../../server/backtest/engine';
import { BacktestResponseSchema } from '../../shared/contracts/research';
import { validateStrategy } from '../../shared/strategy/schema';
import { canonicalStrategySignature } from '../../shared/strategy/backtestReview';
import { bars, strategy } from '../fixtures/research';

// Preserve production input validation, then replace data with tiny synthetic bars.
// No provider adapter, worker process, external fetch, or persistent file is used.
vi.mock('../../server/data/realMarketData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/data/realMarketData')>();
  const fixture = await import('../fixtures/research');
  const { createHash } = await import('node:crypto');
  return { ...actual, loadMarketSeries: vi.fn(async (...args: Parameters<typeof actual.loadMarketSeries>) => {
    const checked = await actual.loadMarketSeries(...args);
    const synthetic = fixture.bars([[100, 101, 99, 100], [100, 101, 99, 100], [110, 111, 109, 110]]);
    return { bars: synthetic, provenance: { ...checked.provenance,
      source: 'OFFLINE_API_TEST_FIXTURE', asOf: '2026-01-07', fetchedAt: '2026-01-07T10:00:00.000Z',
      actualRange: { start: '2026-01-05', end: '2026-01-07' },
      checksum: createHash('sha256').update(JSON.stringify(synthetic)).digest('hex'),
      warnings: ['Synthetic arithmetic fixture, not observed market data.'],
    } };
  }) };
});

const FIXTURE_TOKEN = 'synthetic-api-regression-token-not-a-real-credential';
const managers: JobManager[] = [];
const repositories: ResearchRepository[] = [];
let externalFetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  // createApp mutates these; stub first so teardown restores the original values.
  vi.stubEnv('DATA_MODE', 'demo');
  vi.stubEnv('AI_PROVIDER', 'none');
  // Fix data cutoff/rate-window time without replacing real timeout timers.
  vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 0, 8, 12));
  externalFetch = vi.fn(async () => { throw new Error('External network forbidden in API fixtures'); });
  vi.stubGlobal('fetch', externalFetch);
});
afterEach(async () => {
  try {
    await Promise.all(managers.splice(0).map(manager => manager.shutdown()));
    await Promise.all(repositories.splice(0).map(repository => repository.close()));
    expect(externalFetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});
const bounded = (test: Test) => test.timeout({ response: 1500, deadline: 2500 });
const body = () => ({ strategy: strategy(), start: '2026-01-05', end: '2026-01-07', asOf: '2026-01-07', seed: 7, robustness: false });
async function setup(overrides: Partial<RuntimeConfig> = {}, injectedJobs?: AppJobService) {
  const config = { ...parseConfig({ NODE_ENV: 'test', DATA_MODE: 'demo', AI_PROVIDER: 'none', STORAGE_MODE: 'ephemeral', MAX_BODY_BYTES: '1024', MAX_JOB_MS: '1000' }), ...overrides };
  const repository = await ResearchRepository.open({ maxRuns: 3 });
  repositories.push(repository);
  const executor = vi.fn(async (payload: ResearchPayload) => {
    if (payload.kind === 'scan' || payload.kind === 'market') throw new Error('Unexpected fixture job kind');
    const result = simulate(payload.strategy, payload.bars, { ...payload.options, robustness: false });
    return { ...result, backtestId: 'offline-fixture-run', executedAt: '2026-01-07T10:00:00.000Z', provenance: payload.provenance };
  });
  const manager = new JobManager({ executor, maxQueue: 2, maxMs: 1000, maxRetained: 3, workers: 1 });
  managers.push(manager);
  const enqueue = vi.spyOn(manager, 'enqueue');
  const app = await createApp({ config, repository, jobs: injectedJobs ?? manager, enableVite: false });
  return { app, manager, repository, executor, enqueue };
}
function errorContract(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers['content-type']).toMatch(/application\/json/);
  expect(response.body).toMatchObject({ success: false, error: { code, message: expect.any(String), requestId: expect.any(String), retryable: [429, 503, 504].includes(status) } });
  expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  expect(response.body).not.toHaveProperty('result');
}
async function poll(app: Express, id: string) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await bounded(request(app).get('/api/v2/jobs/' + encodeURIComponent(id)));
    expect(response.status).toBe(200);
    if (!['queued', 'running'].includes(response.body.status)) return response;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Fixture job did not finish within fixed polling budget');
}

describe('bounded offline API contracts', () => {
  it('reports healthy honest demo capabilities without live execution or verified AI', async () => {
    const { app, executor, enqueue } = await setup();
    const live = await bounded(request(app).get('/health/live'));
    expect(live.status).toBe(200);
    expect(live.body).toEqual({ status: 'ok' });
    const ready = await bounded(request(app).get('/health/ready'));
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'ready', mode: 'demo', persistence: 'ephemeral' });
    const health = await bounded(request(app).get('/api/health'));
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ status: 'ok', mode: 'demo', platform: 'Stragy research' });
    expect(Number.isFinite(Date.parse(health.body.time))).toBe(true);
    const capabilities = await bounded(request(app).get('/api/v2/capabilities'));
    expect(capabilities.status).toBe(200);
    expect(capabilities.body).toMatchObject({ schemaVersion: 2, mode: 'demo', demo: true, liveTrading: false, realDataConfigured: false, persistence: 'ephemeral', jobs: true, timeframes: ['1D'], directions: ['LONG'], orders: ['MARKET'], executionPolicy: 'next_open_long_cash_v1', ai: { provider: 'none', externalAiEnabled: false, connectionVerified: false, localHeuristic: { isAI: false } } });
    expect(capabilities.body.limitations.join(' ')).toMatch(/No broker orders are submitted/);
    expect(capabilities.headers['x-content-type-options']).toBe('nosniff');
    expect(capabilities.headers['x-frame-options']).toBe('DENY');
    expect(enqueue).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
  });
  it('rejects invalid strategy, numeric input and unknown input before enqueue', async () => {
    const { app, enqueue } = await setup();
    errorContract(await bounded(request(app).post('/api/v2/backtests').send({ strategy: {} })), 422, 'INVALID_STRATEGY');
    const invalid = await bounded(request(app).post('/api/v2/backtests').send({ ...body(), initialCapital: 99 }));
    errorContract(invalid, 422, 'VALIDATION_FAILED');
    expect(invalid.body.error.fieldErrors).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'initialCapital' })]));
    errorContract(await bounded(request(app).get('/api/symbols/not-a-number/bars')), 422, 'VALIDATION_FAILED');
    errorContract(await bounded(request(app).post('/api/v2/scans').send({ universe: 'NO_SUCH_UNIVERSE', strategy: strategy() })), 422, 'UNKNOWN_UNIVERSE');
    errorContract(await bounded(request(app).get('/api/does-not-exist')), 404, 'ROUTE_NOT_FOUND');
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('does not fabricate missing runs or jobs', async () => {
    const { app, repository, executor } = await setup();
    for (const route of ['/api/backtests/missing-run', '/api/v2/backtests/missing-run']) {
      const response = await bounded(request(app).get(route));
      errorContract(response, 404, 'BACKTEST_NOT_FOUND');
      expect(response.body).not.toHaveProperty('metrics');
    }
    errorContract(await bounded(request(app).get('/api/v2/jobs/missing-job')), 404, 'JOB_NOT_FOUND');
    errorContract(await bounded(request(app).delete('/api/v2/jobs/missing-job')), 404, 'JOB_NOT_FOUND');
    expect(repository.listRuns()).toEqual([]);
    expect(executor).not.toHaveBeenCalled();
  });
  it('enqueues v2 research, polls a valid result and retrieves immutable copies', async () => {
    const { app, manager, repository, executor } = await setup();
    const accepted = await bounded(request(app).post('/api/v2/backtests').set('Idempotency-Key', 'fixture-run').send(body()));
    expect(accepted.status).toBe(202);
    expect(accepted.body).toMatchObject({ schemaVersion: 2, jobId: expect.any(String) });
    expect(['queued', 'running', 'succeeded']).toContain(accepted.body.status);
    expect(accepted.body).not.toHaveProperty('result');
    const done = await poll(app, accepted.body.jobId);
    expect(done.body).toMatchObject({ id: accepted.body.jobId, kind: 'backtest', status: 'succeeded' });
    expect(BacktestResponseSchema.safeParse(done.body.result).success).toBe(true);
    expect(done.body.result.bars).toEqual(bars([[100, 101, 99, 100], [100, 101, 99, 100], [110, 111, 109, 110]]));
    expect(done.body.result.provenance.source).toBe('OFFLINE_API_TEST_FIXTURE');
    const original = JSON.parse(JSON.stringify(done.body.result));
    const runId = original.backtestId;
    const retrieved = await bounded(request(app).get('/api/v2/backtests/' + runId));
    expect(retrieved.status).toBe(200);
    expect(retrieved.body).toEqual({ success: true, result: original });
    done.body.result.metrics.netPnl = -999999;
    retrieved.body.result.strategy.name = 'caller mutation';
    const jobCopy = manager.get(accepted.body.jobId)!;
    if (!jobCopy.result || !('metrics' in jobCopy.result)) throw new Error('Missing fixture result');
    jobCopy.result.metrics.netPnl = -999999;
    repository.getRun(runId)!.bars[0].close = 999999;
    expect((await poll(app, accepted.body.jobId)).body.result).toEqual(original);
    expect((await bounded(request(app).get('/api/backtests/' + runId))).body.result).toEqual(original);
    await expect(repository.putRun({ ...original, metrics: { ...original.metrics, netPnl: -999999 } })).rejects.toMatchObject({ code: 'IMMUTABLE_RUN_CONFLICT', status: 409 });
    expect((await bounded(request(app).get('/api/v2/backtests/' + runId))).body.result).toEqual(original);
    const runs = await bounded(request(app).get('/api/v2/runs'));
    expect(runs.status).toBe(200);
    expect(runs.body.runs).toEqual([{ id: runId, name: original.strategy.name, executedAt: original.executedAt }]);
    expect(executor).toHaveBeenCalledTimes(1);
  });
  it('returns the engine-normalized strategy with execution defaults while preserving review identity', async () => {
    const { app } = await setup();
    const submitted = strategy();
    const accepted = await bounded(request(app).post('/api/v2/backtests').set('Idempotency-Key', 'fixture-normalized-strategy').send(body()));
    expect(accepted.status).toBe(202);
    const done = await poll(app, accepted.body.jobId);
    expect(done.body.status).toBe('succeeded');
    expect(done.body.result.strategy.execution).toMatchObject({
      executionPolicy: 'next_open_long_cash_v1',
      liquidateAtEnd: true,
    });
    expect(canonicalStrategySignature(done.body.result.strategy)).toBe(canonicalStrategySignature(submitted));
  });

  it('reuses identical idempotent requests but rejects conflicting input', async () => {
    const { app, executor } = await setup();
    const first = await bounded(request(app).post('/api/v2/backtests').set('Idempotency-Key', 'fixture-idempotency').send(body()));
    expect(first.status).toBe(202);
    const repeat = await bounded(request(app).post('/api/v2/backtests').set('Idempotency-Key', 'fixture-idempotency').send(body()));
    expect(repeat.status).toBe(202);
    expect(repeat.body.jobId).toBe(first.body.jobId);
    errorContract(await bounded(request(app).post('/api/v2/backtests').set('Idempotency-Key', 'fixture-idempotency').send({ ...body(), initialCapital: 200000 })), 409, 'IDEMPOTENCY_CONFLICT');
    expect((await poll(app, first.body.jobId)).body.status).toBe('succeeded');
    expect(executor).toHaveBeenCalledTimes(1);
  });
  it('rejects cross-origin writes while allowing same-origin writes and reads', async () => {
    const { app, enqueue } = await setup();
    errorContract(await bounded(request(app).post('/api/v2/backtests').set('Host', 'fixture.test').set('Origin', 'https://untrusted.invalid').send(body())), 403, 'ORIGIN_REJECTED');
    expect(enqueue).not.toHaveBeenCalled();
    expect((await bounded(request(app).get('/api/v2/capabilities').set('Origin', 'https://untrusted.invalid'))).status).toBe(200);
    const accepted = await bounded(request(app).post('/api/v2/backtests').set('Host', 'fixture.test').set('Origin', 'http://fixture.test').send(body()));
    expect(accepted.status).toBe(202);
    expect((await poll(app, accepted.body.jobId)).body.status).toBe('succeeded');
  });
  it('allows HTTPS browser chat and backtests behind Render HTTP without trusting proxy headers', async () => {
    const publicOrigin = 'https://stragy.onrender.com';
    const { app, enqueue, repository } = await setup({ NODE_ENV: 'production', EXPOSURE_MODE: 'demo-public', PUBLIC_ORIGIN: publicOrigin });
    expect(app.get('trust proxy')).toBe(false);
    const draft = await bounded(request(app).post('/api/v2/ai/proposals')
      .set('Host', 'internal-proxy.test:10000').set('Origin', publicOrigin)
      .set('X-Forwarded-Proto', 'http').set('X-Forwarded-Host', 'untrusted.invalid')
      .send({ prompt: 'set stop loss to 3%', currentStrategy: strategy(), allowLocalFallback: true }));
    expect(draft.status).toBe(200);
    expect(draft.body).toMatchObject({ ok: true, proposal: { method: 'local_heuristic', applied: false, executes: false, provider: { aiGenerated: false } } });
    expect(enqueue).not.toHaveBeenCalled();
    expect(repository.listRuns()).toEqual([]);
    const accepted = await bounded(request(app).post('/api/v2/backtests')
      .set('Host', 'internal-proxy.test:10000').set('Origin', publicOrigin).send(body()));
    expect(accepted.status).toBe(202);
    expect((await poll(app, accepted.body.jobId)).body.status).toBe('succeeded');
  });
  it.each([
    'https://untrusted.invalid', 'http://stragy.onrender.com',
    'https://stragy.onrender.com.untrusted.invalid', 'https://stragy.onrender.com:444',
    'https://stragy.onrender.com/', 'null',
  ])('keeps foreign or malformed origins rejected behind a proxy: %s', async origin => {
    const { app, enqueue } = await setup({ NODE_ENV: 'production', EXPOSURE_MODE: 'demo-public', PUBLIC_ORIGIN: 'https://stragy.onrender.com' });
    errorContract(await bounded(request(app).post('/api/v2/backtests')
      .set('Host', 'untrusted.invalid').set('Origin', origin)
      .set('X-Forwarded-Host', 'stragy.onrender.com').set('X-Forwarded-Proto', 'https')
      .send(body())), 403, 'ORIGIN_REJECTED');
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('rejects oversized and malformed JSON without enqueueing or saving', async () => {
    const { app, enqueue, repository } = await setup();
    errorContract(await bounded(request(app).post('/api/v2/backtests').send({ prompt: 'x'.repeat(2048) })), 413, 'BODY_TOO_LARGE');
    errorContract(await bounded(request(app).post('/api/v2/backtests').set('Content-Type', 'application/json').send('{"strategy":')), 400, 'MALFORMED_JSON');
    expect(enqueue).not.toHaveBeenCalled();
    expect(repository.listRuns()).toEqual([]);
    expect(repository.listStrategies()).toEqual([]);
  });
  it('requires synthetic Bearer authentication in private production', async () => {
    const { app, enqueue } = await setup({ NODE_ENV: 'production', EXPOSURE_MODE: 'private', API_ACCESS_TOKEN: FIXTURE_TOKEN });
    errorContract(await bounded(request(app).get('/api/v2/capabilities')), 401, 'UNAUTHORIZED');
    const wrong = await bounded(request(app).get('/api/v2/capabilities').set('Authorization', 'Bearer synthetic-wrong-token'));
    errorContract(wrong, 401, 'UNAUTHORIZED');
    expect(JSON.stringify(wrong.body)).not.toContain(FIXTURE_TOKEN);
    errorContract(await bounded(request(app).post('/api/v2/backtests').send(body())), 401, 'UNAUTHORIZED');
    const authorized = await bounded(request(app).get('/api/v2/capabilities').set('Authorization', 'Bearer ' + FIXTURE_TOKEN));
    expect(authorized.status).toBe(200);
    expect(authorized.headers['content-security-policy']).toContain("default-src 'self'");
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('rejects a bare token without the Bearer authorization scheme', async () => {
    const { app } = await setup({ NODE_ENV: 'production', EXPOSURE_MODE: 'private', API_ACCESS_TOKEN: FIXTURE_TOKEN });
    // Intended security contract, not the current permissive parsing behavior.
    errorContract(await bounded(request(app).get('/api/v2/capabilities').set('Authorization', FIXTURE_TOKEN)), 401, 'UNAUTHORIZED');
  });
  it('denies public-demo server saves and leaves storage unchanged', async () => {
    const { app, repository, enqueue } = await setup({ NODE_ENV: 'production', EXPOSURE_MODE: 'demo-public' });
    errorContract(await bounded(request(app).post('/api/strategies').send({ strategy: strategy() })), 403, 'PRIVATE_WRITE_REQUIRED');
    const saved = await bounded(request(app).get('/api/strategies'));
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ success: true, strategies: [], persistence: 'ephemeral' });
    expect(repository.listStrategies()).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('returns an explicit local draft without applying, saving or executing it', async () => {
    const { app, repository, enqueue, executor } = await setup();
    const current = strategy();
    const response = await bounded(request(app).post('/api/v2/ai/proposals').send({ prompt: 'set stop loss to 3%', currentStrategy: current, originatingRevision: 7, allowLocalFallback: true }));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, proposal: { schemaVersion: 2, status: 'draft', originatingRevision: 7, method: 'local_heuristic', applied: false, executes: false, provider: { name: 'local_heuristic', model: null, aiGenerated: false } } });
    expect(response.body.proposal.candidate.risk.stopLoss.value).toBe(3);
    // Legacy eq migrates to explicit approxEq tolerance; compare validated rules, not legacy DTO keys.
    expect(response.body.proposal.candidate.rules).toEqual(validateStrategy(current).data!.rules);
    expect(current.rules.entry[0].operator).toBe('eq');
    expect(current.risk.stopLoss.value).toBe(20);
    expect(repository.listStrategies()).toEqual([]);
    expect(repository.listRuns()).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
    errorContract(await bounded(request(app).post('/api/ai/scan-live').send({})), 422, 'EXPLICIT_SCAN_REQUIRED');
    errorContract(await bounded(request(app).post('/api/ai/optimize').send({ strategy: current })), 503, 'OPTIMIZER_WORKER_REQUIRED');
    expect(enqueue).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
  });
  it('fails closed rather than returning a succeeded job with a missing result', async () => {
    const jobs: AppJobService = {
      enqueue: vi.fn(() => { throw new Error('Unexpected enqueue'); }),
      get: vi.fn(id => ({ id, kind: 'backtest', status: 'succeeded' })), cancel: vi.fn(),
    };
    const { app, repository } = await setup({}, jobs);
    // Missing successful research output is a server contract error, not invented data.
    errorContract(await bounded(request(app).get('/api/v2/jobs/corrupt-fixture-job')), 500, 'INTERNAL_ERROR');
    expect(repository.listRuns()).toEqual([]);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });
});
