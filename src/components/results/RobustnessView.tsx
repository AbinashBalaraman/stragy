import React, { useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from 'recharts';
import { RobustnessSuite, BacktestResponse } from '../../shared/strategy/types';
import { formatDate, formatINR, formatNumber, formatPercent } from '../../shared/format';
import { StatRow } from '../common/StatRow';
import { Disclosure } from '../common/Disclosure';

interface RobustnessViewProps {
  robustness?: RobustnessSuite;
  result?: BacktestResponse;
  onRunNewSimulation?: () => void;
}

export const RobustnessView: React.FC<RobustnessViewProps> = ({ robustness, result }) => {
  const [activeTab, setActiveTab] = useState<'monteCarlo' | 'trainTest' | 'sensitivity'>('monteCarlo');
  const suite = robustness || result?.robustness;

  if (!suite) {
    return (
      <div className="rounded-[var(--r-card)] border border-[var(--line)] bg-[var(--surface-1)] p-8 text-center text-xs text-[var(--text-3)]">
        No robustness data is available for this run.
      </div>
    );
  }

  const { monteCarlo, trainTestSplit, sensitivityHeatmap } = suite;

  const mcChartData = monteCarlo.percentileCurves.p50.map((_, idx) => ({
    step: `Day ${idx}`,
    p10: monteCarlo.percentileCurves.p10[idx],
    p25: monteCarlo.percentileCurves.p25[idx],
    p50: monteCarlo.percentileCurves.p50[idx],
    p75: monteCarlo.percentileCurves.p75[idx],
    p90: monteCarlo.percentileCurves.p90[idx]
  }));

  const tabButton = (id: typeof activeTab, label: string) => (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      aria-current={activeTab === id ? 'page' : undefined}
      className={'rounded-[var(--r-btn)] px-2.5 py-1.5 text-xs transition-colors ' + (activeTab === id ? 'bg-white/[0.08] font-medium text-[var(--text-1)]' : 'text-[var(--text-3)] hover:bg-white/[0.04] hover:text-[var(--text-2)]')}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4 rounded-[var(--r-card)] border border-[var(--line)] bg-[var(--surface-1)] p-4 sm:p-5">
      <div className="flex flex-col justify-between gap-3 border-b border-[var(--line)] pb-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="st-title font-semibold text-[var(--text-1)]">Robustness checks</h3>
          <p className="st-meta mt-0.5 text-[var(--text-3)]">Three checks: reshuffled returns, an earlier/later split, and a stop/target grid.</p>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Robustness views">
          {tabButton('monteCarlo', 'Reshuffled returns')}
          {tabButton('trainTest', 'Train / test')}
          {tabButton('sensitivity', 'Stop & target')}
        </div>
      </div>

      {activeTab === 'monteCarlo' && (
        <div className="space-y-4">
          <p className="text-xs leading-5 text-[var(--text-2)]">
            We reshuffled the daily returns 500 times to see the range of outcomes. This is not a forecast.
            {monteCarlo.reason ? ` ${monteCarlo.reason}` : ''}
          </p>
          <Disclosure summary="How this test works">
            <p>Independent daily net-equity returns were resampled with seed {monteCarlo.seed ?? 'N/A'} over the observed horizon only. Serial dependence is ignored; this is not a forecast.</p>
          </Disclosure>
          <StatRow
            columns={4}
            stats={[
              { label: 'Weak case (10th percentile)', value: formatINR(monteCarlo.p10TerminalEquity), hint: 'One in ten simulated outcomes ended below this.' },
              { label: 'Typical (median)', value: formatINR(monteCarlo.p50TerminalEquity), hint: 'The middle simulated outcome.' },
              { label: 'Strong case (90th)', value: formatINR(monteCarlo.p90TerminalEquity), hint: 'One in ten simulated outcomes ended above this.' },
              { label: 'Chance of a 15%+ drawdown', value: formatPercent(monteCarlo.probDrawdownOver15, { decimals: 1 }), hint: 'Share of simulations with a 15% or deeper drawdown.' },
            ]}
          />

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mcChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(236, 236, 237, 0.05)" />
                <XAxis dataKey="step" stroke="#6b7280" fontSize={10} minTickGap={30} />
                <YAxis stroke="#6b7280" fontSize={10} domain={["auto", "auto"]} tickFormatter={value => `₹${(value / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#151517',
                    borderColor: 'rgba(236, 236, 237, 0.12)',
                    borderRadius: '0.75rem',
                    fontSize: '0.75rem',
                    color: '#ececed'
                  }}
                  formatter={(value: number) => [formatINR(Number(value))]}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Line type="monotone" dataKey="p90" stroke="#9a9aa3" strokeWidth={1.5} dot={false} name="Strong case (90th)" />
                <Line type="monotone" dataKey="p50" stroke="#a8c7fa" strokeWidth={2} dot={false} name="Typical (median)" />
                <Line type="monotone" dataKey="p10" stroke="#b9b9c0" strokeWidth={1.5} dot={false} name="Weak case (10th), not worst case" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeTab === 'trainTest' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--r-inner)] bg-[var(--surface-2)] p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-2)]">Out-of-sample check:</span>
              <span
                className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${
                  trainTestSplit.overfittingRisk === 'LOW'
                    ? 'border-[#a8c7fa]/30 bg-[#a8c7fa]/10 text-[#a8c7fa]'
                    : trainTestSplit.overfittingRisk === 'MODERATE'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                      : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                }`}
              >
                {trainTestSplit.overfittingRisk}
              </span>
            </div>
            <span className="st-tnum text-xs text-[var(--text-3)]">Split after {formatDate(trainTestSplit.splitDate)}</span>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-3 rounded-[var(--r-inner)] bg-[var(--surface-2)] p-4">
              <div className="flex items-center justify-between pb-1.5">
                <span className="text-xs font-medium text-[var(--text-1)]">Fitted on the first 70%</span>
                <span className="text-xs text-[rgba(236,236,237,0.55)]">{trainTestSplit.trainMetrics.tradesCount} trades</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[rgba(236,236,237,0.55)]">CAGR</span>
                  <div className="st-tnum text-sm font-semibold text-[var(--text-1)]">{formatPercent(trainTestSplit.trainMetrics.cagr, { decimals: 2 })}</div>
                </div>
                <div>
                  <span className="text-[rgba(236,236,237,0.55)]">Sharpe</span>
                  <div className="st-tnum text-sm font-semibold text-[var(--text-1)]">{formatNumber(trainTestSplit.trainMetrics.sharpe)}</div>
                </div>
                <div>
                  <span className="text-[rgba(236,236,237,0.55)]">Win rate</span>
                  <div className="st-tnum text-sm font-semibold text-[var(--text-1)]">{formatPercent(trainTestSplit.trainMetrics.winRate, { decimals: 1 })}</div>
                </div>
                <div>
                  <span className="text-[rgba(236,236,237,0.55)]">Max drawdown</span>
                  <div className="st-tnum text-sm font-semibold text-[var(--down)]">{formatPercent(Math.abs(trainTestSplit.trainMetrics.maxDrawdown), { decimals: 2 })}</div>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-[var(--r-inner)] bg-[var(--surface-2)] p-4">
              <div className="flex items-center justify-between pb-1.5">
                <span className="text-xs font-medium text-[var(--text-1)]">Tested on the last 30%</span>
                <span className="text-xs text-[rgba(236,236,237,0.55)]">{trainTestSplit.testMetrics.tradesCount} trades</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[rgba(236,236,237,0.55)]">CAGR</span>
                  <div className="st-tnum text-sm font-semibold text-[var(--text-1)]">{formatPercent(trainTestSplit.testMetrics.cagr, { decimals: 2 })}</div>
                </div>
                <div>
                  <span className="text-[rgba(236,236,237,0.55)]">Sharpe</span>
                  <div className="st-tnum text-sm font-semibold text-[var(--text-1)]">{formatNumber(trainTestSplit.testMetrics.sharpe)}</div>
                </div>
                <div>
                  <span className="text-[rgba(236,236,237,0.55)]">Win rate</span>
                  <div className="st-tnum text-sm font-semibold text-[var(--text-1)]">{formatPercent(trainTestSplit.testMetrics.winRate, { decimals: 1 })}</div>
                </div>
                <div>
                  <span className="text-[rgba(236,236,237,0.55)]">Max drawdown</span>
                  <div className="st-tnum text-sm font-semibold text-[var(--down)]">{formatPercent(Math.abs(trainTestSplit.testMetrics.maxDrawdown), { decimals: 2 })}</div>
                </div>
              </div>
              <p className="text-[11px] text-[rgba(236,236,237,0.5)]">
                Return fell {formatNumber(trainTestSplit.cagrDecayRatio, 2)}× from the fitted window to the test window.
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'sensitivity' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[rgba(236,236,237,0.55)]">
            <span>{sensitivityHeatmap.param1Name} (down the side) vs {sensitivityHeatmap.param2Name} (across)</span>
            <span className="font-medium text-[#a8c7fa]">Net return</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-center text-[10px] sm:text-xs">
              <thead>
                <tr>
                  <th className="w-[34%] whitespace-normal break-words p-1.5 text-left text-[10px] text-[var(--text-3)] sm:p-2">{sensitivityHeatmap.param1Name.replace(/\s*\(percent\)/i, '')} ↓ · {sensitivityHeatmap.param2Name.replace(/\s*\(percent\)/i, '')} →</th>
                  {sensitivityHeatmap.param2Values.map(tp => (
                    <th key={tp} className="truncate p-1.5 st-tnum font-semibold text-[rgba(236,236,237,0.7)] sm:p-2">{formatPercent(tp, { decimals: 1 })}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sensitivityHeatmap.matrix.map((row, rowIndex) => {
                  const stopLoss = sensitivityHeatmap.param1Values[rowIndex];
                  return (
                    <tr key={stopLoss} className="border-t border-[rgba(236,236,237,0.06)]">
                      <td className="st-tnum whitespace-nowrap p-1.5 text-left font-semibold text-[var(--text-3)] sm:p-2">{formatPercent(stopLoss, { decimals: 1 })}</td>
                      {row.map((cell, columnIndex) => {
                        const value = cell.metricValue;
                        const background =
                          (value ?? -Infinity) >= 1.5
                            ? 'bg-[#a8c7fa]/30 text-[#a8c7fa]'
                            : (value ?? -Infinity) >= 1.0
                              ? 'bg-[#a8c7fa]/15 text-[#a8c7fa]'
                              : (value ?? -Infinity) >= 0.5
                                ? 'bg-[#a8c7fa]/10 text-[#ececed]'
                                : (value ?? -Infinity) >= 0
                                  ? 'bg-[#1e1e21] text-[rgba(236,236,237,0.7)]'
                                  : 'bg-rose-500/15 text-rose-300';
                        return (
                          <td key={columnIndex} className={`m-0.5 rounded p-1.5 st-tnum font-semibold sm:p-2.5 ${background}`}>
                            {formatPercent(value, { decimals: 2 })}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

