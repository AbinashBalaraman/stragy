import React from 'react';
import type { BacktestResponse } from '../../shared/strategy/types';
import { formatCurrency, formatNumber } from '../../client/format';
import { summarizeRunData } from './runSummary';

interface Props {
  result: BacktestResponse;
  onOpenDetails?: () => void;
}

const metric = (label: string, value: string, hint?: string) => (
  <div key={label} className="min-w-0">
    <dt className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</dt>
    <dd className="mt-0.5 text-base font-semibold text-neutral-100 tabular-nums" title={hint}>{value}</dd>
  </div>
);

/** Null or non-finite metrics stay visibly unavailable; they are never rendered as zero. */
const metricNumber = (value: number | null | undefined, digits = 2, suffix = '') =>
  typeof value === 'number' && Number.isFinite(value) ? formatNumber(value, digits, suffix) : 'Unavailable';
const metricCurrency = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? formatCurrency(value) : 'Unavailable';


/** Headline backtest output derived only from the validated BacktestResponse. */
export const BacktestResultCard: React.FC<Props> = ({ result, onOpenDetails }) => {
  const data = summarizeRunData(result);
  const metrics = result.metrics;
  const unavailable = metrics.unavailableReasons ?? {};
  const demo = data.mode === 'demo';
  const unknown = data.mode === 'unknown';

  return (
    <article aria-label="Backtest result" className="rounded-2xl border border-white/10 bg-[#171719] p-4 sm:p-5 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Latest backtest</p>
          <h3 className="mt-1 text-lg font-semibold text-neutral-100">{result.strategy.name}</h3>
          <p className="text-sm text-neutral-400">{result.symbol.ticker} · {result.symbol.name}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${demo ? 'border-amber-400/40 text-amber-200' : unknown ? 'border-amber-400/40 text-amber-200' : 'border-emerald-400/30 text-emerald-200'}`}>
          {data.modeLabel}
        </span>
      </header>

      <p className="text-xs text-neutral-400" data-testid="run-source">
        Source: {data.source} · Observed through: {data.observedThrough} · Dataset: {data.datasetRange}
      </p>
      {(demo || unknown) && (
        <p role="status" className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-100">
          {demo
            ? 'These are generated demo bars. Do not read them as observed market prices or live results.'
            : 'The server did not provide usable data provenance. Treat every headline number as unverified.'}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
        {metric('Total return', metricNumber(metrics.totalReturnPercent, 2, '%'))}
        {metric('Net P&L', metricCurrency(metrics.netPnl))}
        {metric('CAGR', metricNumber(metrics.cagr, 2, '%'), unavailable.cagr)}
        {metric('Sharpe', metricNumber(metrics.sharpeRatio), unavailable.sharpeRatio)}
        {metric('Max drawdown', metricNumber(metrics.maxDrawdownPercent, 2, '%'))}
        {metric('Trades', String(metrics.totalTrades))}
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        {onOpenDetails && (
          <button type="button" onClick={onOpenDetails} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-white/5">
            View details
          </button>
        )}
        <span className="text-[11px] text-neutral-500">
          {result.trades.length} executed trades · {result.bars[0]?.date ?? 'Unavailable'} to {result.bars.at(-1)?.date ?? 'Unavailable'}
        </span>
      </div>

      {data.warnings.length > 0 && (
        <details className="text-xs text-neutral-400">
          <summary className="cursor-pointer">Data warnings ({data.warnings.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {data.warnings.map(warning => <li key={warning}>{warning}</li>)}
          </ul>
        </details>
      )}
    </article>
  );
};
