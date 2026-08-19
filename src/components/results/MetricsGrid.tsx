import React from 'react';
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
      sub: `${metrics.totalReturnPercent >= 0 ? '+' : ''}${metrics.totalReturnPercent}% Total Return`,
      isPositive: isProfitable,
      icon: DollarSign,
      tooltip: 'Net profit after all Indian taxes (STT, GST, Exchange, SEBI, Stamp Duty) and slippage.'
    },
    {
      label: 'CAGR (Annualized)',
      value: `${metrics.cagr}%`,
      sub: `vs Benchmark: ${metrics.benchmarkReturnPercent}%`,
      isPositive: metrics.cagr > 0,
      icon: TrendingUp,
      tooltip: 'Compound Annual Growth Rate of the strategy over the test period.'
    },
    {
      label: 'Sharpe Ratio',
      value: `${metrics.sharpeRatio}`,
      sub: metrics.sharpeRatio >= 1.5 ? 'Institutional Grade' : metrics.sharpeRatio >= 1.0 ? 'Good' : 'Sub-optimal',
      isPositive: metrics.sharpeRatio >= 1.0,
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
      value: `${metrics.winRate}%`,
      sub: `${metrics.winningTrades} Wins / ${metrics.losingTrades} Losses (${metrics.totalTrades} Trades)`,
      isPositive: metrics.winRate >= 50,
      icon: Award,
      tooltip: 'Percentage of executed trades that closed with a positive net PnL.'
    },
    {
      label: 'Profit Factor',
      value: `${metrics.profitFactor}`,
      sub: `Gross Wins / Gross Losses`,
      isPositive: metrics.profitFactor >= 1.5,
      icon: Zap,
      tooltip: 'Ratio of gross winning trades to gross losing trades.'
    },
    {
      label: 'Sortino Ratio',
      value: `${metrics.sortinoRatio}`,
      sub: 'Downside Volatility Adjusted',
      isPositive: metrics.sortinoRatio >= 1.5,
      icon: BarChart3,
      tooltip: 'Sharpe variant penalizing only harmful downside volatility.'
    },
    {
      label: 'Alpha vs NIFTY',
      value: `${metrics.alpha >= 0 ? '+' : ''}${metrics.alpha}%`,
      sub: `Beta: ${metrics.beta}`,
      isPositive: metrics.alpha > 0,
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
