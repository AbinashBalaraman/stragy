/**
 * Storage for provider settings. Postgres when DATABASE_URL is set, otherwise a
 * local JSON file. Keys inside `state` are already AES-256-GCM encrypted.
 * A DB outage falls back to the file/env baseline and never crashes chat.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { databaseConfigured, getDbStatus, getPool } from '../db/pool';

export interface StoredProvider {
  id: string;
  label: string;
  baseUrl: string;
  keyEnc?: string;
  extraHeaders?: Record<string, string>;
  enabled: boolean;
  builtin: boolean;
}
export interface StoredState {
  version: number;
  providers: StoredProvider[];
  chain: { providerId: string; model: string; vision: boolean; paidApproved: boolean }[];
  updatedAt: string;
}

const DEFAULT_ROW = 'default';

export function filePath(env: Record<string, string | undefined> = process.env): string {
  return resolve(process.cwd(), env.AI_PROVIDERS_FILE?.trim() || 'data/ai-providers.json');
}

export function readFileState(env: Record<string, string | undefined> = process.env): StoredState | null {
  const file = filePath(env);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as StoredState;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.providers) || !Array.isArray(parsed.chain)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeFileState(state: StoredState, env: Record<string, string | undefined> = process.env): void {
  const file = filePath(env);
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, file);
}

export function persistence(env: Record<string, string | undefined> = process.env): 'ephemeral' | 'durable' {
  return databaseConfigured(env) ? 'durable' : 'ephemeral';
}

export async function loadStateById(id: string, env: Record<string, string | undefined> = process.env): Promise<StoredState | null> {
  if (!databaseConfigured(env)) return id === DEFAULT_ROW ? readFileState(env) : null;
  const pool = getPool(env);
  if (!pool) return readFileState(env);
  try {
    const result = await pool.query('SELECT state FROM ai_provider_settings WHERE id = $1', [id]);
    return (result.rows[0]?.state as StoredState | undefined) ?? null;
  } catch (error) {
    console.warn(JSON.stringify({ event: 'provider_store_db_unavailable', fallback: 'file', message: (error as Error).message.replace(/(postgres(?:ql)?:\/\/)[^\s]+/gi, '$1[redacted]') }));
    return id === DEFAULT_ROW ? readFileState(env) : null;
  }
}

export async function saveStateById(id: string, state: StoredState, env: Record<string, string | undefined> = process.env): Promise<void> {
  if (!databaseConfigured(env)) { if (id === DEFAULT_ROW) writeFileState(state, env); return; }
  const pool = getPool(env);
  if (!pool) throw new Error('Provider settings storage is unavailable.');
  try {
    await pool.query(
      `INSERT INTO ai_provider_settings (id, state, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
      [id, JSON.stringify(state)],
    );
  } catch (error) {
    throw new Error(`Provider settings storage is unavailable: ${(error as Error).message.replace(/(postgres(?:ql)?:\/\/)[^\s]+/gi, '$1[redacted]')}`);
  }
}

export async function deleteStateById(id: string, env: Record<string, string | undefined> = process.env): Promise<void> {
  if (!databaseConfigured(env)) {
    if (id === DEFAULT_ROW) { const file = filePath(env); if (existsSync(file)) unlinkSync(file); }
    return;
  }
  const pool = getPool(env);
  if (!pool) throw new Error('Provider settings storage is unavailable.');
  await pool.query('DELETE FROM ai_provider_settings WHERE id = $1', [id]);
}

export const loadState = (env?: Record<string, string | undefined>) => loadStateById(DEFAULT_ROW, env);
export const saveState = (state: StoredState, env?: Record<string, string | undefined>) => saveStateById(DEFAULT_ROW, state, env);
export const clearState = (env?: Record<string, string | undefined>) => deleteStateById(DEFAULT_ROW, env);
export const getStoreDbStatus = getDbStatus;
