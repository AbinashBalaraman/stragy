import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations, MIGRATIONS } from '../../server/db/migrate';
import { resetDbForTests, setPoolForTests } from '../../server/db/pool';
import { clearState, loadState, saveState, type StoredState } from '../../server/ai/providerStore';

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'stragy-store-')); resetDbForTests(); });
afterEach(() => { setPoolForTests(null); resetDbForTests(); rmSync(dir, { recursive: true, force: true }); });

const state = (): StoredState => ({ version: 1, providers: [], chain: [], updatedAt: new Date().toISOString() });

describe('provider store file adapter', () => {
  it('round-trips and clears the JSON file without a database', async () => {
    const env = { AI_PROVIDERS_FILE: join(dir, 'providers.json') };
    expect(await loadState(env)).toBeNull();
    await saveState(state(), env);
    expect((await loadState(env))?.version).toBe(1);
    await clearState(env);
    expect(await loadState(env)).toBeNull();
  });
});

describe('provider store Postgres adapter (fake pool)', () => {
  function fakePool() {
    const calls: { sql: string; params?: unknown[] }[] = [];
    let row: unknown = undefined;
    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        if (/^SELECT state/i.test(sql)) return { rows: row === undefined ? [] : [{ state: row }] };
        if (/^INSERT/i.test(sql)) { row = JSON.parse(String(params?.[1])); return { rows: [] }; }
        if (/^DELETE/i.test(sql)) { row = undefined; return { rows: [] }; }
        return { rows: [] };
      },
      connect: async () => ({
        query: async () => ({ rows: [] }),
        release: () => undefined,
      }),
    };
    return { pool, calls };
  }

  it('loads, saves and deletes through ai_provider_settings', async () => {
    const { pool, calls } = fakePool();
    setPoolForTests(pool as never);
    const env = { DATABASE_URL: 'postgres://fake/db' };
    expect(await loadState(env)).toBeNull();
    await saveState(state(), env);
    expect((await loadState(env))?.version).toBe(1);
    await clearState(env);
    expect(await loadState(env)).toBeNull();
    expect(calls.some(call => /INSERT INTO ai_provider_settings/i.test(call.sql))).toBe(true);
    expect(calls.some(call => /ON CONFLICT \(id\) DO UPDATE/i.test(call.sql))).toBe(true);
    expect(calls.some(call => /DELETE FROM ai_provider_settings/i.test(call.sql))).toBe(true);
  });
});

describe('migration runner', () => {
  it('is idempotent', async () => {
    const applied = new Set<string>();
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        if (/^SELECT name FROM schema_migrations/i.test(sql)) return { rows: [...applied].map(name => ({ name })) };
        if (/^INSERT INTO schema_migrations/i.test(sql)) { applied.add(String(params?.[0])); return { rows: [] }; }
        return { rows: [] };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client } as never;
    expect(await runMigrations(pool)).toEqual([MIGRATIONS[0].name]);
    expect(await runMigrations(pool)).toEqual([]);
    expect(applied.has(MIGRATIONS[0].name)).toBe(true);
  });
});
