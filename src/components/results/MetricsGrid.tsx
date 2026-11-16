import React from 'react';
import { formatINR, formatNumber, formatPercent } from '../../shared/format';
import { BacktestMetrics } from '../../shared/strategy/types';
import { StatRow, type Stat } from '../common/StatRow';
import { Disclosure } from '../common/Disclosure';

interface MetricsGridProps {
  metrics: BacktestMetrics;
}

/**
 * Headline backtest metrics in the shared stat row: tabular sans figures,
 * no icons, no split signs. Small samples get one quiet line + a disclosure.
 */
export const MetricsGrid: React.FC<MetricsGridProps> = ({ metrics }) => {
  const trades = metrics.totalTrades ?? 0;
  const insufficientEvidence = trades < 30;
  const noLosingTrades = metrics.losingTrades === 0 && metrics.winningTrades > 0 && metrics.profitFactor === null;
  const tradeWord = trades === 1 ? 'trade' : 'trades';
  const winWord = metrics.winningTrades === 1 ? 'win' : 'wins';
  const lossWord = metrics.losingTrades === 1 ? 'loss' : 'losses';
  const barWord = Math.abs(metrics.avgHoldingBars) === 1 ? 'bar' : 'bars';

  const headline: Stat[] = [
    {
      label: 'Net P&L',
      value: formatINR(metrics.netPnl, { signed: true }),
      hint: 'Net profit after executed-fill cash fees and modeled slippage. Rates may be illustrative.',
    },
    {
      label: 'CAGR',
      value: formatPercent(metrics.cagr, { decimals: 2, signed: true }),
      hint: 'Compound annual growth rate over the tested period.',
    },
    {
      label: 'Max drawdown',
      value: formatPercent(Math.abs(metrics.maxDrawdownPercent), { decimals: 2 }),
      hint: 'Largest observed percentage decline from an equity peak.',
    },
    {
      label: 'Win rate',
      value: formatPercent(metrics.winRate, { decimals: 1 }),
      hint: `${metrics.winningTrades} ${winWord} / ${metrics.losingTrades} ${lossWord} across ${trades} ${tradeWord}.`,
    },
  ];

  const more: Stat[] = [
    { label: 'Total return', value: formatPercent(metrics.totalReturnPercent, { signed: true, decimals: 2 }), hint: 'Return after fees over the full window.' },
    { label: 'Buy and hold', value: formatPercent(metrics.benchmarkReturnPercent, { decimals: 2, signed: true }), hint: 'Holding the instrument over the same window, without timing rules.' },
    { label: 'Sharpe', value: formatNumber(metrics.sharpeRatio), hint: 'Excess return per unit of total risk. Small samples make this indicative.' },
    { label: 'Sortino', value: formatNumber(metrics.sortinoRatio), hint: 'Sharpe variant that penalises only downside volatility.' },
    {
      label: 'Profit factor',
      value: noLosingTrades ? 'No losing trades' : formatNumber(metrics.profitFactor),
      hint: noLosingTrades ? `${metrics.winningTrades} winners with no gross losses.` : 'Gross wins divided by gross losses.',
    },
    { label: 'Alpha', value: formatPercent(metrics.alpha, { decimals: 2, signed: true }), hint: 'Excess return over buy-and-hold.' },
    { label: 'Beta', value: formatNumber(metrics.beta), hint: 'Sensitivity to the instrument benchmark.' },
    { label: 'Average trade', value: formatINR(metrics.averageTradePnl, { signed: true }), hint: `Mean net P&L; average hold ${formatNumber(metrics.avgHoldingBars, 0)} ${barWord}.` },
    { label: 'Trades', value: String(trades), hint: `${metrics.winningTrades} ${winWord}, ${metrics.losingTrades} ${lossWord}.` },
    { label: 'Peak-to-trough', value: formatINR(-Math.abs(metrics.maxDrawdownAmount), { signed: true }), hint: 'Cash drawdown at the worst peak.' },
  ];

  return (
    <div className="space-y-4">
      {insufficientEvidence && (
        <div className="space-y-1">
          <p className="st-meta text-[#f5d383]">
            {trades} {tradeWord}: a small sample. Ratios are indicative, not a reliable signal.
          </p>
          <Disclosure summary="What this means">
            <p>
              Fewer than 30 executed trades were available, so Sharpe, Sortino and win rate are shown for completeness.
              They describe this window only; they are not evidence that the edge will repeat.
            </p>
          </Disclosure>
        </div>
      )}

      <StatRow stats={headline} columns={4} />

      <Disclosure summary={`More metrics (${more.length})`}>
        <StatRow stats={more} columns={3} />
      </Disclosure>
    </div>
  );
};
