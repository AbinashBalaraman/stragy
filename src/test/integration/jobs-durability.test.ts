import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../../server/app';
import { parseConfig } from '../../server/config';
import { JobManager, type ResearchPayload, type ResearchResult } from '../../server/jobs/manager';
import { ResearchRepository } from '../../server/storage/repository';

/**
 * Simulates a restart in-process: the first manager is shut down (it marks
 * unfinished work `interrupted`), then a second manager opens the same SQLite
 * file and the real express app is rebuilt around it. No file is deleted.
 */
const managers: JobManager[] = [];
const repositories: ResearchRepository[] = [];
const folders: string[] = [];
beforeEach(() => {
  vi.stubEnv('DATA_MODE', 'demo');
  vi.stubEnv('AI_PROVIDER', 'none');
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('DATABASE_URL_UNPOOLED', '');
});
afterEach(async () => {
  try {
    await Promise.all(managers.splice(0).map(manager => manager.shutdown()));
    await Promise.all(repositories.splice(0).map(repository => repository.close()));
  } finally {
    vi.unstubAllEnvs();
    for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
  }
});
async function temporaryDb(): Promise<string> {
  const base = path.resolve('src/test/.tmp');
  await mkdir(base, { recursive: true });
  const folder = await mkdtemp(path.join(base, 'jobs-route-'));
  folders.push(folder);
  return path.join(folder, 'jobs.db');
}
const config = () => parseConfig({ NODE_ENV: 'test', DATA_MODE: 'demo', AI_PROVIDER: 'none', STORAGE_MODE: 'ephemeral', MAX_BODY_BYTES: '1024', MAX_JOB_MS: '1000' });
const scanResult = (): ResearchResult => ({ universe: 'NIFTY_50', scanned: 3, matches: [] }) as unknown as ResearchResult;
async function boot(dbPath: string, executor: () => Promise<ResearchResult>): Promise<{ app: Express; manager: JobManager }> {
  const manager = new JobManager({ dbPath, executor });
  managers.push(manager);
  const repository = await ResearchRepository.open({ maxRuns: 3 });
  repositories.push(repository);
  const app = await createApp({ config: config(), repository, jobs: manager, enableVite: false });
  return { app, manager };
}
async function poll(app: Express, id: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const response = await request(app).get('/api/v2/jobs/' + encodeURIComponent(id));
    expect(response.status).toBe(200);
    if (!['queued', 'running', 'interrupted'].includes(response.body.status)) return response;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Job did not reach a terminal state');
}

describe('durable job routes', () => {
  it('serves a completed result through GET after the manager is re-instantiated', async () => {
    const dbPath = await temporaryDb();
    const first = await boot(dbPath, async () => scanResult());
    const accepted = await request(first.app).post('/api/v2/scans').set('Idempotency-Key', 'restart-proof-key').send({ universe: 'NIFTY_50' });
    expect(accepted.status).toBe(202);
    const jobId = accepted.body.jobId as string;
    const finished = await poll(first.app, jobId);
    expect(finished.body).toMatchObject({ id: jobId, kind: 'scan', status: 'succeeded', result: scanResult() });

    await first.manager.shutdown();
    managers.splice(managers.indexOf(first.manager), 1);

    // Second life: a manager that must not run anything, on the same file.
    const second = await boot(dbPath, async () => { throw new Error('A recovered result must not re-run work'); });
    const recovered = await request(second.app).get('/api/v2/jobs/' + jobId);
    expect(recovered.status).toBe(200);
    expect(recovered.body).toMatchObject({ id: jobId, status: 'succeeded', result: scanResult() });
    // The same idempotency key resolves to the stored job, not a second run.
    const replay = await request(second.app).post('/api/v2/scans').set('Idempotency-Key', 'restart-proof-key').send({ universe: 'NIFTY_50' });
    expect(replay.status).toBe(202);
    expect(replay.body.jobId).toBe(jobId);
  });

  it('marks an interrupted job, resumes it with the same id through the route, and answers typed 409s', async () => {
    const dbPath = await temporaryDb();
    const first = await boot(dbPath, async () => { await new Promise(() => {}); return scanResult(); });
    const accepted = await request(first.app).post('/api/v2/scans').send({ universe: 'NIFTY_50' });
    expect(accepted.status).toBe(202);
    expect(accepted.body.status).toBe('running');
    const jobId = accepted.body.jobId as string;
    await first.manager.shutdown();
    managers.splice(managers.indexOf(first.manager), 1);

    let resumes = 0;
    const second = await boot(dbPath, async () => { resumes++; return scanResult(); });
    const interrupted = await request(second.app).get('/api/v2/jobs/' + jobId);
    expect(interrupted.body).toMatchObject({ id: jobId, status: 'interrupted', error: { code: 'SERVER_RESTARTED', retryable: true } });

    const resumed = await request(second.app).post('/api/v2/jobs/' + jobId + '/resume');
    expect(resumed.status).toBe(200);
    expect(resumed.body).toMatchObject({ id: jobId, status: expect.stringMatching(/queued|running/), resumeCount: 1 });
    const finished = await poll(second.app, jobId);
    expect(finished.body).toMatchObject({ id: jobId, status: 'succeeded', result: scanResult() });
    expect(resumes).toBe(1);

    const conflict = await request(second.app).post('/api/v2/jobs/' + jobId + '/resume');
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toMatchObject({ code: 'JOB_NOT_RESUMABLE' });

    const missing = await request(second.app).post('/api/v2/jobs/does-not-exist/resume');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatchObject({ code: 'JOB_NOT_FOUND' });

    // The resume route sits behind the same origin middleware as every write.
    const crossOrigin = await request(second.app).post('/api/v2/jobs/' + jobId + '/resume').set('Origin', 'https://evil.example');
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.body.error).toMatchObject({ code: 'ORIGIN_REJECTED' });
  });
});
