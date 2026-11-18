import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { OHLCVBar } from '../../shared/strategy/types';

/**
 * Durable daily-candle store.
 *
 * The owner's complaint is that every scan re-downloads the same daily candles.
 * This module is the single writer/reader for those bars:
 *   - SQLite (node:sqlite) in WAL mode, so every scan/backtest worker thread
 *     opens its own connection and readers never block a writer.
 *   - `(symbol_id, date)` is the primary key, so an incremental upsert is
 *     idempotent and an overlap request can correct a bar without duplicating it.
 *   - Covered history is never deleted. A tail refresh only upserts the rows
 *     the provider returned.
 *   - Counters live in `meta`, so cache hits/misses survive a restart.
 *
 * Tests must set STRAGY_MARKET_DB to a temp path (see candle-store.test.ts);
 * under NODE_ENV=test with no override the store uses a private in-memory DB so
 * a unit test can never touch the owner's real `.data/market/candles.db`.
 */

export interface CandleCoverage {
  symbolId: number;
  bars: number;
  firstDate: string | null;
  lastDate: string | null;
  fetchedAt: string | null;
  /** Last completed session date the store has checked (not necessarily a bar date on holidays). */
  checkedThrough: string | null;
  source: string | null;
  providerSymbol: string | null;
}

export interface MarketCacheStats {
  symbols: number;
  bars: number;
  firstDate: string | null;
  lastDate: string | null;
  dbBytes: number;
  hits: number;
  misses: number;
  incrementalFetches: number;
  lastFetchAt: string | null;
  dbPath: string;
}

export type MarketCacheCounter = 'hits' | 'misses' | 'incremental_fetches';

const DATABASE_FILE = path.join('.data', 'market', 'candles.db');
let database: DatabaseSync | null = null;
let openPath: string | null = null;

/** Resolve the DB path every time a connection is opened, so tests can override it. */
export function getMarketDbPath(): string {
  const override = process.env.STRAGY_MARKET_DB?.trim();
  if (override) return override === ':memory:' ? ':memory:' : path.resolve(override);
  if (process.env.NODE_ENV === 'test') return ':memory:';
  return path.join(process.cwd(), DATABASE_FILE);
}

function openDatabase(): DatabaseSync {
  const target = getMarketDbPath();
  if (database && openPath === target) return database;
  closeMarketCache();
  if (target !== ':memory:') mkdirSync(path.dirname(target), { recursive: true });
  const db = new DatabaseSync(target);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS candles (
      symbol_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (symbol_id, date)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS candles_date_idx ON candles (date);
    CREATE TABLE IF NOT EXISTS coverage (
      symbol_id INTEGER PRIMARY KEY,
      first_date TEXT,
      last_date TEXT,
      bars INTEGER NOT NULL DEFAULT 0,
      last_fetch_at TEXT,
      checked_through TEXT,
      source TEXT,
      provider_symbol TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS fetch_leases (
      symbol_id INTEGER PRIMARY KEY,
      owner TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    ) STRICT;
  `);
  database = db;
  openPath = target;
  return db;
}

/** Close the process-local connection. Safe to call repeatedly; tests use it to prove persistence. */
export function closeMarketCache(): void {
  if (database) {
    try { database.close(); } catch { /* already closed */ }
  }
  database = null;
  openPath = null;
}

function db(): DatabaseSync {
  return openDatabase();
}

function transaction<T>(work: (database: DatabaseSync) => T): T {
  const connection = db();
  connection.exec('BEGIN IMMEDIATE');
  try {
    const result = work(connection);
    connection.exec('COMMIT');
    return result;
  } catch (error) {
    try { connection.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
    throw error;
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function integer(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function metaValue(key: string): string | null {
  const row = db().prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? text(row.value) : null;
}

function setMeta(key: string, value: string): void {
  db().prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function bumpMeta(key: MarketCacheCounter): void {
  db().prepare(
    "INSERT INTO meta (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)"
  ).run(key);
}

/** Read the last completed-session coverage for one symbol, or null when never fetched. */
export function getCandleCoverage(symbolId: number): CandleCoverage | null {
  const row = db().prepare(
    'SELECT symbol_id, first_date, last_date, bars, last_fetch_at, checked_through, source, provider_symbol FROM coverage WHERE symbol_id = ?'
  ).get(symbolId);
  if (!row) return null;
  return {
    symbolId: integer(row.symbol_id, symbolId),
    bars: integer(row.bars),
    firstDate: text(row.first_date),
    lastDate: text(row.last_date),
    fetchedAt: text(row.last_fetch_at),
    checkedThrough: text(row.checked_through),
    source: text(row.source),
    providerSymbol: text(row.provider_symbol)
  };
}

export interface CandleWriteResult {
  written: number;
  skipped: number;
}

/**
 * Upsert only the supplied bars. Existing rows outside the supplied set are
 * untouched, which is what makes a 2-trading-day overlap safe for corrections.
 */
export function upsertCandles(symbolId: number, bars: readonly OHLCVBar[], source: string, fetchedAt: string): CandleWriteResult {
  if (!Array.isArray(bars) || !bars.length) return { written: 0, skipped: 0 };
  let skipped = 0;
  return transaction(connection => {
    const statement = connection.prepare(`
      INSERT INTO candles (symbol_id, date, timestamp, open, high, low, close, volume, source, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol_id, date) DO UPDATE SET
        timestamp = excluded.timestamp,
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        volume = excluded.volume,
        source = excluded.source,
        fetched_at = excluded.fetched_at
    `);
    let written = 0;
    for (const bar of bars) {
      if (!bar || typeof bar.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(bar.date)) { skipped++; continue; }
      if (![bar.timestamp, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)) { skipped++; continue; }
      if (Math.min(bar.open, bar.high, bar.low, bar.close) <= 0 || bar.volume < 0 || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.low > bar.high) { skipped++; continue; }
      statement.run(
        symbolId,
        bar.date,
        Math.trunc(bar.timestamp),
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        bar.volume,
        source,
        fetchedAt
      );
      written++;
    }
    // Coverage is updated in the same transaction as the bars. If the process
    // dies before markCandleFetch(), the next load still knows what is covered
    // and does not download the same history again.
    connection.prepare(`
      INSERT INTO coverage (symbol_id, first_date, last_date, bars, last_fetch_at, source)
      SELECT ?, MIN(date), MAX(date), COUNT(*), ?, ? FROM candles WHERE symbol_id = ?
      ON CONFLICT(symbol_id) DO UPDATE SET
        first_date = excluded.first_date,
        last_date = excluded.last_date,
        bars = excluded.bars,
        last_fetch_at = excluded.last_fetch_at,
        source = excluded.source
    `).run(symbolId, fetchedAt, source, symbolId);
    return { written, skipped };
  });
}

/**
 * Record a successful provider check even when it returned no new completed
 * bars (holiday/weekend). `checkedThrough` is the completed session the check
 * covered, so the next load can prove it does not need to ask again.
 */
export function markCandleFetch(symbolId: number, source: string, checkedThrough: string, fetchedAt: string, providerSymbol?: string | null): void {
  transaction(connection => {
    connection.prepare(`
      INSERT INTO coverage (symbol_id, first_date, last_date, bars, last_fetch_at, checked_through, source, provider_symbol)
      VALUES (?, NULL, NULL, 0, ?, ?, ?, ?)
      ON CONFLICT(symbol_id) DO UPDATE SET
        last_fetch_at = excluded.last_fetch_at,
        checked_through = excluded.checked_through,
        source = excluded.source,
        provider_symbol = COALESCE(excluded.provider_symbol, coverage.provider_symbol)
    `).run(symbolId, fetchedAt, checkedThrough, source, providerSymbol ?? null);
    connection.prepare(`
      UPDATE coverage SET
        first_date = (SELECT MIN(date) FROM candles WHERE symbol_id = ?),
        last_date = (SELECT MAX(date) FROM candles WHERE symbol_id = ?),
        bars = (SELECT COUNT(*) FROM candles WHERE symbol_id = ?)
      WHERE symbol_id = ?
    `).run(symbolId, symbolId, symbolId, symbolId);
  });
}

/** Counters are persisted so a restart does not reset the owner's cache proof. */
export function recordCacheEvent(kind: MarketCacheCounter): void {
  if (kind === 'misses' || kind === 'incremental_fetches') bumpMeta(kind);
  else bumpMeta('hits');
}

export function recordMarketFetch(at: string): void {
  setMeta('last_fetch_at', at);
}

/** Read at most `limit` newest bars, returned oldest-first as the rest of the app expects. */
export function readCandles(symbolId: number, limit = 5_000): OHLCVBar[] {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Candle limit must be a positive integer');
  const rows = db().prepare(`
    SELECT date, timestamp, open, high, low, close, volume FROM (
      SELECT date, timestamp, open, high, low, close, volume
      FROM candles WHERE symbol_id = ?
      ORDER BY date DESC LIMIT ?
    ) ORDER BY date ASC
  `).all(symbolId, Math.min(limit, 5_000));
  const bars: OHLCVBar[] = [];
  for (const row of rows) {
    const bar: OHLCVBar = {
      date: String(row.date),
      timestamp: integer(row.timestamp),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume)
    };
    if (![bar.timestamp, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)) continue;
    bars.push(bar);
  }
  return bars;
}

export function countCandles(symbolId: number): number {
  const row = db().prepare('SELECT COUNT(*) AS bars FROM candles WHERE symbol_id = ?').get(symbolId);
  return row ? integer(row.bars) : 0;
}

function fileBytes(file: string): number {
  try {
    const stat = statSync(file);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

/** Allocation-aware size for the UI; includes WAL/SHM because those are part of the cache on disk. */
function databaseBytes(target: string): number {
  if (target === ':memory:') {
    const pages = db().prepare('PRAGMA page_count').get();
    const pageSize = db().prepare('PRAGMA page_size').get();
    return integer(pages?.page_count) * integer(pageSize?.page_size);
  }
  return fileBytes(target) + fileBytes(target + '-wal') + fileBytes(target + '-shm');
}

/** Shape consumed by GET /api/v2/market/cache (mounted by the PM). */
export function getMarketCacheStats(): MarketCacheStats {
  const target = getMarketDbPath();
  const aggregate = db().prepare(
    'SELECT COUNT(DISTINCT symbol_id) AS symbols, COUNT(*) AS bars, MIN(date) AS first_date, MAX(date) AS last_date FROM candles'
  ).get();
  const coverage = db().prepare('SELECT MAX(last_fetch_at) AS last_fetch_at FROM coverage').get();
  return {
    symbols: aggregate ? integer(aggregate.symbols) : 0,
    bars: aggregate ? integer(aggregate.bars) : 0,
    firstDate: aggregate ? text(aggregate.first_date) : null,
    lastDate: aggregate ? text(aggregate.last_date) : null,
    dbBytes: databaseBytes(target),
    hits: Number(metaValue('hits') ?? 0),
    misses: Number(metaValue('misses') ?? 0),
    incrementalFetches: Number(metaValue('incremental_fetches') ?? 0),
    lastFetchAt: metaValue('last_fetch_at') ?? (coverage ? text(coverage.last_fetch_at) : null),
    dbPath: target
  };
}

/**
 * Short advisory lease for cross-thread coalescing. It is deliberately
 * non-blocking: a worker that loses the race may wait briefly and re-read the
 * shared cache, but it must never be unable to fetch. An expired lease is
 * stealable, so a crashed worker cannot wedge a symbol.
 */
export function acquireFetchLease(symbolId: number, owner: string, ttlMs = 60_000): boolean {
  const now = Date.now();
  const result = db().prepare(`
    INSERT INTO fetch_leases (symbol_id, owner, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(symbol_id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
    WHERE fetch_leases.expires_at <= ? OR fetch_leases.owner = excluded.owner
  `).run(symbolId, owner, now + Math.max(1, ttlMs), now);
  return Number(result.changes) > 0;
}

export function releaseFetchLease(symbolId: number, owner: string): void {
  db().prepare('DELETE FROM fetch_leases WHERE symbol_id = ? AND owner = ?').run(symbolId, owner);
}

/** Test/administrative reset. Never called by the running provider. */
export function clearMarketCacheForTests(): void {
  transaction(connection => {
    connection.exec('DELETE FROM candles; DELETE FROM coverage; DELETE FROM meta; DELETE FROM fetch_leases;');
  });
}
