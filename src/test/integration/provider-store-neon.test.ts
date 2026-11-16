import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { runMigrations } from '../../server/db/migrate';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('Neon provider settings integration', () => {
  it('writes, reads and deletes a test row on the dev branch', async () => {
    const pool = new Pool({
      connectionString: url,
      ssl: /sslmode=require/i.test(url!) ? { rejectUnauthorized: false } : undefined,
      max: 1,
    });
    const id = `test-${randomUUID()}`;
    try {
      await runMigrations(pool);
      await pool.query(
        `INSERT INTO ai_provider_settings (id, state) VALUES ($1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
        [id, JSON.stringify({ version: 1, providers: [], chain: [], updatedAt: new Date().toISOString() })],
      );
      const read = await pool.query('SELECT state FROM ai_provider_settings WHERE id = $1', [id]);
      expect(read.rows[0].state.version).toBe(1);
    } finally {
      await pool.query('DELETE FROM ai_provider_settings WHERE id = $1', [id]).catch(() => undefined);
      await pool.end();
    }
  }, 20_000);
});
