import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { JobStore, MAX_JOB_RECORD_JSON_BYTES } from '../../server/storage/jobsDb';
import { JobManager, SERVER_RESTARTED_ERROR, type ResearchPayload, type ResearchResult } from '../../server/jobs/manager';
import { strategy } from '../fixtures/research';

const pending: JobManager[] = [];
const folders: string[] = [];
afterEach(async () => {
  for (const manager of pending.splice(0)) await manager.shutdown();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function temporaryDb(): Promise<string> {
  const base = path.resolve('src/test/.tmp');
  await mkdir(base, { recursive: true });
  const folder = await mkdtemp(path.join(base, 'jobs-db-'));
  folders.push(folder);
  return path.join(folder, 'jobs.db');
}
const scanInput = (): ResearchPayload => ({ kind: 'scan', strategy: strategy(), universe: 'NIFTY_50', mode: 'demo', limit: 5 });
const scanResult = (): ResearchResult => ({ universe: 'NIFTY_50', scanned: 0, matches: [] }) as unknown as ResearchResult;
async function terminal(manager: JobManager, id: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const job = manager.get(id)!;
    if (!['queued', 'running'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Job did not finish');
}
function gate() {
  let release!: () => void;
  const opened = new Promise<void>(resolve => { release = resolve; });
  return { opened, release };
}

describe('durable job store', () => {
  it('round-trips lifecycle, payload, result and idempotency keys', async () => {
    const file = await temporaryDb();
    const store = new JobStore(file);
    const now = new Date('2026-11-18T10:00:00.000Z').toISOString();
    store.save({
      id: 'round-trip', kind: 'scan', lane: 'scan', hash: 'abc', status: 'running', stage: 'scan 12/50',
      createdAt: now, startedAt: now, progress: { processed: 12, total: 50 }, payload: scanInput(),
    }, { writePayload: true });
    store.saveKey('retry-key', 'round-trip', 'abc');
    store.close();

    const reopened = new JobStore(file);
    const row = reopened.load('round-trip')!;
    expect(row).toMatchObject({ id: 'round-trip', kind: 'scan', status: 'running', stage: 'scan 12/50', progress: { processed: 12, total: 50 } });
    expect(row.payload).toEqual(scanInput());
    expect(reopened.loadKey('retry-key')).toEqual({ key: 'retry-key', jobId: 'round-trip', hash: 'abc' });

    reopened.save({ ...row, status: 'succeeded', stage: 'succeeded', finishedAt: now, result: scanResult() }, { clearPayload: true });
    const terminal = reopened.load('round-trip')!;
    expect(terminal).toMatchObject({ status: 'succeeded', result: scanResult() });
    expect(terminal.payload).toBeUndefined();
    reopened.close();
  });

  it('refuses a field above the 8 MB cap with a typed error instead of truncating', async () => {
    expect(MAX_JOB_RECORD_JSON_BYTES).toBe(8 * 1024 * 1024);
    const store = new JobStore(await temporaryDb());
    const now = new Date().toISOString();
    const oversized = 'x'.repeat(MAX_JOB_RECORD_JSON_BYTES + 16);
    expect(() => store.save({ id: 'huge', kind: 'scan', lane: 'scan', hash: 'h', status: 'succeeded', stage: 'succeeded', createdAt: now, result: oversized })).toThrowError(/caps? each field at 8 MB/);
    try { store.save({ id: 'huge', kind: 'scan', lane: 'scan', hash: 'h', status: 'succeeded', stage: 'succeeded', createdAt: now, result: oversized }); }
    catch (error) { expect(error).toMatchObject({ code: 'JOB_RECORD_TOO_LARGE', status: 413 }); }
    // The failed write never landed as a partial record.
    expect(store.load('huge')).toBeUndefined();
    store.close();
  });
});

describe('durable job manager', () => {
  it('serves a completed result after the manager is re-instantiated', async () => {
    const dbPath = await temporaryDb();
    const first = new JobManager({ dbPath, executor: async () => scanResult() });
    pending.push(first);
    const job = first.enqueue(scanInput());
    const done = await terminal(first, job.id);
    expect(done.status).toBe('succeeded');
    await first.shutdown();
    pending.splice(pending.indexOf(first), 1);

    const second = new JobManager({ dbPath, executor: async () => scanResult() });
    pending.push(second);
    expect(second.durability).toMatchObject({ enabled: true, recovered: 1 });
    expect(second.get(job.id)).toMatchObject({ id: job.id, status: 'succeeded', result: scanResult() });
    // The terminal payload is cleared: finished work is not resumable.
    expect(() => second.resume(job.id)).toThrowError(/Only interrupted jobs/);
  });

  it('marks unfinished work interrupted on boot with a typed retryable reason', async () => {
    const dbPath = await temporaryDb();
    const store = new JobStore(dbPath);
    const now = new Date().toISOString();
    store.save({ id: 'crashed-running', kind: 'scan', lane: 'scan', hash: 'hash-1', status: 'running', stage: 'scan 12/50', createdAt: now, startedAt: now, progress: { processed: 12, total: 50 }, payload: scanInput() }, { writePayload: true });
    store.save({ id: 'crashed-queued', kind: 'scan', lane: 'scan', hash: 'hash-2', status: 'queued', stage: 'waiting', createdAt: now, payload: scanInput() }, { writePayload: true });
    store.save({ id: 'finished', kind: 'scan', lane: 'scan', hash: 'hash-3', status: 'succeeded', stage: 'succeeded', createdAt: now, finishedAt: now, result: scanResult() });
    store.close();

    const manager = new JobManager({ dbPath, executor: async () => scanResult() });
    pending.push(manager);
    for (const id of ['crashed-running', 'crashed-queued']) {
      expect(manager.get(id)).toMatchObject({
        id,
        status: 'interrupted',
        stage: 'interrupted',
        error: SERVER_RESTARTED_ERROR,
      });
      expect(manager.get(id)?.progress).toBeUndefined();
    }
    // Completed work is untouched and still readable.
    expect(manager.get('finished')).toMatchObject({ status: 'succeeded', result: scanResult() });
    expect(manager.get('crashed-running')?.error?.retryable).toBe(true);
  });

  it('resumes an interrupted job with the same id and payload', async () => {
    const dbPath = await temporaryDb();
    const first = new JobManager({ dbPath, executor: async () => { await new Promise(() => {}); return scanResult(); } });
    pending.push(first);
    const job = first.enqueue(scanInput());
    expect(job.status).toBe('running');
    await first.shutdown(); // graceful restart path: interrupted, not cancelled
    pending.splice(pending.indexOf(first), 1);
    expect(first.get(job.id)?.status).toBe('interrupted');

    let runs = 0;
    const second = new JobManager({ dbPath, executor: async payload => { runs++; expect(payload).toEqual(scanInput()); return scanResult(); } });
    pending.push(second);
    expect(second.get(job.id)).toMatchObject({ status: 'interrupted', error: { code: 'SERVER_RESTARTED' } });
    const resumed = second.resume(job.id);
    expect(resumed).toMatchObject({ id: job.id, status: expect.stringMatching(/queued|running/), resumeCount: 1 });
    expect(resumed.resumedAt).toBeTruthy();
    const done = await terminal(second, job.id);
    expect(done).toMatchObject({ id: job.id, status: 'succeeded', result: scanResult() });
    expect(runs).toBe(1);
  });

  it('rebuilds idempotency keys from SQLite so a retry does not double-run', async () => {
    const dbPath = await temporaryDb();
    const first = new JobManager({ dbPath, executor: async () => { await new Promise(() => {}); return scanResult(); } });
    pending.push(first);
    const job = first.enqueue(scanInput(), 'retry-after-restart');
    expect(job.status).toBe('running');
    await first.shutdown();
    pending.splice(pending.indexOf(first), 1);

    let runs = 0;
    const second = new JobManager({ dbPath, executor: async () => { runs++; return scanResult(); } });
    pending.push(second);
    // Same key + same payload after the restart: the stored job wins, no new run.
    const replay = second.enqueue(scanInput(), 'retry-after-restart');
    expect(replay.id).toBe(job.id);
    expect(replay.status).toBe('interrupted');
    expect(runs).toBe(0);
    expect(() => second.enqueue({ ...scanInput(), universe: 'BANK_NIFTY' } as ResearchPayload, 'retry-after-restart')).toThrowError(/different inputs/);

    second.resume(replay.id);
    expect((await terminal(second, replay.id)).status).toBe('succeeded');
    expect(runs).toBe(1);
    // And the finished job still answers the same key without another run.
    const settled = second.enqueue(scanInput(), 'retry-after-restart');
    expect(settled.id).toBe(job.id);
    expect(runs).toBe(1);
  });

  it('cancels an interrupted job so the Cancel button is not a dead control', async () => {
    const dbPath = await temporaryDb();
    const first = new JobManager({ dbPath, executor: async () => { await new Promise(() => {}); return scanResult(); } });
    pending.push(first);
    const job = first.enqueue(scanInput());
    await first.shutdown();
    pending.splice(pending.indexOf(first), 1);
    const second = new JobManager({ dbPath, executor: async () => scanResult() });
    pending.push(second);
    expect(second.get(job.id)?.status).toBe('interrupted');
    expect(second.cancel(job.id)).toMatchObject({ id: job.id, status: 'cancelled', error: { code: 'JOB_CANCELLED' } });
    expect(second.get(job.id)?.status).toBe('cancelled');
    const failure = (() => { try { second.resume(job.id); } catch (error) { return error as Record<string, unknown>; } throw new Error('Expected resume to fail.'); })();
    expect(failure).toMatchObject({ code: 'JOB_NOT_RESUMABLE', status: 409 });
  });

  it('rejects resume for unknown and non-interrupted jobs with typed statuses', async () => {
    const manager = new JobManager({ executor: async () => scanResult() });
    pending.push(manager);
    const failure = (work: () => unknown) => { try { work(); } catch (error) { return error as Record<string, unknown>; } throw new Error('Expected the call to fail.'); };
    expect(failure(() => manager.resume('missing'))).toMatchObject({ code: 'JOB_NOT_FOUND', status: 404 });
    const job = manager.enqueue(scanInput());
    await terminal(manager, job.id);
    expect(failure(() => manager.resume(job.id))).toMatchObject({ code: 'JOB_NOT_RESUMABLE', status: 409 });
  });

  it('keeps the live result and labels the record when the result exceeds the durable cap', async () => {
    const dbPath = await temporaryDb();
    const manager = new JobManager({ dbPath, executor: async () => ({ universe: 'NIFTY_50', payload: 'x'.repeat(MAX_JOB_RECORD_JSON_BYTES + 16) }) as unknown as ResearchResult });
    pending.push(manager);
    const job = manager.enqueue(scanInput());
    const done = await terminal(manager, job.id);
    expect(done.status).toBe('succeeded');
    expect(done.result).toBeTruthy();
    expect(done.persistence).toEqual({ durable: false, reason: 'JOB_RECORD_TOO_LARGE' });
    await manager.shutdown();
    pending.splice(pending.indexOf(manager), 1);
    const reopened = new JobManager({ dbPath, executor: async () => scanResult() });
    pending.push(reopened);
    // The lifecycle persisted honestly; only the oversized result is absent.
    expect(reopened.get(job.id)?.status).toBe('succeeded');
    expect(reopened.get(job.id)?.result).toBeUndefined();
  });
});
