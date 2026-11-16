import { Pool } from 'pg';

type DbStatus = 'ok' | 'unavailable' | 'not-configured';

let pool: Pool | null = null;
let migrationPool: Pool | null = null;
let status: DbStatus = 'not-configured';
let statusCheckedAt = 0;
let initPromise: Promise<void> | null = null;
let testPool: Pool | null = null;

function sslFor(connectionString: string) {
  return /sslmode=require/i.test(connectionString) ? { rejectUnauthorized: false } : undefined;
}

export function databaseConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.DATABASE_URL);
}

export function getPool(env: Record<string, string | undefined> = process.env): Pool | null {
  if (testPool) return testPool;
  if (!env.DATABASE_URL) return null;
  if (!pool) pool = new Pool({ connectionString: env.DATABASE_URL, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, ssl: sslFor(env.DATABASE_URL) });
  return pool;
}

/** Direct connection is preferred for migrations; the pooled URL is the fallback. */
export function getMigrationPool(env: Record<string, string | undefined> = process.env): Pool | null {
  if (testPool) return testPool;
  const url = env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;
  if (!url) return null;
  if (!migrationPool) migrationPool = new Pool({ connectionString: url, max: 2, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, ssl: sslFor(url) });
  return migrationPool;
}

/** Test seam. Pass null to restore the real pools. */
export function setPoolForTests(value: Pool | null): void {
  testPool = value;
  status = value ? 'ok' : 'not-configured';
  statusCheckedAt = Date.now();
}

export async function getDbStatus(env: Record<string, string | undefined> = process.env, refresh = false): Promise<DbStatus> {
  if (!databaseConfigured(env)) return 'not-configured';
  if (!refresh && Date.now() - statusCheckedAt < 10_000) return status;
  const target = getPool(env);
  if (!target) return 'unavailable';
  try {
    await target.query('SELECT 1');
    status = 'ok';
  } catch {
    status = 'unavailable';
  }
  statusCheckedAt = Date.now();
  return status;
}

export async function initializeDatabase(env: Record<string, string | undefined> = process.env): Promise<DbStatus> {
  if (!databaseConfigured(env)) { status = 'not-configured'; return status; }
  if (initPromise) { await initPromise; return status; }
  initPromise = (async () => {
    try {
      const migrationTarget = getMigrationPool(env);
      if (!migrationTarget) { status = 'unavailable'; return; }
      const { runMigrations } = await import('./migrate');
      await runMigrations(migrationTarget);
      status = await getDbStatus(env, true);
    } catch (error) {
      status = 'unavailable';
      console.warn(JSON.stringify({ event: 'db_unavailable', message: (error as Error).message.replace(/(postgres(?:ql)?:\/\/)[^\s]+/gi, '$1[redacted]') }));
    }
  })();
  await initPromise;
  return status;
}

/** Test seam. */
export function resetDbForTests(): void { pool = null; migrationPool = null; status = 'not-configured'; statusCheckedAt = 0; initPromise = null; testPool = null; }
