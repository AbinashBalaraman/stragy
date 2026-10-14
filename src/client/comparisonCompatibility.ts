import type { BacktestResponse } from '../shared/strategy/types';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
/** Canonical JSON, not a lossy hash: key order cannot change compatibility. */
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export interface ComparisonContext {
  values: Record<string, string | undefined>;
  missing: string[];
}

/** Read both current worker manifests and the app's data/options manifest shape.
 * INR/default fees/liquidation are inferred ONLY for the inspected v2 cash engine.
 * Runs with unknown assumptions fail closed instead of silently joining a ranking.
 */
export function comparisonContext(result: BacktestResponse): ComparisonContext {
  const manifest = record(result.manifest), options = record(manifest.options);
  // These are alternative complete provenance snapshots, not complementary
  // fields. Merging can resurrect a stale manifest checksum after the response
  // explicitly identifies its data by datasetId instead. Prefer the response's
  // snapshot as a whole; incomplete snapshots still fail closed below.
  const declaredData = record(manifest.data), provenance = record(result.provenance);
  const data = Object.keys(provenance).length > 0 ? provenance : declaredData;
  const actual = record(data.actualRange);
  const engine = text(result.engineVersion) ?? text(manifest.engineVersion);
  const knownEngine = engine === 'stragy-next-open-v2';
  const bars = result.bars ?? [], curve = result.equityCurve ?? [];
  const start = curve[0]?.date ?? bars[0]?.date ?? text(actual.start);
  const end = curve.at(-1)?.date ?? bars.at(-1)?.date ?? text(actual.end);
  const source = text(data.source), checksum = text(data.checksum), dataset = text(data.datasetId);
  // Equal endpoints alone never prove equal data. Legacy snapshots may prove
  // identity using the complete returned OHLCV dataset, not merely its window.
  const datasetIdentity = source && checksum ? canonical({ source, checksum })
    : source && dataset ? canonical({ source, dataset })
    : !source && !checksum && bars.length ? canonical(bars.map(b => [b.date, b.timestamp, b.open, b.high, b.low, b.close, b.volume])) : undefined;
  const schedule = record(options.feeSchedule);
  const feeSchedule = Object.keys(schedule).length ? canonical(schedule)
    : text(manifest.feeSchedule) ? canonical({ id: manifest.feeSchedule, verified: manifest.feeVerified ?? false })
    : knownEngine && Object.keys(manifest).length > 0 ? canonical({ id: 'illustrative-unverified', verified: false }) : undefined;
  const execution = result.strategy.execution;
  const values: ComparisonContext['values'] = {
    symbol: result.symbol?.ticker && result.symbol?.exchange ? canonical([result.symbol.exchange, result.symbol.ticker, result.symbol.id, result.strategy.universe.symbolId, data.symbolId ?? result.symbol.id]) : undefined,
    dataset: datasetIdentity,
    'data assumptions': canonical({ mode: data.mode ?? null, adjustment: data.adjustment ?? null, calendar: data.calendarVersion ?? null }),
    window: start && end ? canonical([start, end, curve.map(p => [p.date, p.timestamp])]) : undefined,
    timeframe: text(result.strategy.universe.timeframe),
    currency: (text(manifest.currency) ?? text(options.currency) ?? text(data.currency) ?? (knownEngine && ['NSE', 'BSE'].includes(result.symbol?.exchange) ? 'INR' : undefined))?.toUpperCase(),
    'initial capital': Number.isFinite(result.metrics.initialCapital) && result.metrics.initialCapital > 0 ? String(result.metrics.initialCapital) : undefined,
    engine,
    'execution policy': text(result.executionPolicy) ?? text(manifest.executionPolicy) ?? text(execution.executionPolicy),
    execution: canonical({ allowLong: execution.allowLong, allowShort: execution.allowShort, orderType: execution.orderType, liquidateAtEnd: options.liquidateAtEnd ?? execution.liquidateAtEnd ?? (knownEngine ? true : null), squareOff: execution.intradaySquareOffTime ?? null }),
    costs: result.strategy.costs ? canonical(result.strategy.costs) : undefined,
    'fee schedule': feeSchedule,
  };
  const missing = Object.keys(values).filter(key => values[key] === undefined);
  if (!knownEngine && options.liquidateAtEnd === undefined && execution.liquidateAtEnd === undefined) missing.push('liquidation policy');
  if (data.symbolId !== undefined && data.symbolId !== result.symbol.id) missing.push('conflicting dataset symbol');
  if (result.strategy.universe.symbolId !== result.symbol.id) missing.push('conflicting strategy symbol');
  for (const key of ['source', 'checksum', 'datasetId', 'mode', 'symbolId', 'adjustment', 'calendarVersion']) {
    if (declaredData[key] !== undefined && provenance[key] !== undefined && declaredData[key] !== provenance[key]) missing.push('conflicting data ' + key);
  }
  if (manifest.initialCapital !== undefined && manifest.initialCapital !== result.metrics.initialCapital) missing.push('conflicting initial capital');
  if (options.initialCapital !== undefined && options.initialCapital !== result.metrics.initialCapital) missing.push('conflicting initial capital');
  if (text(manifest.engineVersion) && engine !== manifest.engineVersion) missing.push('conflicting engine');
  if (text(manifest.executionPolicy) && values['execution policy'] !== manifest.executionPolicy) missing.push('conflicting execution policy');
  return { values, missing };
}

export function compareCompatibility(a: BacktestResponse, b: BacktestResponse): { compatible: boolean; reasons: string[] } {
  const left = comparisonContext(a), right = comparisonContext(b);
  const reasons = [...new Set([...left.missing, ...right.missing])].map(key => 'Unverified ' + key);
  for (const key of Object.keys(left.values)) if (left.values[key] !== undefined && right.values[key] !== undefined && left.values[key] !== right.values[key]) reasons.push('Different ' + key);
  return { compatible: reasons.length === 0, reasons };
}

/** Identity is the immutable run ID, never the mutable/shared strategy ID. */
export function consolidateComparisonRuns(current: BacktestResponse | undefined, comparisons: BacktestResponse[]): BacktestResponse[] {
  const runs = new Map<string, BacktestResponse>();
  for (const run of [current, ...comparisons]) if (run?.strategy && run.backtestId && !runs.has(run.backtestId)) runs.set(run.backtestId, run);
  return [...runs.values()];
}

export function partitionComparisonRuns(baseline: BacktestResponse, runs: BacktestResponse[]) {
  const compatible: BacktestResponse[] = [];
  const excluded: { result: BacktestResponse; reasons: string[] }[] = [];
  for (const result of runs) {
    const check = compareCompatibility(baseline, result);
    // Keep an unverified baseline visible, but never admit other runs or rank it.
    if (result.backtestId === baseline.backtestId || check.compatible) compatible.push(result);
    else excluded.push({ result, reasons: check.reasons });
  }
  return { compatible, excluded, baselineIssues: comparisonContext(baseline).missing };
}

export const comparisonSeriesKey = (runId: string, metric: 'equity' | 'drawdown') => metric + '_' + encodeURIComponent(runId).replace(/\./g, '%2E');
export const toggleComparisonVisibility = (visibility: Record<string, boolean>, runId: string) => ({ ...visibility, [runId]: visibility[runId] === false });
