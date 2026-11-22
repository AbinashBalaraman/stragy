import { describe, expect, it } from 'vitest';
import { BULK_BATCH_SYMBOLS, MAX_BULK_SCAN_SYMBOLS, mergeBulkResults, planBulkBatches } from '../../server/ai/bulkScan';

describe('bulk scan planning', () => {
  it('splits 2000 symbols into ten disjoint background batches', () => {
    const batches = planBulkBatches(2000, 2345);
    expect(batches).toHaveLength(10);
    expect(batches[0]).toEqual({ symbolOffset: 0, maxSymbols: BULK_BATCH_SYMBOLS });
    expect(batches[9]).toEqual({ symbolOffset: 1800, maxSymbols: 200 });
    const covered = batches.reduce((sum, b) => sum + b.maxSymbols, 0);
    expect(covered).toBe(2000);
  });

  it('never requests beyond configured coverage', () => {
    expect(planBulkBatches(2000, 450)).toHaveLength(3);
    expect(planBulkBatches(MAX_BULK_SCAN_SYMBOLS, 50)).toEqual([{ symbolOffset: 0, maxSymbols: 50 }]);
    expect(planBulkBatches(10, 10, 200)).toEqual([{ symbolOffset: 0, maxSymbols: 10 }]);
  });
});

describe('bulk result aggregation', () => {
  const batch = (attempted: number, tickers: string[], scoreOffset = 0) => ({
    status: 'succeeded',
    result: {
      attempted, succeeded: attempted, unavailable: 0, failed: 0,
      warnings: ['w1'], asOf: '2026-11-19', dataSource: 'ANGEL_SMARTAPI',
      matches: tickers.map((ticker, i) => ({ ticker, symbolId: i + 1, score: scoreOffset + i + 1 })),
    },
  });

  it('returns every merged match row, never a silent 500-row subset', () => {
    const tickers = Array.from({ length: 600 }, (_, i) => 'S' + i);
    const merged = mergeBulkResults([batch(200, tickers.slice(0, 300)), batch(200, tickers.slice(300))], 2);
    expect(merged.matched).toBe(600);
    expect(merged.matches).toHaveLength(600);
    expect(merged.rowsTruncated).toBe(false);
  });

  it('reports partial progress without claiming completion', () => {
    const merged = mergeBulkResults([batch(200, ['A']), { status: 'running' }], 2);
    expect(merged.complete).toBe(false);
    expect(merged.batchesDone).toBe(1);
    expect(merged.evaluated).toBe(200);
    expect(merged.matched).toBe(1);
  });

  it('merges all batches into one sorted, deduped result', () => {
    const merged = mergeBulkResults([batch(200, ['A', 'B']), batch(200, ['B', 'C'], 2)], 2);
    expect(merged.complete).toBe(true);
    expect(merged.batchesDone).toBe(2);
    expect(merged.evaluated).toBe(400);
    expect(merged.matched).toBe(3);
    expect(merged.matches.map(m => m.ticker)).toEqual(['C', 'B', 'A']);
    expect(merged.warnings).toEqual(['w1']);
  });
});
