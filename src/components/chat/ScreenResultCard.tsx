import React from 'react';
import type { ScanResult } from '../../client/api';
import type { ResearchScreenPlan } from '../../shared/contracts/research-chat';
import { formatNumber } from '../../client/format';
import { getIndicatorLabel } from '../../shared/strategy/renderPlainLanguage';
import { summarizeProviderFailures } from './researchFollowUp';

interface Props {
  plan: ResearchScreenPlan;
  result: ScanResult | null;
  pending: boolean;
  error: string;
  busy?: boolean;
  onPrepareBacktest: (symbolId: number, asOf?: string) => void;
  onCancelScan?: () => void;
}

const methodLabel = (plan: ResearchScreenPlan) => plan.provider.aiGenerated
  ? 'AI-assisted plan using ' + plan.provider.name + (plan.provider.model ? ' / ' + plan.provider.model : '') + '. Strategy rules were validated before scanning.'
  : plan.method === 'rule_parser'
    ? 'Built-in RSI rule parser (not AI).'
    : 'Local planning (not AI).';

export const ScreenResultCard: React.FC<Props> = ({ plan, result, pending, error, busy, onPrepareBacktest, onCancelScan }) => {
  const observedInMatches = result
    ? result.matches.reduce((latest, match) => match.lastDate > latest ? match.lastDate : latest, '')
    : '';
  const observationDate = result
    ? result.observationDates?.latest ?? (observedInMatches || result.asOf || 'Unavailable')
    : 'Unavailable';
  const sources = result ? Object.keys(result.sourceCoverage) : [];
  const source = sources.length ? sources.join(', ') : result?.dataSource ?? 'Unavailable';
  const failures = result ? summarizeProviderFailures(result.errors) : '';
  const partial = result ? result.succeeded < result.requested || result.failed > 0 : false;
  const demo = result?.mode === 'demo';

  return (
    <article aria-label="Research screen" className="rounded-2xl border border-white/10 bg-[#171719] p-4 sm:p-5 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Read-only screen · Nifty 50</p>
          <h3 className="mt-1 text-lg font-semibold text-neutral-100">{plan.strategy.name}</h3>
          <p className="mt-1 text-xs text-neutral-400">{methodLabel(plan)}</p>
        </div>
        {pending && <span className="rounded-full border border-sky-400/30 px-2.5 py-1 text-[11px] text-sky-200">Scanning…</span>}
        {result && !demo && <span className="rounded-full border border-emerald-400/30 px-2.5 py-1 text-[11px] text-emerald-200">Observed public data</span>}
        {demo && <span className="rounded-full border border-amber-400/40 px-2.5 py-1 text-[11px] text-amber-200">Demo data — not observed</span>}
      </header>

      {pending && (
        <div className="flex flex-wrap items-center justify-between gap-3" role="status">
          <p className="text-sm text-neutral-300">Scanning actual current daily data. Results pending, not zero matches.</p>
          {onCancelScan && <button type="button" onClick={onCancelScan} className="text-xs underline text-neutral-400">Cancel scan</button>}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs text-red-200">
          Screen unavailable: {error}. No zero-match conclusion.
        </div>
      )}

      {result && (
        <div aria-label="Screen results" className="space-y-4">
          <div>
            <h4 className="text-base font-semibold text-neutral-100">
              {result.succeeded > 0 ? (result.matched + (result.matched === 1 ? ' match' : ' matches')) : 'Matches unknown'}
            </h4>
            {result.succeeded > 0 ? (
              <p className="text-sm text-neutral-300">{result.matched} matches in successfully evaluated stocks.</p>
            ) : (
              <p className="text-sm text-neutral-300">No successful data coverage. Matches are unknown, not zero.</p>
            )}
            <p className="mt-1 text-xs text-neutral-400">
              Evaluated {result.succeeded} of {result.requested} requested successfully · {result.unavailable} unavailable · {result.failed} failed · source {source} · observed through {observationDate}
            </p>
          </div>

          {partial && (
            <p role="status" className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-100">
              Partial coverage. {result.succeeded} of {result.requested} stocks produced usable observations; matches among the rest are unknown.
            </p>
          )}
          {failures && <p className="text-xs text-neutral-400">Provider failures: {failures}</p>}
          {result.matched > result.matches.length && (
            <p className="text-xs text-neutral-400">Showing the first {result.matches.length} of {result.matched} matches.</p>
          )}

          {result.matches.length > 0 && (
            <ul className="divide-y divide-white/8 rounded-xl border border-white/8">
              {result.matches.map(match => {
                const indicators = plan.strategy.indicators
                  .map(indicator => ({ label: getIndicatorLabel(indicator.id, plan.strategy.indicators), value: match.indicatorValues[indicator.id] }))
                  .filter(entry => typeof entry.value === 'number')
                  .slice(0, 3);
                return (
                  <li key={match.symbolId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-100">{match.ticker} <span className="font-normal text-neutral-500">{match.name}</span></p>
                      <p className="text-[11px] text-neutral-400">
                        Close {formatNumber(match.lastClose)} · {match.lastDate} · {match.provenance.source} · {match.provenance.freshness}
                      </p>
                      <p className="text-[11px] text-neutral-500">
                        {indicators.length ? indicators.map(entry => entry.label + ' ' + formatNumber(entry.value)).join(' · ') : 'Indicator values unavailable'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onPrepareBacktest(match.symbolId, match.lastDate || result.asOf)}
                      className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-white/5 disabled:opacity-40"
                    >
                      Prepare backtest for {match.ticker}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <details className="rounded-xl border border-white/8 bg-black/10 p-3 text-xs text-neutral-400">
            <summary className="cursor-pointer font-medium text-neutral-300">Screen assumptions and provenance</summary>
            <div className="mt-3 space-y-3">
              {plan.assumptions.length > 0 && <ul className="list-disc space-y-1 pl-4">{plan.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul>}
              <p>Data source: {source} · Data cutoff: {result.asOf ?? 'not supplied'} · Scan completed: {result.scannedAt}</p>
              <p>Observation dates: {result.observationDates ? result.observationDates.earliest + ' to ' + result.observationDates.latest + ' (' + result.observationDates.staleSymbols + ' stale)' : 'Unavailable'}</p>
              <p>Source coverage: {JSON.stringify(result.sourceCoverage)}</p>
              {result.scanned !== result.requested && <p>Scanned {result.scanned} of {result.requested} requested instruments.</p>}
              {result.warnings.length > 0 && <ul className="list-disc space-y-1 pl-4">{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
              {result.errors.length > 0 && (
                <details>
                  <summary className="cursor-pointer">Technical provider errors ({result.errors.length})</summary>
                  <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-4">
                    {result.errors.map((item, index) => <li key={index}>{item.ticker ?? 'symbol ' + item.symbolId}: {item.code} — {item.message}</li>)}
                  </ul>
                </details>
              )}
              <details>
                <summary className="cursor-pointer">Exact screening rules and indicator configuration</summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-black/20 p-2">{JSON.stringify(plan.strategy, null, 2)}</pre>
              </details>
            </div>
          </details>

          <p className="text-xs text-neutral-500">
            Screening is read-only. A backtest needs exits, sizing, execution and cost assumptions; preparing a review does not run it.
          </p>
        </div>
      )}
    </article>
  );
};
