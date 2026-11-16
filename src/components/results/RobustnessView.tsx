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
import { ShieldCheck, Dice5, SplitSquareVertical, Grid3X3 } from 'lucide-react';

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
      <div className="rounded-2xl border border-[rgba(236,236,237,0.08)] bg-[#171719] p-8 text-center text-xs text-[rgba(236,236,237,0.55)]">
        No robustness data is available for this run.
      </div>
    );
  }

  const { monteCarlo, trainTestSplit, sensitivityHeatmap } = suite;

  const mcChartData = monteCarlo.percentileCurves.p50.map((_, idx) => ({
    step: `Step ${idx}`,
    p10: monteCarlo.percentileCurves.p10[idx],
    p25: monteCarlo.percentileCurves.p25[idx],
    p50: monteCarlo.percentileCurves.p50[idx],
    p75: monteCarlo.percentileCurves.p75[idx],
    p90: monteCarlo.percentileCurves.p90[idx]
  }));

  const tabButton = (id: typeof activeTab, label: string, Icon: React.ComponentType<{ className?: string }>) => (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      aria-current={activeTab === id ? 'page' : undefined}
      className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors sm:w-auto sm:px-3 ${
        activeTab === id ? 'bg-[#a8c7fa] font-semibold text-[#101012]' : 'text-[rgba(236,236,237,0.55)] hover:text-[#ececed]'
      }`}
    >
      <Icon className={`h-3.5 w-3.5 ${activeTab === id ? 'text-[#101012]' : 'text-[#a8c7fa]'}`} />
      <span>{label}</span>
    </button>
  );

  return (
    <div className="space-y-4 rounded-2xl border border-[rgba(236,236,237,0.08)] bg-[#171719] p-4 sm:p-5">
      <div className="flex flex-col justify-between gap-3 border-b border-[rgba(236,236,237,0.08)] pb-3.5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="h-5 w-5 text-[#a8c7fa]" />
          <div>
            <h3 className="text-sm font-semibold text-[#ececed]">Robustness checks</h3>
            <p className="mt-0.5 text-[11px] text-[rgba(236,236,237,0.52)]">
              500-run Monte Carlo · 70/30 out-of-sample split · parameter sensitivity
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 items-center gap-1 rounded-xl border border-[rgba(236,236,237,0.08)] bg-[#1e1e21] p-1 sm:flex">
          {tabButton('monteCarlo', 'Monte Carlo', Dice5)}
          {tabButton('trainTest', '70/30 holdout', SplitSquareVertical)}
          {tabButton('sensitivity', 'Sensitivity', Grid3X3)}
        </div>
      </div>

      {activeTab === 'monteCarlo' && (
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-[rgba(236,236,237,0.58)]">
            IID daily net-equity return resampling with seed {monteCarlo.seed ?? 'N/A'}. Observed horizon only; this is not a forecast and ignores serial dependence.
            {monteCarlo.reason ? ` ${monteCarlo.reason}` : ''}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-[rgba(236,236,237,0.08)] bg-[#151517] p-3">
              <span className="block text-[11px] text-[rgba(236,236,237,0.55)]">P10 conservative equity</span>
              <span className="mt-1 block font-mono text-sm font-semibold text-rose-300">{formatINR(monteCarlo.p10TerminalEquity)}</span>
            </div>
            <div className="rounded-xl border border-[rgba(236,236,237,0.08)] bg-[#151517] p-3">
              <span className="block text-[11px] text-[rgba(236,236,237,0.55)]">P50 median equity</span>
              <span className="mt-1 block font-mono text-sm font-semibold text-[#a8c7fa]">{formatINR(monteCarlo.p50TerminalEquity)}</span>
            </div>
            <div className="rounded-xl border border-[rgba(236,236,237,0.08)] bg-[#151517] p-3">
              <span className="block text-[11px] text-[rgba(236,236,237,0.55)]">P90 optimistic equity</span>
              <span className="mt-1 block font-mono text-sm font-semibold text-[#a8c7fa]">{formatINR(monteCarlo.p90TerminalEquity)}</span>
            </div>
            <div className="rounded-xl border border-[rgba(236,236,237,0.08)] bg-[#151517] p-3">
              <span className="block text-[11px] text-[rgba(236,236,237,0.55)]">P(drawdown ≥ 15%)</span>
              <span className={`mt-1 block font-mono text-sm font-semibold ${(monteCarlo.probDrawdownOver15 ?? 0) > 30 ? 'text-rose-300' : 'text-[#a8c7fa]'}`}>
                {formatPercent(monteCarlo.probDrawdownOver15, { decimals: 1 })}
              </span>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mcChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(236, 236, 237, 0.05)" />
                <XAxis dataKey="step" stroke="#6b7280" fontSize={10} minTickGap={30} />
                <YAxis stroke="#6b7280" fontSize={10} tickFormatter={value => `₹${(value / 1000).toFixed(0)}k`} />
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
                <Line type="monotone" dataKey="p90" stroke="#a8c7fa" strokeWidth={1.5} dot={false} name="90th percentile" />
                <Line type="monotone" dataKey="p50" stroke="#ececed" strokeWidth={2} dot={false} name="50th percentile (median)" />
                <Line type="monotone" dataKey="p10" stroke="#ff4d4d" strokeWidth={1.5} dot={false} name="10th percentile, not worst case" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeTab === 'trainTest' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[rgba(236,236,237,0.08)] bg-[#151517] p-3.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[rgba(236,236,237,0.7)]">Overfitting classification:</span>
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
            <span className="font-mono text-xs text-[rgba(236,236,237,0.55)]">Split {formatDate(trainTestSplit.splitDate)}</span>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-[rgba(236,236,237,0.08)] bg-[#151517] p-4">
              <div className="flex items-center justify-between border-b border-[rgba(236,236,237,0.08)] pb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#a8c7fa]">In-sample (train 70%)</span>
                <span className="text-xs text-[rgba(236,236,237,0.55)]">{trainTestSplit.trainMetrics.tradesCount} trades</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[rgba(236,236,237,0.55)]">CAGR</span>
                  <div className="font-mono text-sm font-semibold text-white">{formatPercent(trainTestSplit.trainMetrics.cagr, { decimals: 2 })}</div>
                </div>
                <div>
                  <span className="text-[rgba(236,236,237,0.55)]">Sharpe</span>
                  <div className="font-mono text-sm font-semibold text-white">{formatNumber(trainTestSplit.trainMetrics.sharpe)}</div>
                </div>
                <div>
                  <span className="text-[rgba(236,236,237,0.55)]">Win rate</span>
                  <div className="font-mono text-sm font-semibold text-white">{formatPercent(trainTestSplit.trainMetrics.winRate, { decimals: 1 })}</div>
                </div>
                <div>
                  <span className="text-[rgba(236,236,237,0.55)]">Max drawdown</span>
                  <div className="font-mono text-sm font-semibold text-rose-300">{formatPercent(Math.abs(trainTestSplit.trainMetrics.maxDrawdown), { decimals: 2 })}</div>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-[rgba(236,236,237,0.08)] bg-[#151517] p-4">
              <div className="flex items-center justify-between border-b border-[rgba(236,236,237,0.08)] pb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#a8c7fa]">Out-of-sample (test 30%)</span>
                <span className="text-xs text-[rgba(236,236,237,0.55)]">{trainTestSplit.testMetrics.tradesCount} trades</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[rgba(236,236,237,0.55)]">CAGR</span>
                  <div className="font-mono text-sm font-semibold text-white">{formatPercent(trainTestSplit.testMetrics.cagr, { decimals: 2 })}</div>
                </div>
                <div>
                  <span className="text-[rgba(236,236,237,0.55)]">Sharpe</span>
                  <div className="font-mono text-sm font-semibold text-white">{formatNumber(trainTestSplit.testMetrics.sharpe)}</div>
                </div>
                <div>
                  <span className="text-[rgba(236,236,237,0.55)]">Win rate</span>
                  <div className="font-mono text-sm font-semibold text-white">{formatPercent(trainTestSplit.testMetrics.winRate, { decimals: 1 })}</div>
                </div>
                <div>
                  <span className="text-[rgba(236,236,237,0.55)]">Max drawdown</span>
                  <div className="font-mono text-sm font-semibold text-rose-300">{formatPercent(Math.abs(trainTestSplit.testMetrics.maxDrawdown), { decimals: 2 })}</div>
                </div>
              </div>
              <p className="text-[11px] text-[rgba(236,236,237,0.5)]">
                CAGR decay {formatNumber(trainTestSplit.cagrDecayRatio, 2)}× from train to test.
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'sensitivity' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[rgba(236,236,237,0.55)]">
            <span>{sensitivityHeatmap.param1Name} (rows) vs {sensitivityHeatmap.param2Name} (columns)</span>
            <span className="font-medium text-[#a8c7fa]">Net return</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-center text-xs">
              <thead>
                <tr>
                  <th className="p-2 text-left font-mono text-[10px] text-[rgba(236,236,237,0.45)]">SL \ TP</th>
                  {sensitivityHeatmap.param2Values.map(tp => (
                    <th key={tp} className="p-2 font-mono font-semibold text-[rgba(236,236,237,0.7)]">{tp}%</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sensitivityHeatmap.matrix.map((row, rowIndex) => {
                  const stopLoss = sensitivityHeatmap.param1Values[rowIndex];
                  return (
                    <tr key={stopLoss} className="border-t border-[rgba(236,236,237,0.06)]">
                      <td className="p-2 text-left font-mono font-semibold text-[rgba(236,236,237,0.55)]">{stopLoss}%</td>
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
                          <td key={columnIndex} className={`m-0.5 rounded p-2.5 font-mono font-semibold ${background}`}>
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

