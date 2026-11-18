import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../../server/app';
import { parseConfig } from '../../server/config';
import { JobManager, type ResearchPayload, type ResearchResult } from '../../server/jobs/manager';
import type { CacheRefreshState } from '../../server/data/marketCacheRefresh';
import { ResearchRepository } from '../../server/storage/repository';

/**
 * GET /api/v2/jobs and the market cache routes. The cache worker is replaced by
 * the manager's executor seam so no provider or file is touched.
 */
const managers: JobManager[] = [];
const repositories: ResearchRepository[] = [];
const folders: string[] = [];

const config = () => parseConfig({ NODE_ENV: 'test', DATA_MODE: 'demo', AI_PROVIDER: 'none', STORAGE_MODE: 'ephemeral', MAX_BODY_BYTES: '1024', MAX_JOB_MS: '1000' });

const doneState = (): CacheRefreshState => ({
  id: 'cache-fixture',
  status: 'done',
  universe: 'NIFTY_50',
  total: 2,
  processed: 2,
  succeeded: 2,
  failed: 0,
  startedAt: '2026-11-18T10:00:00.000Z',
  finishedAt: '2026-11-18T10:00:01.000Z',
  errors: [],
});

type Executor = (payload: ResearchPayload, context: { signal: AbortSignal; progress: (stage: string, counts?: { processed: number; total: number }) => void }) => Promise<ResearchResult>;

async function boot(executor: Executor, dbPath?: string): Promise<{ app: Express; manager: JobManager }> {
  const manager = new JobManager({ ...(dbPath ? { dbPath } : {}), executor, maxQueue: 2, maxMs: 5_000, workers: 1 });
  managers.push(manager);
  const repository = await ResearchRepository.open({ maxRuns: 3 });
  repositories.push(repository);
  const app = await createApp({ config: config(), repository, jobs: manager, enableVite: false });
  return { app, manager };
}

async function temporaryDb(): Promise<string> {
  const base = path.resolve('src/test/.tmp');
  await mkdir(base, { recursive: true });
  const folder = await mkdtemp(path.join(base, 'jobs-list-'));
  folders.push(folder);
  return path.join(folder, 'jobs.db');
}

const pending: Executor = (_payload, { signal }) => new Promise<ResearchResult>((_resolve, reject) => {
  signal.addEventListener('abort', () => reject(new Error('cancelled by the test')), { once: true });
});

beforeEach(() => {
  vi.stubEnv('DATA_MODE', 'demo');
  vi.stubEnv('AI_PROVIDER', 'none');
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('DATABASE_URL_UNPOOLED', '');
});

afterEach(async () => {
  await Promise.all(managers.splice(0).map(manager => manager.shutdown().catch(() => undefined)));
  await Promise.all(repositories.splice(0).map(repository => repository.close().catch(() => undefined)));
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('GET /api/v2/jobs', () => {
  it('lists lifecycle summaries without result payloads and reports an interrupted job as resumable', async () => {
    const { app, manager } = await boot(pending);
    const accepted = await request(app).post('/api/v2/market/cache/refresh').send({ universe: 'NIFTY_50' });
    expect(accepted.status).toBe(202);
    const jobId = accepted.body.jobId as string;
    expect(jobId).toEqual(expect.any(String));
    expect(['queued', 'running']).toContain(accepted.body.status);

    // An identical active refresh is deduped: no second download is queued.
    const duplicate = await request(app).post('/api/v2/market/cache/refresh').send({ universe: 'NIFTY_50' });
    expect(duplicate.status).toBe(202);
    expect(duplicate.body.jobId).toBe(jobId);

    const running = await request(app).get('/api/v2/jobs');
    expect(running.status).toBe(200);
    const summary = (running.body.jobs as Array<Record<string, unknown>>).find(job => job.id === jobId)!;
    expect(summary).toMatchObject({
      id: jobId,
      kind: 'cache',
      status: expect.stringMatching(/queued|running/),
      stage: expect.any(String),
      createdAt: expect.any(String),
      resumable: false,
      universe: 'NIFTY_50',
    });
    expect(summary).not.toHaveProperty('result');
    expect(summary).not.toHaveProperty('payload');

    // A restart marks unfinished work interrupted; history must say so.
    await manager.shutdown();
    const interrupted = await request(app).get('/api/v2/jobs').query({ status: 'interrupted' });
    expect(interrupted.status).toBe(200);
    expect(interrupted.body.jobs).toHaveLength(1);
    expect(interrupted.body.jobs[0]).toMatchObject({ id: jobId, status: 'interrupted', resumable: true });
    expect(interrupted.body.jobs[0]).not.toHaveProperty('result');
  });

  it('completes a cache job through the generic job route and keeps it in history', async () => {
    const seen: ResearchPayload[] = [];
    const { app } = await boot(async payload => {
      seen.push(payload);
      return doneState();
    });
    const accepted = await request(app).post('/api/v2/market/cache/refresh').send({ symbolIds: [1, 2] });
    expect(accepted.status).toBe(202);
    expect(seen[0]).toEqual({ kind: 'cache', symbolIds: [1, 2] });

    let finished: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 100 && !finished; attempt++) {
      const response = await request(app).get('/api/v2/jobs/' + accepted.body.jobId);
      expect(response.status).toBe(200);
      if (response.body.status === 'succeeded') finished = response.body as Record<string, unknown>;
      else await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(finished).toMatchObject({ kind: 'cache', status: 'succeeded', result: doneState() });

    const history = await request(app).get('/api/v2/jobs');
    const summary = (history.body.jobs as Array<Record<string, unknown>>).find(job => job.id === accepted.body.jobId)!;
    expect(summary).toMatchObject({ id: accepted.body.jobId, kind: 'cache', status: 'succeeded', resumable: false });
    expect(summary).not.toHaveProperty('result');
  });

  it('reads terminal summaries from the durable store after a restart, still without result blobs', async () => {
    const dbPath = await temporaryDb();
    const first = await boot(async () => doneState(), dbPath);
    const accepted = await request(first.app).post('/api/v2/market/cache/refresh').send({ universe: 'NIFTY_50' });
    expect(accepted.status).toBe(202);
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await request(first.app).get('/api/v2/jobs/' + accepted.body.jobId);
      if (response.body.status === 'succeeded') break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    await first.manager.shutdown();

    // A second manager on the same file must not re-run the completed cache job.
    const second = await boot(async () => { throw new Error('A stored result must not re-run'); }, dbPath);
    const history = await request(second.app).get('/api/v2/jobs');
    expect(history.status).toBe(200);
    const summary = (history.body.jobs as Array<Record<string, unknown>>).find(job => job.id === accepted.body.jobId)!;
    expect(summary).toMatchObject({ id: accepted.body.jobId, kind: 'cache', status: 'succeeded', resumable: false });
    expect(summary).not.toHaveProperty('result');
    const full = await request(second.app).get('/api/v2/jobs/' + accepted.body.jobId);
    expect(full.status).toBe(200);
    expect(full.body).toMatchObject({ id: accepted.body.jobId, kind: 'cache', status: 'succeeded', result: doneState() });
  });

  it('validates the list query instead of silently clamping', async () => {
    const { app } = await boot(pending);
    for (const query of [{ limit: '51' }, { limit: '0' }, { status: 'bogus' }]) {
      const response = await request(app).get('/api/v2/jobs').query(query);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
    const limited = await request(app).get('/api/v2/jobs').query({ limit: '1' });
    expect(limited.status).toBe(200);
    expect(Array.isArray(limited.body.jobs)).toBe(true);
  });
});

describe('market cache routes', () => {
  it('returns the cache stats shape without a provider call', async () => {
    const { app } = await boot(async () => doneState());
    const response = await request(app).get('/api/v2/market/cache');
    expect(response.status).toBe(200);
    const stats = response.body.stats as Record<string, unknown>;
    expect(Object.keys(stats).sort()).toEqual([
      'bars', 'dbBytes', 'dbPath', 'firstDate', 'hits', 'incrementalFetches', 'lastDate', 'lastFetchAt', 'misses', 'symbols',
    ]);
    expect(typeof stats.symbols).toBe('number');
    expect(typeof stats.bars).toBe('number');
    expect(typeof stats.dbBytes).toBe('number');
    expect(typeof stats.hits).toBe('number');
    expect(typeof stats.misses).toBe('number');
    expect(typeof stats.incrementalFetches).toBe('number');
    expect(typeof stats.dbPath).toBe('string');
    expect(stats.firstDate === null || typeof stats.firstDate === 'string').toBe(true);
    expect(stats.lastDate === null || typeof stats.lastDate === 'string').toBe(true);
    expect(stats.lastFetchAt === null || typeof stats.lastFetchAt === 'string').toBe(true);
  });

  it('accepts a bounded refresh body and rejects invalid input', async () => {
    const { app } = await boot(async () => doneState());
    const accepted = await request(app).post('/api/v2/market/cache/refresh').send({ universe: 'NIFTY_50', maxSymbols: 25 });
    expect(accepted.status).toBe(202);
    expect(accepted.body).toMatchObject({ jobId: expect.any(String), status: expect.stringMatching(/queued|running/) });

    for (const body of [
      { universe: 'x'.repeat(41) },
      { symbolIds: ['1'] },
      { symbolIds: Array.from({ length: 501 }, (_, index) => index + 1) },
      { maxSymbols: 0 },
      { maxSymbols: 501 },
      { unexpected: true },
    ]) {
      const response = await request(app).post('/api/v2/market/cache/refresh').send(body);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('reports 503 when no bounded job runner is configured', async () => {
    const repository = await ResearchRepository.open({ maxRuns: 3 });
    repositories.push(repository);
    const app = await createApp({ config: config(), repository, enableVite: false });
    const refresh = await request(app).post('/api/v2/market/cache/refresh').send({ universe: 'NIFTY_50' });
    expect(refresh.status).toBe(503);
    expect(refresh.body.error.code).toBe('JOB_RUNNER_UNAVAILABLE');
    const stats = await request(app).get('/api/v2/market/cache');
    expect(stats.status).toBe(200);
    expect(stats.body.stats).toHaveProperty('dbPath');
  });
});
