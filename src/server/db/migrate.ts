/**
 * Schema migrations. The SQL also lives in ./migrations/001_ai_provider_settings.sql;
 * it is embedded here so the built server does not depend on copying .sql assets.
 */
import type { Pool, PoolClient } from 'pg';

export interface Migration { name: string; sql: string }

export const MIGRATIONS: readonly Migration[] = [
  {
    name: '001_ai_provider_settings.sql',
    sql: `CREATE TABLE IF NOT EXISTS ai_provider_settings (
  id text PRIMARY KEY DEFAULT 'default',
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);`,
  },
];

/** Idempotent: each migration runs once and is recorded in schema_migrations. */
export async function runMigrations(pool: Pool): Promise<string[]> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = new Set<string>((await client.query('SELECT name FROM schema_migrations')).rows.map((row: { name: string }) => row.name));
    const ran: string[] = [];
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.name)) continue;
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
        await client.query('COMMIT');
        ran.push(migration.name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return ran;
  } finally {
    client.release();
  }
}
