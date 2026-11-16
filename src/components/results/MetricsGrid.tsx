import React from 'react';
import { formatINR, formatNumber, formatPercent } from '../../shared/format';
import {
  TrendingUp,
  ShieldAlert,
  Award,
  BarChart3,
  Percent,
  Activity,
  Zap,
  DollarSign,
  ChevronRight
} from 'lucide-react';
import { BacktestMetrics } from '../../shared/strategy/types';
import { FinanceTooltip } from '../common/Tooltip';

interface MetricsGridProps {
  metrics: BacktestMetrics;
}

interface MetricCard {
  label: string;
  value: string;
  sub: string;
  isPositive: boolean;
  muted?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  tooltip: string;
}

const MetricTile: React.FC<{ card: MetricCard }> = ({ card }) => {
  const Icon = card.icon;
  const longValue = card.value.length > 10;
  return (
    <div className="min-w-0 rounded-xl border border-[rgba(236,236,237,0.08)] bg-[#171719] p-3.5 sm:p-4 space-y-2 transition-colors hover:border-[rgba(236,236,237,0.16)]">
      <div className="flex items-start justify-between gap-2 text-[11px] sm:text-xs leading-tight text-[rgba(236,236,237,0.62)]">
        <span className="font-medium flex items-start gap-1 min-w-0">
          <span className="break-words">{card.label}</span>
          <FinanceTooltip content={card.tooltip} />
        </span>
        <Icon className={`w-3.5 h-3.5 shrink-0 ${card.muted ? 'text-neutral-500' : card.isPositive ? 'text-[#a8c7fa]' : 'text-neutral-500'}`} />
      </div>

      <div>
        <div
          title={card.value}
          className={`min-w-0 break-words font-mono font-semibold leading-6 tracking-tight tabular-nums ${
            longValue ? 'text-base sm:text-xl' : 'text-lg sm:text-2xl'
          } ${card.muted ? 'text-[#d6d6d8]' : card.isPositive ? 'text-[#a8c7fa]' : 'text-[#ececed]'}`}
        >
          {card.value}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-[rgba(236,236,237,0.52)]">{card.sub}</p>
      </div>
    </div>
  );
};

export const MetricsGrid: React.FC<MetricsGridProps> = ({ metrics }) => {
  const isProfitable = metrics.netPnl >= 0;
  const trades = metrics.totalTrades ?? 0;
  const insufficientEvidence = trades < 30;
  const noLosingTrades = metrics.losingTrades === 0 && metrics.winningTrades > 0 && metrics.profitFactor === null;
  const tradeWord = trades === 1 ? 'trade' : 'trades';
  const winWord = metrics.winningTrades === 1 ? 'win' : 'wins';
  const lossWord = metrics.losingTrades === 1 ? 'loss' : 'losses';
  const winnerWord = metrics.winningTrades === 1 ? 'winner' : 'winners';
  const barWord = Math.abs(metrics.avgHoldingBars) === 1 ? 'bar' : 'bars';
  const sampleNote = insufficientEvidence ? `Small sample: ${trades} ${tradeWord}` : 'Excess return per unit of total risk';

  const headline: MetricCard[] = [
    {
      label: 'Net P&L',
      value: formatINR(metrics.netPnl, { signed: true }),
      sub: `${formatPercent(metrics.totalReturnPercent, { signed: true, decimals: 2 })} total return after fees`,
      isPositive: isProfitable,
      icon: DollarSign,
      tooltip: 'Net profit after executed-fill cash fees and modeled slippage. Rates may be illustrative; see the run assumptions.'
    },
    {
      label: 'CAGR',
      value: formatPercent(metrics.cagr, { decimals: 2, signed: true }),
      sub: `Buy-and-hold ${formatPercent(metrics.benchmarkReturnPercent, { decimals: 2, signed: true })}`,
      isPositive: (metrics.cagr ?? -Infinity) > 0,
      icon: TrendingUp,
      tooltip: 'Compound annual growth rate of the strategy over the tested period.'
    },
    {
      label: 'Max drawdown',
      value: formatPercent(Math.abs(metrics.maxDrawdownPercent), { decimals: 2 }),
      sub: `Peak to trough: ${formatINR(-Math.abs(metrics.maxDrawdownAmount), { signed: true })}`,
      isPositive: metrics.maxDrawdownPercent < 15,
      icon: ShieldAlert,
      tooltip: 'Largest observed percentage decline from a historical equity peak.'
    },
    {
      label: 'Win rate',
      value: formatPercent(metrics.winRate, { decimals: 1 }),
      sub: `${metrics.winningTrades} ${winWord} / ${metrics.losingTrades} ${lossWord} · ${trades} ${tradeWord}`,
      isPositive: (metrics.winRate ?? -Infinity) >= 50,
      muted: insufficientEvidence,
      icon: Award,
      tooltip: 'Percentage of executed trades that closed with a positive net P&L.'
    }
  ];

  const more: MetricCard[] = [
    {
      label: 'Sharpe ratio',
      value: formatNumber(metrics.sharpeRatio),
      sub: sampleNote,
      isPositive: (metrics.sharpeRatio ?? -Infinity) >= 1,
      muted: insufficientEvidence,
      icon: Activity,
      tooltip: 'Risk-adjusted return measuring excess return per unit of total risk.'
    },
    {
      label: 'Sortino ratio',
      value: formatNumber(metrics.sortinoRatio),
      sub: insufficientEvidence ? sampleNote : 'Penalises downside volatility only',
      isPositive: (metrics.sortinoRatio ?? -Infinity) >= 1.5,
      muted: insufficientEvidence,
      icon: BarChart3,
      tooltip: 'Sharpe variant that penalises only harmful downside volatility.'
    },
    {
      label: 'Profit factor',
      value: noLosingTrades ? 'No losing trades' : formatNumber(metrics.profitFactor),
      sub: noLosingTrades ? `${metrics.winningTrades} ${winnerWord}, no gross losses` : 'Gross wins ÷ gross losses',
      isPositive: (metrics.profitFactor ?? -Infinity) >= 1.5,
      icon: Zap,
      tooltip: 'Ratio of gross winning trades to gross losing trades.'
    },
    {
      label: 'Alpha vs instrument',
      value: formatPercent(metrics.alpha, { decimals: 2, signed: true }),
      sub: `Beta ${formatNumber(metrics.beta)} · vs buy-and-hold`,
      isPositive: (metrics.alpha ?? -Infinity) > 0,
      icon: Percent,
      tooltip: 'Excess return generated over and above the buy-and-hold market benchmark.'
    },
    {
      label: 'Benchmark return',
      value: formatPercent(metrics.benchmarkReturnPercent, { decimals: 2, signed: true }),
      sub: 'Instrument buy-and-hold, same window',
      isPositive: metrics.benchmarkReturnPercent >= 0,
      icon: TrendingUp,
      tooltip: 'Return on holding the instrument over the same evaluation window, without timing rules.'
    },
    {
      label: 'Average trade',
      value: formatINR(metrics.averageTradePnl, { signed: true }),
      sub: `Held ${formatNumber(metrics.avgHoldingBars, 0)} ${barWord} on average`,
      isPositive: metrics.averageTradePnl >= 0,
      icon: DollarSign,
      tooltip: 'Mean net P&L across all executed trade cycles.'
    }
  ];

  return (
    <div className="space-y-3">
      {insufficientEvidence && (
        <div
          role="status"
          className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5 text-xs leading-relaxed text-amber-100"
        >
          <strong className="font-semibold text-amber-200">Insufficient evidence: {trades} {tradeWord} (need 30+).</strong>
          <span>Sharpe, Sortino and win rate are shown for completeness, not as a reliable signal.</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-3.5 lg:grid-cols-4">
        {headline.map(card => <MetricTile key={card.label} card={card} />)}
      </div>

      <details className="group rounded-xl border border-[rgba(236,236,237,0.08)] bg-[#171719]/60">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2.5 text-xs font-medium text-[rgba(236,236,237,0.7)] transition-colors hover:text-[#ececed] [&::-webkit-details-marker]:hidden">
          <span>More metrics <span className="text-[rgba(236,236,237,0.45)]">({more.length})</span></span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#a8c7fa] transition-transform group-open:rotate-90" />
        </summary>
        <div className="grid grid-cols-2 gap-3 border-t border-[rgba(236,236,237,0.06)] p-3 sm:gap-3.5 sm:p-3.5 lg:grid-cols-3">
          {more.map(card => <MetricTile key={card.label} card={card} />)}
        </div>
      </details>
    </div>
  );
};
