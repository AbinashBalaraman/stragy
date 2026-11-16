import React from 'react';
import type { BacktestResponse } from '../../shared/strategy/types';
import { formatDate, formatDateTime } from '../../shared/format';
import { Disclosure } from '../common/Disclosure';

const record = (input: unknown): Record<string, unknown> =>
  input !== null && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
const text = (input: unknown): string => (typeof input === 'string' && input.trim() ? input : 'Unavailable');

const sourceLabel = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) return 'Source unavailable';
  if (value === 'YAHOO_PUBLIC_CHART') return 'Yahoo public chart';
  if (value === 'ANGEL_SMARTAPI') return 'Angel One SmartAPI';
  if (value === 'DETERMINISTIC_DEMO_V1') return 'Generated demo data';
  return value.replace(/_/g, ' ');
};

export function RunProvenance({ result }: { result: BacktestResponse }) {
  const manifest = record(result.manifest);
  const direct = record(result.provenance);
  const data = Object.keys(direct).length ? direct : record(manifest.data);
  const range = record(data.actualRange);
  const warnings = [
    ...new Set([
      ...(result.warnings ?? []),
      ...(Array.isArray(data.warnings) ? data.warnings.filter((warning): warning is string => typeof warning === 'string') : []),
    ]),
  ];
  const mode = data.mode === 'demo' ? 'demo' : data.mode === 'real' ? 'real' : 'unknown';
  const datasetRange = `${formatDate(range.start as string | undefined)} – ${formatDate(range.end as string | undefined)}`;
  const freshness = mode === 'real' ? 'delayed EOD, not live' : mode === 'demo' ? 'generated demo, not observed prices' : 'data mode unavailable';
  const summary = `${sourceLabel(data.source)} · ${datasetRange} · ${freshness} · verification not implied`;

  return (
    <Disclosure summary={<span title={summary}>{summary}</span>}>
      <div className="space-y-3 leading-relaxed">
        <p>
          <strong className="font-semibold text-[#ececed]">Source:</strong> {text(data.source)}
          {' · '}<strong className="font-semibold text-[#ececed]">As of:</strong> {formatDate(data.asOf as string | undefined)}
          {' · '}<strong className="font-semibold text-[#ececed]">Dataset:</strong> {datasetRange}
          {' · '}<strong className="font-semibold text-[#ececed]">Fetched:</strong> {formatDateTime(data.fetchedAt as string | undefined)}
        </p>
        <p>
          <strong className="font-semibold text-[#ececed]">Evaluation:</strong>{' '}
          {formatDate(result.bars[0]?.date)} to {formatDate(result.bars.at(-1)?.date)}
          {' · '}<strong className="font-semibold text-[#ececed]">Adjustment:</strong> {text(data.adjustment)}
          {' · '}<strong className="font-semibold text-[#ececed]">Calendar:</strong> {text(data.calendarVersion)}
        </p>
        <p className="text-amber-200/90">
          {mode === 'demo'
            ? 'GENERATED DEMO DATA: these are not observed market prices.'
            : mode === 'real'
              ? 'Provider data: verification and entitlement are not implied, and this is not a live exchange feed.'
              : 'Data provenance unavailable: do not treat this as observed market data.'}
        </p>

        {warnings.length > 0 && (
          <details>
            <summary className="cursor-pointer font-medium text-[rgba(236,236,237,0.8)]">
              {warnings.length} data {warnings.length === 1 ? 'caveat' : 'caveats'}
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[rgba(236,236,237,0.62)]">
              {warnings.map(warning => <li key={warning}>{warning}</li>)}
            </ul>
          </details>
        )}

        <details>
          <summary className="cursor-pointer font-medium text-[rgba(236,236,237,0.8)]">Immutable run identity and assumptions</summary>
          <dl className="space-y-1 break-all pt-2 text-[rgba(236,236,237,0.62)]">
            <dt className="text-[rgba(236,236,237,0.45)]">Run ID</dt><dd>{result.backtestId}</dd>
            <dt className="text-[rgba(236,236,237,0.45)]">Data checksum</dt><dd>{text(data.checksum)}</dd>
            <dt className="text-[rgba(236,236,237,0.45)]">Dataset window (ISO)</dt><dd>{text(range.start)} to {text(range.end)}</dd>
            <dt className="text-[rgba(236,236,237,0.45)]">Engine and execution policy</dt><dd>{text(result.engineVersion ?? manifest.engineVersion)} · {text(result.executionPolicy ?? manifest.executionPolicy)}</dd>
            <dt className="text-[rgba(236,236,237,0.45)]">Source revision</dt><dd>{text(manifest.sourceCommit)}</dd>
            <dt className="text-[rgba(236,236,237,0.45)]">Seed</dt><dd>{String(manifest.seed ?? record(manifest.options).seed ?? 'Unavailable')}</dd>
          </dl>
        </details>
      </div>
    </Disclosure>
  );
}
