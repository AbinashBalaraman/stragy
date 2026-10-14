import { describe, expect, it } from 'vitest';
import { simulate } from '../../server/backtest/engine';
import { strategy, bars } from '../fixtures/research';
import type { BacktestResponse } from '../../shared/strategy/types';
import { compareCompatibility, comparisonContext, consolidateComparisonRuns, partitionComparisonRuns, comparisonSeriesKey, toggleComparisonVisibility } from '../../client/comparisonCompatibility';

function run(id = 'run-a'): BacktestResponse {
  const result = simulate(strategy(), bars([[100,101,99,100],[110,112,109,111],[120,121,119,120]]), { initialCapital: 10000, robustness: false });
  result.backtestId = id;
  result.strategy.id = 'same-strategy';
  result.provenance = { source: 'FIXTURE', checksum: 'fixed-checksum', mode: 'demo', symbolId: result.symbol.id, actualRange: { start: result.bars[0].date, end: result.bars.at(-1)!.date }, adjustment: 'unadjusted', calendarVersion: 'fixture' };
  result.manifest = { engineVersion: result.engineVersion, executionPolicy: result.executionPolicy, initialCapital: 10000, feeSchedule: 'illustrative-unverified', feeVerified: false };
  return result;
}
function copy(result: BacktestResponse, id = 'run-b') { const clone = structuredClone(result); clone.backtestId = id; return clone; }

describe('immutable comparison compatibility', () => {
  it('matches the same basis while allowing different strategies, performance, seed and execution time', () => {
    const a = run(), b = copy(a); b.strategy.name = 'Different rules'; b.strategy.risk.stopLoss.value = 10; b.metrics.sharpeRatio = 999; b.executedAt = '2030-01-01';
    b.manifest = { ...(b.manifest as object), seed: 999 };
    expect(compareCompatibility(a,b)).toEqual({ compatible: true, reasons: [] });
    expect(compareCompatibility(b,a)).toEqual(compareCompatibility(a,b));
  });
  it.each([
    ['symbol', (r: BacktestResponse) => { r.symbol.ticker = 'OTHER'; }],
    ['dataset', (r: BacktestResponse) => { (r.provenance as Record<string, unknown>).checksum = 'different'; }],
    ['source', (r: BacktestResponse) => { (r.provenance as Record<string, unknown>).source = 'OTHER'; }],
    ['window', (r: BacktestResponse) => { r.equityCurve.pop(); r.bars.pop(); }],
    ['timeframe', (r: BacktestResponse) => { r.strategy.universe.timeframe = '1W'; }],
    ['currency', (r: BacktestResponse) => { r.manifest = { ...(r.manifest as object), currency: 'USD' }; }],
    ['capital', (r: BacktestResponse) => { r.metrics.initialCapital = 20000; }],
    ['slippage', (r: BacktestResponse) => { r.strategy.costs.slippageBps++; }],
    ['brokerage', (r: BacktestResponse) => { r.strategy.costs.brokerageFlat++; }],
    ['taxes', (r: BacktestResponse) => { r.strategy.costs.applyIndianTaxes = !r.strategy.costs.applyIndianTaxes; }],
    ['fee schedule', (r: BacktestResponse) => { r.manifest = { ...(r.manifest as object), feeSchedule: 'other' }; }],
    ['execution', (r: BacktestResponse) => { r.executionPolicy = 'other'; }],
    ['liquidation', (r: BacktestResponse) => { r.strategy.execution.liquidateAtEnd = false; }],
    ['engine', (r: BacktestResponse) => { r.engineVersion = 'other'; }],
    ['adjustment', (r: BacktestResponse) => { (r.provenance as Record<string, unknown>).adjustment = 'adjusted'; }],
  ])('rejects different %s without removing the immutable run', (_label, mutate) => {
    const a = run(), b = copy(a); mutate(b);
    expect(compareCompatibility(a,b).compatible).toBe(false);
    const partition = partitionComparisonRuns(a,[a,b]); expect(partition.compatible).toEqual([a]); expect(partition.excluded[0].result.backtestId).toBe('run-b');
  });
  it('uses complete returned datasets for legacy snapshots, never just equal endpoints', () => {
    const a = run(); a.provenance = undefined; const b = copy(a);
    expect(compareCompatibility(a,b).compatible).toBe(true);
    b.bars[1].close += .1; expect(compareCompatibility(a,b).compatible).toBe(false);
  });
  it('understands data/options manifest and exact declared datasets', () => {
    const a = run(), b = copy(a); b.manifest = { data: b.provenance, options: { initialCapital:10000 }, engineVersion:b.engineVersion, executionPolicy:b.executionPolicy }; b.provenance = undefined;
    expect(compareCompatibility(a,b).compatible).toBe(true);
    for (const r of [a,b]) { const data = structuredClone(a.provenance) as Record<string, unknown>; delete data.checksum; data.datasetId = 'immutable-dataset'; r.provenance = data; }
    expect(compareCompatibility(a,b).compatible).toBe(true);
    (b.provenance as Record<string, unknown>).datasetId = 'different'; expect(compareCompatibility(a,b).compatible).toBe(false);
  });
  it('never fills an incomplete response dataset from a different manifest snapshot', () => {
    const a = run(), b = copy(a);
    b.manifest = { ...(b.manifest as object), data: structuredClone(b.provenance) };
    b.provenance = { source: 'FIXTURE' };
    expect(compareCompatibility(a,b).compatible).toBe(false);
    expect(comparisonContext(b).missing).toContain('dataset');
  });
  it('rejects contradictory identities declared by both provenance snapshots', () => {
    const a = run(), b = copy(a);
    b.manifest = { ...(b.manifest as object), data: { ...(b.provenance as object), checksum: 'contradictory-checksum' } };
    expect(compareCompatibility(a,b).compatible).toBe(false);
    expect(comparisonContext(b).missing).toContain('conflicting data checksum');
    b.manifest = { ...(b.manifest as object), data: { ...(b.provenance as object), datasetId: 'manifest-dataset' } };
    b.provenance = { ...(b.provenance as object), datasetId: 'response-dataset' };
    expect(compareCompatibility(a,b).compatible).toBe(false);
    expect(comparisonContext(b).missing).toContain('conflicting data datasetId');
  });
  it('fails closed for unknown context and keeps an unverified baseline visible', () => {
    const a = run(); a.engineVersion = undefined; a.manifest = undefined; const b = copy(a);
    expect(comparisonContext(a).missing).toContain('currency');
    const p = partitionComparisonRuns(a,[a,b]); expect(p.compatible).toEqual([a]); expect(p.baselineIssues.length).toBeGreaterThan(0); expect(p.excluded).toHaveLength(1);
  });
  it('keeps distinct run IDs sharing a strategy ID and only deduplicates the same run', () => {
    const a = run(), b = copy(a), stale = copy(a,'run-a'); stale.metrics.netPnl = -999;
    expect(consolidateComparisonRuns(a,[stale,b])).toEqual([a,b]);
    expect(partitionComparisonRuns(a,[a,b]).compatible).toHaveLength(2);
  });
  it('preserves visibility and series identity when inserting, sorting, excluding or removing other runs', () => {
    const a = run(), b = copy(a); let visibility = toggleComparisonVisibility({},b.backtestId);
    expect(visibility[b.backtestId]).toBe(false); expect(visibility[a.backtestId]).toBeUndefined();
    const reordered = consolidateComparisonRuns(b,[a]); expect(reordered.map(r=>visibility[r.backtestId] !== false)).toEqual([false,true]);
    expect(comparisonSeriesKey(a.backtestId,'equity')).not.toBe(comparisonSeriesKey(b.backtestId,'equity'));
    expect(comparisonSeriesKey('a.b','equity')).not.toContain('.');
    visibility = toggleComparisonVisibility(visibility,b.backtestId); expect(visibility[b.backtestId]).toBe(true);
  });
  it('is deterministic and never mutates inputs', () => {
    const a = run(), b = copy(a), before = JSON.stringify([a,b]);
    const first = partitionComparisonRuns(a,[a,b]); expect(partitionComparisonRuns(a,[a,b])).toEqual(first); expect(JSON.stringify([a,b])).toBe(before);
  });
});
