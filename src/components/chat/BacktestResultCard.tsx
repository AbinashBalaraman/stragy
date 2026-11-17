import React from 'react';
import type { BacktestResponse, TradeRecord } from '../../shared/strategy/types';
import { formatDate, formatINR, formatNumber, formatPercent } from '../../shared/format';
import { CardShell } from '../common/CardShell';
import { DataTable, type DataColumn } from '../common/DataTable';
import { Disclosure } from '../common/Disclosure';
import { EquityCurve } from '../common/EquityCurve';
import { StatRow, type Stat } from '../common/StatRow';
import { summarizeRunData } from './runSummary';

interface Props {
  result: BacktestResponse;
  onOpenDetails?: () => void;
}

/** A provider id is not a human sentence. Use the same label in the badge and the source line. */
const humanSource = (source: string): string => {
  if (source === 'ANGEL_SMARTAPI') return 'Angel One daily data';
  if (source === 'YAHOO_PUBLIC_CHART') return 'Yahoo daily data';
  if (source === 'DETERMINISTIC_DEMO_V1' || source === 'DEMO_MODEL') return 'Generated demo data';
  if (!source || source === 'Unavailable') return 'Source unavailable';
  const words = source.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const humanRange = (range: string): string =>
  range.replace(/\b\d{4}-\d{2}-\d{2}\b/g, date => formatDate(date));

/** Null or non-finite metrics stay visibly unavailable; they are never rendered as zero. */
const metricNumber = (value: number | null | undefined, digits = 2, suffix = '') =>
  typeof value === 'number' && Number.isFinite(value) ? formatNumber(value, digits) + suffix : 'Unavailable';
const metricCurrency = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? formatINR(value, { signed: true }) : 'Unavailable';
const metricPercent = (value: number | null | undefined, digits = 2) =>
  typeof value === 'number' && Number.isFinite(value) ? formatPercent(value, { decimals: digits }) : 'Unavailable';

const exitLabel = (reason: TradeRecord['exitReason'] | string | undefined): string => {
  switch (reason) {
    case 'STOP_LOSS': return 'Stop loss';
    case 'TAKE_PROFIT': return 'Take profit';
    case 'TRAILING_STOP': return 'Trailing stop';
    case 'RULE_EXIT': return 'Rule exit';
    case 'MAX_DRAWDOWN': return 'Max drawdown';
    case 'END_OF_DATA': return 'End of data';
    default: return '—';
  }
};

const hasTrades = (trades: TradeRecord[] | undefined): trades is TradeRecord[] =>
  Array.isArray(trades) && trades.some(trade => trade && typeof trade.entryDate === 'string' && typeof trade.netPnl === 'number');

/** Headline backtest output derived only from the validated BacktestResponse. */
export const BacktestResultCard: React.FC<Props> = ({ result, onOpenDetails }) => {
  const data = summarizeRunData(result);
  const metrics = result.metrics;
  const unavailable = metrics.unavailableReasons ?? {};
  const demo = data.mode === 'demo';
  const unknown = data.mode === 'unknown';
  const sourceLabel = humanSource(data.source);
  const badge = demo || unknown
    ? data.modeLabel
    : data.source === 'Unavailable'
      ? 'Observed daily data'
      : sourceLabel;

  const stats: Stat[] = [
    { label: 'Total return', value: metricPercent(metrics.totalReturnPercent, 2) },
    { label: 'Net P&L', value: metricCurrency(metrics.netPnl) },
    { label: 'CAGR', value: metricPercent(metrics.cagr, 2), unavailable: !Number.isFinite(metrics.cagr), hint: unavailable.cagr },
    { label: 'Sharpe', value: metricNumber(metrics.sharpeRatio), unavailable: !Number.isFinite(metrics.sharpeRatio), hint: unavailable.sharpeRatio },
    { label: 'Max drawdown', value: metricPercent(Math.abs(metrics.maxDrawdownPercent), 2) },
    { label: 'Trades', value: String(metrics.totalTrades) },
  ];

  const curve = Array.isArray(result.equityCurve)
    ? result.equityCurve.filter(point => typeof point?.equity === 'number' && Number.isFinite(point.equity))
    : [];
  const curveLabels: [string, string, string] | undefined = curve.length > 1
    ? [formatDate(curve[0].date), formatDate(curve[Math.floor(curve.length / 2)].date), formatDate(curve[curve.length - 1].date)]
    : undefined;

  const trades = hasTrades(result.trades) ? result.trades : [];
  const columns: DataColumn<TradeRecord>[] = [
    { key: 'entry', header: 'Entry', sticky: true, render: trade => formatDate(trade.entryDate) },
    { key: 'exit', header: 'Exit', render: trade => formatDate(trade.exitDate) },
    { key: 'reason', header: 'Exit reason', render: trade => exitLabel(trade.exitReason) },
    { key: 'held', header: 'Bars', align: 'right', render: trade => (typeof trade.holdingBars === 'number' ? String(trade.holdingBars) : typeof trade.holdingDays === 'number' ? String(trade.holdingDays) : '—') },
    {
      key: 'net',
      header: 'Net P&L',
      align: 'right',
      render: trade => (
        <span className={'st-tnum ' + (trade.netPnl >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]')}>{formatINR(trade.netPnl, { signed: true })}</span>
      ),
    },
  ];

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {onOpenDetails ? (
        <button
          type="button"
          onClick={onOpenDetails}
          className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] border border-[var(--line-strong)] px-3 text-[var(--text-1)] transition-colors hover:bg-[var(--surface-hover)] sm:min-h-8"
        >
          View details
        </button>
      ) : <span />}
      <span className="st-meta text-[var(--text-3)]">
        {result.trades.length} executed {result.trades.length === 1 ? 'trade' : 'trades'} · {formatDate(result.bars[0]?.date)} to {formatDate(result.bars.at(-1)?.date)}
      </span>
    </div>
  );

  return (
    <article aria-label="Backtest result">
      <CardShell
        title={result.strategy.name}
        meta={result.symbol.ticker + ' · ' + result.symbol.name}
        state={demo || unknown ? 'partial' : 'idle'}
        status={badge}
        footer={footer}
      >
        <p className="st-meta text-[var(--text-3)]" data-testid="run-source">
          Source: {sourceLabel} · Observed through: {humanRange(data.observedThrough)} · Dataset: {humanRange(data.datasetRange)}
        </p>
        {(demo || unknown) && (
          <p className="text-[13px] leading-5 text-[#f5d383]">
            {demo
              ? 'These are generated demo bars. Do not read them as observed market prices or live results.'
              : 'The server did not provide usable data provenance. Treat every headline number as unverified.'}
          </p>
        )}

        <StatRow stats={stats} columns={3} />

        {curve.length > 1 && (
          <EquityCurve
            values={curve.map(point => point.equity)}
            labels={curveLabels}
            ariaLabel={'Equity curve, ' + formatDate(curve[0].date) + ' to ' + formatDate(curve[curve.length - 1].date)}
          />
        )}

        {trades.length > 0 && (
          <DataTable
            caption={'Executed trades, ' + trades.length + (trades.length === 1 ? ' row' : ' rows')}
            columns={columns}
            rows={trades}
            rowKey={(trade, index) => trade.id || 'trade-' + index}
            initialLimit={5}
          />
        )}

        {data.warnings.length > 0 && (
          <Disclosure summary={'Data warnings (' + data.warnings.length + ')'}>
            <ul className="list-disc space-y-1 pl-4">
              {data.warnings.map(warning => <li key={warning}>{warning}</li>)}
            </ul>
          </Disclosure>
        )}
      </CardShell>
    </article>
  );
};
