import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

/**
 * Durable job records. The manager keeps the in-memory Map as the cache and
 * writes through here on every lifecycle transition, so a restart can serve
 * finished results and offer resume for unfinished work.
 *
 * Result payloads can be large (scan matches, backtest curves, chart answers);
 * each JSON field is capped at 8 MB and refused with a typed error instead of
 * being silently truncated.
 */
export const MAX_JOB_RECORD_JSON_BYTES = 8 * 1024 * 1024;

export class JobStoreError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}

export interface JobStoreProgress { processed: number; total: number }
export interface JobStoreRecord {
  id: string;
  kind: string;
  lane: string;
  hash: string;
  status: string;
  stage: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  queuedBehind?: number;
  progress?: JobStoreProgress;
  payload?: unknown;
  result?: unknown;
  error?: unknown;
  resumedAt?: string;
  resumeCount?: number;
}
export interface JobStoreKey { key: string; jobId: string; hash: string }
export interface JobStoreSaveOptions {
  /** Write the payload JSON. It is written once on enqueue/resume, not on progress. */
  writePayload?: boolean;
  /** Drop the payload when a job reaches a terminal state (it is not resumable then). */
  clearPayload?: boolean;
}
/** Lifecycle-only row for the job history list; never carries result or payload blobs. */
export interface JobStoreSummary {
  id: string;
  kind: string;
  status: string;
  stage: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress?: JobStoreProgress;
  error?: unknown;
  universe?: string;
}

interface JobRow {
  id: string;
  kind: string;
  lane: string;
  hash: string;
  status: string;
  stage: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  queued_behind: number | null;
  progress_json: string | null;
  payload_json: string | null;
  result_json: string | null;
  error_json: string | null;
  resumed_at: string | null;
  resume_count: number | null;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    lane TEXT NOT NULL,
    hash TEXT NOT NULL,
    status TEXT NOT NULL,
    stage TEXT NOT NULL,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    queued_behind INTEGER,
    progress_json TEXT,
    payload_json TEXT,
    result_json TEXT,
    error_json TEXT,
    resumed_at TEXT,
    resume_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
  CREATE TABLE IF NOT EXISTS job_keys (
    key TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    hash TEXT NOT NULL
  ) STRICT;
`;

const UPSERT = `
  INSERT INTO jobs (id, kind, lane, hash, status, stage, created_at, started_at, finished_at,
    queued_behind, progress_json, result_json, error_json, resumed_at, resume_count, updated_at, payload_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  ON CONFLICT(id) DO UPDATE SET
    status = excluded.status,
    stage = excluded.stage,
    started_at = excluded.started_at,
    finished_at = excluded.finished_at,
    queued_behind = excluded.queued_behind,
    progress_json = excluded.progress_json,
    result_json = excluded.result_json,
    error_json = excluded.error_json,
    resumed_at = excluded.resumed_at,
    resume_count = excluded.resume_count,
    updated_at = excluded.updated_at
`;

/** A single-process SQLite store (node:sqlite). Writes are synchronous and bounded. */
export class JobStore {
  private db: DatabaseSync;
  private upsertStatement: StatementSync;
  private loadStatement: StatementSync;
  private listStatement: StatementSync;
  private summaryStatement: StatementSync;
  private payloadStatement: StatementSync;
  private clearPayloadStatement: StatementSync;
  private keyUpsertStatement: StatementSync;
  private keyLoadStatement: StatementSync;
  private keyListStatement: StatementSync;
  private keyDeleteStatement: StatementSync;
  private keyDeleteForJobStatement: StatementSync;
  private pruneStatement: StatementSync;
  private orphanKeysStatement: StatementSync;

  constructor(public readonly filePath: string, options: { maxPersisted?: number } = {}) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath, { timeout: 5_000 });
    // WAL keeps a concurrent reader (the PM's visibility tooling) from blocking
    // lifecycle writes, and survives the process being killed mid-write.
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
    this.maxPersisted = Math.max(20, options.maxPersisted ?? 200);
    this.upsertStatement = this.db.prepare(UPSERT);
    this.loadStatement = this.db.prepare('SELECT * FROM jobs WHERE id = ?');
    this.listStatement = this.db.prepare('SELECT * FROM jobs ORDER BY created_at ASC, rowid ASC');
    this.summaryStatement = this.db.prepare(`
      SELECT id, kind, status, stage, created_at, started_at, finished_at, progress_json, error_json,
        CASE WHEN kind IN ('scan', 'market', 'cache') THEN json_extract(payload_json, '$.universe') ELSE NULL END AS universe
      FROM jobs ORDER BY created_at DESC, rowid DESC LIMIT ?
    `);
    this.payloadStatement = this.db.prepare('UPDATE jobs SET payload_json = ? WHERE id = ?');
    this.clearPayloadStatement = this.db.prepare('UPDATE jobs SET payload_json = NULL WHERE id = ?');
    this.keyUpsertStatement = this.db.prepare('INSERT INTO job_keys (key, job_id, hash) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET job_id = excluded.job_id, hash = excluded.hash');
    this.keyLoadStatement = this.db.prepare('SELECT key, job_id, hash FROM job_keys WHERE key = ?');
    this.keyListStatement = this.db.prepare('SELECT key, job_id, hash FROM job_keys');
    this.keyDeleteStatement = this.db.prepare('DELETE FROM job_keys WHERE key = ?');
    this.keyDeleteForJobStatement = this.db.prepare('DELETE FROM job_keys WHERE job_id = ?');
    this.pruneStatement = this.db.prepare(`
      DELETE FROM jobs WHERE id IN (
        SELECT id FROM jobs WHERE status NOT IN ('queued', 'running', 'interrupted')
        ORDER BY COALESCE(finished_at, created_at) DESC LIMIT -1 OFFSET ?
      )
    `);
    this.orphanKeysStatement = this.db.prepare('DELETE FROM job_keys WHERE job_id NOT IN (SELECT id FROM jobs)');
  }
  private maxPersisted: number;

  private encode(field: 'payload' | 'result' | 'error' | 'progress', value: unknown): string {
    const text = JSON.stringify(value);
    if (text === undefined) throw new JobStoreError('INVALID_JOB_RECORD', `The job ${field} is not JSON serializable.`, 422);
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > MAX_JOB_RECORD_JSON_BYTES) {
      const size = (bytes / (1024 * 1024)).toFixed(2);
      throw new JobStoreError('JOB_RECORD_TOO_LARGE', `The job ${field} is ${size} MB; durable job records cap each field at 8 MB.`, 413);
    }
    return text;
  }
  private decode<T>(field: string, text: string | null): T | undefined {
    if (text === null) return undefined;
    try { return JSON.parse(text) as T; }
    catch { throw new JobStoreError('INVALID_STORED_JOB', `The stored job ${field} is not valid JSON.`); }
  }
  private toRecord(row: JobRow): JobStoreRecord {
    return {
      id: row.id,
      kind: row.kind,
      lane: row.lane,
      hash: row.hash,
      status: row.status,
      stage: row.stage,
      createdAt: row.created_at,
      ...(row.started_at !== null ? { startedAt: row.started_at } : {}),
      ...(row.finished_at !== null ? { finishedAt: row.finished_at } : {}),
      ...(row.queued_behind !== null ? { queuedBehind: row.queued_behind } : {}),
      ...(row.progress_json !== null ? { progress: this.decode<JobStoreProgress>('progress', row.progress_json) } : {}),
      ...(row.payload_json !== null ? { payload: this.decode<unknown>('payload', row.payload_json) } : {}),
      ...(row.result_json !== null ? { result: this.decode<unknown>('result', row.result_json) } : {}),
      ...(row.error_json !== null ? { error: this.decode<unknown>('error', row.error_json) } : {}),
      ...(row.resumed_at !== null ? { resumedAt: row.resumed_at } : {}),
      ...(row.resume_count !== null ? { resumeCount: row.resume_count } : {}),
    };
  }
  save(record: JobStoreRecord, options: JobStoreSaveOptions = {}): void {
    const now = new Date().toISOString();
    this.upsertStatement.run(
      record.id, record.kind, record.lane, record.hash, record.status, record.stage, record.createdAt,
      record.startedAt ?? null, record.finishedAt ?? null, record.queuedBehind ?? null,
      record.progress === undefined ? null : this.encode('progress', record.progress),
      record.result === undefined ? null : this.encode('result', record.result),
      record.error === undefined ? null : this.encode('error', record.error),
      record.resumedAt ?? null, record.resumeCount ?? 0, now,
    );
    if (options.clearPayload) this.clearPayloadStatement.run(record.id);
    else if (options.writePayload) this.payloadStatement.run(record.payload === undefined ? null : this.encode('payload', record.payload), record.id);
    if (['succeeded', 'failed', 'cancelled'].includes(record.status)) this.prune();
  }
  load(id: string): JobStoreRecord | undefined {
    const row = this.loadStatement.get(id) as JobRow | undefined;
    return row ? this.toRecord(row) : undefined;
  }
  list(): JobStoreRecord[] { return (this.listStatement.all() as unknown as JobRow[]).map(row => this.toRecord(row)); }
  /** Newest-first lifecycle rows; result and payload JSON are never read. */
  listSummaries(limit = 200): JobStoreSummary[] {
    const rows = this.summaryStatement.all(Math.max(1, Math.min(500, Math.trunc(limit)))) as unknown as Array<{
      id: string; kind: string; status: string; stage: string; created_at: string;
      started_at: string | null; finished_at: string | null; progress_json: string | null;
      error_json: string | null; universe: string | null;
    }>;
    return rows.map(row => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      stage: row.stage,
      createdAt: row.created_at,
      ...(row.started_at !== null ? { startedAt: row.started_at } : {}),
      ...(row.finished_at !== null ? { finishedAt: row.finished_at } : {}),
      ...(row.progress_json !== null ? { progress: this.decode<JobStoreProgress>('progress', row.progress_json) } : {}),
      ...(row.error_json !== null ? { error: this.decode<unknown>('error', row.error_json) } : {}),
      ...(row.universe !== null ? { universe: row.universe } : {}),
    }));
  }
  saveKey(key: string, jobId: string, hash: string): void { this.keyUpsertStatement.run(key, jobId, hash); }
  loadKey(key: string): JobStoreKey | undefined {
    const row = this.keyLoadStatement.get(key) as { key: string; job_id: string; hash: string } | undefined;
    return row ? { key: row.key, jobId: row.job_id, hash: row.hash } : undefined;
  }
  keys(): JobStoreKey[] { return (this.keyListStatement.all() as unknown as Array<{ key: string; job_id: string; hash: string }>).map(row => ({ key: row.key, jobId: row.job_id, hash: row.hash })); }
  deleteKey(key: string): void { this.keyDeleteStatement.run(key); }
  deleteKeysForJob(jobId: string): void { this.keyDeleteForJobStatement.run(jobId); }
  /** Keep the newest terminal rows; unfinished and interrupted rows are never pruned. */
  prune(): void {
    this.pruneStatement.run(this.maxPersisted);
    this.orphanKeysStatement.run();
  }
  close(): void { this.db.close(); }
}
