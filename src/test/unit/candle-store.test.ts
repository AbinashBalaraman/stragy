import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { OHLCVBar } from '../../shared/strategy/types';
import {
  acquireFetchLease,
  clearMarketCacheForTests,
  closeMarketCache,
  countCandles,
  getCandleCoverage,
  getMarketCacheStats,
  getMarketDbPath,
  markCandleFetch,
  readCandles,
  recordCacheEvent,
  recordMarketFetch,
  releaseFetchLease,
  upsertCandles
} from '../../server/data/candleStore';

const SCRATCH = '/data/tmp/opencode';
let directory = '';
let databasePath = '';

function bar(date: string, close = 100): OHLCVBar {
  return {
    date,
    timestamp: Date.parse(date + 'T00:00:00+05:30'),
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1_000
  };
}

beforeEach(() => {
  mkdirSync(SCRATCH, { recursive: true });
  closeMarketCache();
  directory = mkdtempSync(join(SCRATCH, 'stragy-candle-store-'));
  databasePath = join(directory, 'candles.db');
  process.env.STRAGY_MARKET_DB = databasePath;
  clearMarketCacheForTests();
});

afterEach(() => {
  closeMarketCache();
  delete process.env.STRAGY_MARKET_DB;
  rmSync(directory, { recursive: true, force: true });
});

describe('durable candle store', () => {
  it('uses WAL, STRICT tables and the documented primary key/index', () => {
    upsertCandles(7, [bar('2026-11-12'), bar('2026-11-13')], 'ANGEL_SMARTAPI', '2026-11-16T08:00:00.000Z');
    const probe = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const journal = probe.prepare('PRAGMA journal_mode').get();
      expect(String(journal?.journal_mode).toLowerCase()).toBe('wal');
      const tables = probe.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('candles','coverage','meta')").all() as Array<{ name: string; sql: string }>;
      expect(tables.map(row => row.name).sort()).toEqual(['candles', 'coverage', 'meta']);
      for (const table of tables) expect(table.sql).toContain('STRICT');
      const indexes = probe.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'candles'").all() as Array<{ name: string }>;
      expect(indexes.map(row => row.name)).toContain('candles_date_idx');
      const columns = probe.prepare('PRAGMA table_info(candles)').all() as Array<{ name: string; pk: number }>;
      expect(columns.filter(column => column.pk > 0).map(column => column.name).sort()).toEqual(['date', 'symbol_id']);
    } finally {
      probe.close();
    }
  });

  it('upserts idempotently, corrects overlap rows and never deletes covered history', () => {
    const first = upsertCandles(7, [bar('2026-11-11', 99), bar('2026-11-12', 100), bar('2026-11-13', 101)], 'ANGEL_SMARTAPI', '2026-11-16T08:00:00.000Z');
    expect(first).toEqual({ written: 3, skipped: 0 });
    const second = upsertCandles(7, [bar('2026-11-12', 105), bar('2026-11-13', 106), bar('2026-11-16', 107)], 'ANGEL_SMARTAPI', '2026-11-17T10:00:00.000Z');
    expect(second).toEqual({ written: 3, skipped: 0 });
    const bars = readCandles(7);
    expect(bars.map(item => [item.date, item.close])).toEqual([
      ['2026-11-11', 99],
      ['2026-11-12', 105],
      ['2026-11-13', 106],
      ['2026-11-16', 107]
    ]);
    expect(countCandles(7)).toBe(4);
  });

  it('skips malformed rows without synthesising prices', () => {
    const invalid = [
      { ...bar('2026-11-10'), open: Number.NaN },
      { ...bar('2026-11-11'), high: 1, low: -5 },
      { ...bar('2026-11-12'), volume: -1 },
      { ...bar('2026-11-13'), date: 'not-a-date' }
    ] as OHLCVBar[];
    const result = upsertCandles(9, [bar('2026-11-09', 50), ...invalid], 'ANGEL_SMARTAPI', '2026-11-16T08:00:00.000Z');
    expect(result).toEqual({ written: 1, skipped: 4 });
    expect(readCandles(9).map(item => item.date)).toEqual(['2026-11-09']);
  });

  it('reports coverage and stats with the contract shape', () => {
    upsertCandles(11, [bar('2026-11-12', 100), bar('2026-11-13', 101)], 'ANGEL_SMARTAPI', '2026-11-16T08:00:00.000Z');
    markCandleFetch(11, 'ANGEL_SMARTAPI', '2026-11-13', '2026-11-16T08:00:00.000Z', 'NSE:2885');
    recordMarketFetch('2026-11-16T08:00:00.000Z');
    recordCacheEvent('misses');
    recordCacheEvent('hits');
    recordCacheEvent('incremental_fetches');

    const coverage = getCandleCoverage(11);
    expect(coverage).toMatchObject({
      symbolId: 11,
      bars: 2,
      firstDate: '2026-11-12',
      lastDate: '2026-11-13',
      fetchedAt: '2026-11-16T08:00:00.000Z',
      checkedThrough: '2026-11-13',
      source: 'ANGEL_SMARTAPI',
      providerSymbol: 'NSE:2885'
    });
    expect(getCandleCoverage(999)).toBeNull();

    const stats = getMarketCacheStats();
    expect(stats).toMatchObject({
      symbols: 1,
      bars: 2,
      firstDate: '2026-11-12',
      lastDate: '2026-11-13',
      hits: 1,
      misses: 1,
      incrementalFetches: 1,
      lastFetchAt: '2026-11-16T08:00:00.000Z',
      dbPath: databasePath
    });
    expect(stats.dbBytes).toBeGreaterThan(0);
    expect(getMarketDbPath()).toBe(databasePath);
  });

  it('persists counters across a close/reopen instead of resetting a warm cache', () => {
    upsertCandles(12, [bar('2026-11-13')], 'ANGEL_SMARTAPI', '2026-11-16T08:00:00.000Z');
    recordCacheEvent('misses');
    recordCacheEvent('hits');
    recordCacheEvent('hits');
    recordCacheEvent('incremental_fetches');
    closeMarketCache();
    const reopened = getMarketCacheStats();
    expect([reopened.hits, reopened.misses, reopened.incrementalFetches]).toEqual([2, 1, 1]);
    expect(reopened.symbols).toBe(1);
    expect(reopened.bars).toBe(1);
  });

  it('clears data for tests without touching another database', () => {
    upsertCandles(13, [bar('2026-11-13')], 'ANGEL_SMARTAPI', '2026-11-16T08:00:00.000Z');
    recordCacheEvent('misses');
    clearMarketCacheForTests();
    expect(getCandleCoverage(13)).toBeNull();
    expect(readCandles(13)).toEqual([]);
    expect(getMarketCacheStats()).toMatchObject({ symbols: 0, bars: 0, hits: 0, misses: 0, incrementalFetches: 0 });
  });

  it('gives one worker an advisory lease and lets an expired lease be stolen', async () => {
    expect(acquireFetchLease(21, 'worker-a', 60_000)).toBe(true);
    expect(acquireFetchLease(21, 'worker-b', 60_000)).toBe(false);
    expect(acquireFetchLease(21, 'worker-a', 60_000)).toBe(true);
    releaseFetchLease(21, 'worker-a');
    expect(acquireFetchLease(21, 'worker-b', 60_000)).toBe(true);
    releaseFetchLease(21, 'worker-b');

    expect(acquireFetchLease(22, 'worker-a', 5)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 15));
    expect(acquireFetchLease(22, 'worker-b', 5)).toBe(true);
    releaseFetchLease(22, 'worker-b');
  });
});
