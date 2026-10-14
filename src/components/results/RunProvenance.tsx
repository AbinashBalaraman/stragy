import React from 'react';
import type { BacktestResponse } from '../../shared/strategy/types';
const record = (input: unknown): Record<string, unknown> => input !== null && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
const text = (input: unknown): string => typeof input === 'string' && input.trim() ? input : 'Unavailable';
export function RunProvenance({ result }: { result: BacktestResponse }) {
  const manifest = record(result.manifest), direct = record(result.provenance);
  const data = Object.keys(direct).length ? direct : record(manifest.data);
  const range = record(data.actualRange);
  const warnings = [...new Set([...(result.warnings ?? []), ...(Array.isArray(data.warnings) ? data.warnings.filter((w): w is string => typeof w === 'string') : [])])];
  const label = data.mode === 'demo' ? 'GENERATED DEMO DATA: not observed market prices' : data.mode === 'real' ? 'Provider data: verification and entitlement are not implied' : 'Data provenance unavailable: do not treat this as observed market data';
  return <section aria-label="Run data provenance" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs space-y-2">
    <p className="font-semibold text-amber-200">{label}</p>
    <p>Source: {text(data.source)} · As of: {text(data.asOf)} · Dataset range: {text(range.start)} to {text(range.end)}</p>
    <p>Evaluation bars: {result.bars[0]?.date ?? 'Unavailable'} to {result.bars.at(-1)?.date ?? 'Unavailable'} · Adjustment: {text(data.adjustment)} · Calendar: {text(data.calendarVersion)}</p>
    {warnings.length > 0 && <ul className="list-disc pl-4 text-amber-100/80">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
    <details><summary className="cursor-pointer">Immutable run identity and assumptions</summary><dl className="pt-2 break-all space-y-1">
      <dt>Run ID</dt><dd>{result.backtestId}</dd>
      <dt>Data checksum</dt><dd>{text(data.checksum)}</dd>
      <dt>Engine and execution policy</dt><dd>{text(result.engineVersion ?? manifest.engineVersion)} · {text(result.executionPolicy ?? manifest.executionPolicy)}</dd>
      <dt>Source revision</dt><dd>{text(manifest.sourceCommit)}</dd>
      <dt>Seed</dt><dd>{String(manifest.seed ?? record(manifest.options).seed ?? 'Unavailable')}</dd>
    </dl></details>
  </section>;
}
