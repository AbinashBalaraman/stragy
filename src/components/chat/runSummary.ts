import type { BacktestResponse } from '../../shared/strategy/types';

const record = (input: unknown): Record<string, unknown> =>
  input !== null && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};

const text = (input: unknown): string => typeof input === 'string' && input.trim() ? input : 'Unavailable';

export interface RunDataSummary {
  mode: 'real' | 'demo' | 'unknown';
  modeLabel: string;
  source: string;
  observedThrough: string;
  datasetRange: string;
  warnings: string[];
}

/** Read only provenance fields the server actually returned; never infer an observed date. */
export function summarizeRunData(result: BacktestResponse): RunDataSummary {
  const manifest = record(result.manifest);
  const direct = record(result.provenance);
  const data = Object.keys(direct).length ? direct : record(manifest.data);
  const range = record(data.actualRange);
  const warnings = [...new Set([
    ...(result.warnings ?? []),
    ...(Array.isArray(data.warnings) ? data.warnings.filter((warning): warning is string => typeof warning === 'string') : []),
  ])];
  const mode = data.mode === 'real' || data.mode === 'demo' ? data.mode : 'unknown';
  const start = text(range.start);
  const end = text(range.end);
  const observedThrough = text(data.asOf) !== 'Unavailable'
    ? text(data.asOf)
    : end !== 'Unavailable'
      ? end
      : result.bars.at(-1)?.date ?? 'Unavailable';
  return {
    mode,
    modeLabel: mode === 'demo'
      ? 'Demo data — generated bars, not observed market prices'
      : mode === 'real'
        ? 'Observed public daily data'
        : 'Data mode unavailable — treat results as unverified',
    source: text(data.source),
    observedThrough,
    datasetRange: start !== 'Unavailable' && end !== 'Unavailable' ? start + ' to ' + end : 'Unavailable',
    warnings,
  };
}
