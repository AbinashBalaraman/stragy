/**
 * Bulk scan planning and aggregation. A single research job evaluates at most
 * one universe cap (200 symbols). Larger requests are split into batches that
 * run in the background, then merged into ONE complete result — never a
 * silent 200-row subset presented as the whole answer.
 */
import type { UniverseScanResponse } from '../backtest/scanner';

export const BULK_BATCH_SYMBOLS = 200;
export const MAX_BULK_SCAN_SYMBOLS = 2000;
/** One match per evaluated symbol at most; never truncate the merged answer. */
export const MAX_BULK_ROWS_IN_ANSWER = MAX_BULK_SCAN_SYMBOLS;

export interface ScanBatch { symbolOffset: number; maxSymbols: number; }

export function planBulkBatches(requested: number, available: number, batchSize = BULK_BATCH_SYMBOLS): ScanBatch[] {
  const size = Math.max(1, Math.floor(batchSize));
  const total = Math.max(0, Math.min(Math.floor(requested), Math.floor(available)));
  const batches: ScanBatch[] = [];
  for (let offset = 0; offset < total; offset += size) {
    batches.push({ symbolOffset: offset, maxSymbols: Math.min(size, total - offset) });
  }
  return batches;
}

export interface BulkMatch {
  symbolId?: number;
  ticker?: string;
  name?: string;
  sector?: string;
  lastDate?: string;
  lastClose?: number;
  changePercent?: number;
  score?: number;
  matchedRules?: { rule: string }[];
  provenance?: unknown;
}

export interface BulkStatus {
  complete: boolean;
  batchesDone: number;
  batchesTotal: number;
  evaluated: number;
  succeeded: number;
  unavailable: number;
  failed: number;
  matched: number;
  /** True only if a defensive cap ever clipped rows; must be surfaced honestly. */
  rowsTruncated: boolean;
  matches: BulkMatch[];
  warnings: string[];
  asOf?: string;
  dataSource?: string;
}

/**
 * Merge succeeded batch results. Dedupe by symbolId (fallback ticker), sort
 * by score desc, and keep totals honest even while batches are still running.
 */
export function mergeBulkResults(
  results: { status: string; result?: unknown; error?: unknown }[],
  batchesTotal: number,
): BulkStatus {
  const seen = new Set<string>();
  const matches: BulkMatch[] = [];
  const warnings: string[] = [];
  let evaluated = 0, succeeded = 0, unavailable = 0, failed = 0, batchesDone = 0;
  let asOf: string | undefined, dataSource: string | undefined;
  for (const item of results) {
    if (item.status !== 'succeeded') continue;
    batchesDone++;
    const r = item.result as Partial<UniverseScanResponse> | undefined;
    if (!r) continue;
    evaluated += r.attempted ?? 0;
    succeeded += r.succeeded ?? 0;
    unavailable += r.unavailable ?? 0;
    failed += r.failed ?? 0;
    for (const w of r.warnings ?? []) if (warnings.length < 20 && !warnings.includes(w)) warnings.push(w);
    asOf ??= r.asOf;
    dataSource ??= r.dataSource;
    for (const m of (r.matches ?? []) as BulkMatch[]) {
      const key = String(m.ticker ?? m.symbolId ?? Math.random());
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(m);
    }
  }
  matches.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(a.ticker).localeCompare(String(b.ticker)));
  return {
    complete: batchesDone === batchesTotal && batchesTotal > 0,
    batchesDone, batchesTotal, evaluated, succeeded, unavailable, failed,
    matched: matches.length,
    rowsTruncated: matches.length > MAX_BULK_ROWS_IN_ANSWER,
    matches: matches.slice(0, MAX_BULK_ROWS_IN_ANSWER),
    warnings,
    ...(asOf ? { asOf } : {}),
    ...(dataSource ? { dataSource } : {}),
  };
}
