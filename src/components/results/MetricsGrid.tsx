import React from 'react';
import { formatNumber } from '../../client/format';
import {
  TrendingUp,
  ShieldAlert,
  Award,
  BarChart3,
  Percent,
  Activity,
  Zap,
  DollarSign
} from 'lucide-react';
import { BacktestMetrics } from '../../shared/strategy/types';
import { FinanceTooltip } from '../common/Tooltip';

interface MetricsGridProps {
  metrics: BacktestMetrics;
}

export const MetricsGrid: React.FC<MetricsGridProps> = ({ metrics }) => {
  const isProfitable = metrics.netPnl >= 0;

  const metricCards = [
    {
      label: 'Net Strategy PnL',
      value: `₹${metrics.netPnl.toLocaleString('en-IN')}`,
      sub: formatNumber(metrics.totalReturnPercent, 2, '% Total Return'),
      isPositive: isProfitable,
      icon: DollarSign,
      tooltip: 'Net profit after executed-fill cash fees and modeled slippage. Rates may be illustrative; see the run assumptions.'
    },
    {
      label: 'CAGR (Annualized)',
      value: formatNumber(metrics.cagr, 2, '%'),
      sub: `Instrument buy-hold: ${formatNumber(metrics.benchmarkReturnPercent, 2, '%')}`,
      isPositive: (metrics.cagr ?? -Infinity) > 0,
      icon: TrendingUp,
      tooltip: 'Compound Annual Growth Rate of the strategy over the test period.'
    },
    {
      label: 'Sharpe Ratio',
      value: formatNumber(metrics.sharpeRatio),
      sub: (metrics.sharpeRatio ?? -Infinity) >= 1.5 ? 'Historical sample' : (metrics.sharpeRatio ?? -Infinity) >= 1.0 ? 'Historical sample' : 'Historical sample',
      isPositive: (metrics.sharpeRatio ?? -Infinity) >= 1.0,
      icon: Activity,
      tooltip: 'Risk-adjusted return ratio measuring excess return per unit of total risk.'
    },
    {
      label: 'Max Drawdown',
      value: `${metrics.maxDrawdownPercent}%`,
      sub: `Peak-to-Trough: -₹${metrics.maxDrawdownAmount.toLocaleString('en-IN')}`,
      isPositive: metrics.maxDrawdownPercent < 15,
      icon: ShieldAlert,
      tooltip: 'Largest observed percentage decline from a historical equity peak.'
    },
    {
      label: 'Win Rate',
      value: formatNumber(metrics.winRate, 1, '%'),
      sub: `${metrics.winningTrades} Wins / ${metrics.losingTrades} Losses (${metrics.totalTrades} Trades)`,
      isPositive: (metrics.winRate ?? -Infinity) >= 50,
      icon: Award,
      tooltip: 'Percentage of executed trades that closed with a positive net PnL.'
    },
    {
      label: 'Profit Factor',
      value: formatNumber(metrics.profitFactor),
      sub: `Gross Wins / Gross Losses`,
      isPositive: (metrics.profitFactor ?? -Infinity) >= 1.5,
      icon: Zap,
      tooltip: 'Ratio of gross winning trades to gross losing trades.'
    },
    {
      label: 'Sortino Ratio',
      value: formatNumber(metrics.sortinoRatio),
      sub: 'Downside Volatility Adjusted',
      isPositive: (metrics.sortinoRatio ?? -Infinity) >= 1.5,
      icon: BarChart3,
      tooltip: 'Sharpe variant penalizing only harmful downside volatility.'
    },
    {
      label: 'Alpha vs Instrument',
      value: formatNumber(metrics.alpha, 2, '%'),
      sub: `Beta: ${formatNumber(metrics.beta)}`,
      isPositive: (metrics.alpha ?? -Infinity) > 0,
      icon: Percent,
      tooltip: 'Excess return generated over and above the buy-and-hold market benchmark.'
    }
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
      {metricCards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <div
            key={idx}
            className="p-4 bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl hover:border-[rgba(236,236,237,0.16)] transition-all space-y-2"
          >
            <div className="flex items-center justify-between text-xs text-[rgba(236,236,237,0.6)]">
              <span className="font-medium flex items-center gap-1">
                {card.label}
                <FinanceTooltip content={card.tooltip} />
              </span>
              <Icon className={`w-3.5 h-3.5 ${card.isPositive ? 'text-[#00ffa3]' : 'text-neutral-500'}`} />
            </div>

            <div>
              <div
                className={`text-lg sm:text-2xl font-extrabold font-mono tracking-tight ${
                  card.isPositive ? 'text-[#00ffa3]' : 'text-[#ececed]'
                }`}
              >
                {card.value}
              </div>
              <p className="text-[11px] text-[rgba(236,236,237,0.45)] font-mono truncate">{card.sub}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
