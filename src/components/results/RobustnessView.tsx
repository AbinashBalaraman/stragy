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
import { ShieldCheck, Dice5, SplitSquareVertical, Grid3X3 } from 'lucide-react';

interface RobustnessViewProps {
  robustness?: RobustnessSuite;
  result?: BacktestResponse;
  onRunNewSimulation?: () => void;
}

export const RobustnessView: React.FC<RobustnessViewProps> = ({ robustness, result, onRunNewSimulation }) => {
  const [activeTab, setActiveTab] = useState<'monteCarlo' | 'trainTest' | 'sensitivity'>('monteCarlo');
  const suite = robustness || result?.robustness;

  if (!suite) {
    return (
      <div className="p-8 bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl text-center text-neutral-400 text-xs">
        No robustness data available.
      </div>
    );
  }

  const { monteCarlo, trainTestSplit, sensitivityHeatmap } = suite;

  // Prepare Monte Carlo percentile points
  const mcChartData = monteCarlo.percentileCurves.p50.map((_, idx) => ({
    step: `Step ${idx}`,
    p10: monteCarlo.percentileCurves.p10[idx],
    p25: monteCarlo.percentileCurves.p25[idx],
    p50: monteCarlo.percentileCurves.p50[idx],
    p75: monteCarlo.percentileCurves.p75[idx],
    p90: monteCarlo.percentileCurves.p90[idx]
  }));

  return (
    <div className="p-4 sm:p-6 bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl space-y-4">
      {/* Tab Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(236,236,237,0.08)] pb-3.5">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-5 h-5 text-[#00ffa3]" />
          <div>
            <h3 className="font-syne font-bold text-sm text-[#ececed]">Institutional Robustness & Overfitting Suite</h3>
            <p className="text-[11px] text-[rgba(236,236,237,0.5)]">Monte Carlo (500 Runs), 70/30 OOS Validation & Parameter Sensitivity</p>
          </div>
        </div>

        <div className="flex items-center bg-[#1d1d21] p-1 rounded-xl border border-[rgba(236,236,237,0.08)]">
          <button
            type="button"
            onClick={() => setActiveTab('monteCarlo')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'monteCarlo' ? 'bg-[#00ffa3] text-[#0c0c0e] font-bold shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Dice5 className="w-3.5 h-3.5" />
            <span>Monte Carlo (500)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('trainTest')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'trainTest' ? 'bg-[#00ffa3] text-[#0c0c0e] font-bold shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <SplitSquareVertical className="w-3.5 h-3.5" />
            <span>70/30 Train/Test</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sensitivity')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'sensitivity' ? 'bg-[#00ffa3] text-[#0c0c0e] font-bold shadow-sm' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Grid3X3 className="w-3.5 h-3.5" />
            <span>Sensitivity Grid</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Monte Carlo Simulation */}
      {activeTab === 'monteCarlo' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-[#141417] rounded-xl border border-[rgba(236,236,237,0.08)]">
              <span className="text-neutral-400 block mb-1">P10 Conservative Equity</span>
              <span className="text-rose-400 font-mono font-bold text-sm">
                ₹{monteCarlo.p10TerminalEquity.toLocaleString('en-IN')}
              </span>
            </div>
            <div className="p-3 bg-[#141417] rounded-xl border border-[rgba(236,236,237,0.08)]">
              <span className="text-neutral-400 block mb-1">P50 Median Equity</span>
              <span className="text-[#00ffa3] font-mono font-bold text-sm">
                ₹{monteCarlo.p50TerminalEquity.toLocaleString('en-IN')}
              </span>
            </div>
            <div className="p-3 bg-[#141417] rounded-xl border border-[rgba(236,236,237,0.08)]">
              <span className="text-neutral-400 block mb-1">P90 Optimistic Equity</span>
              <span className="text-[#00ffa3] font-mono font-bold text-sm">
                ₹{monteCarlo.p90TerminalEquity.toLocaleString('en-IN')}
              </span>
            </div>
            <div className="p-3 bg-[#141417] rounded-xl border border-[rgba(236,236,237,0.08)]">
              <span className="text-neutral-400 block mb-1">Prob of Drawdown &gt; 15%</span>
              <span
                className={`font-mono font-bold text-sm ${
                  monteCarlo.probDrawdownOver15 > 30 ? 'text-rose-400' : 'text-[#00ffa3]'
                }`}
              >
                {monteCarlo.probDrawdownOver15}%
              </span>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mcChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(236, 236, 237, 0.05)" />
                <XAxis dataKey="step" stroke="#6b7280" fontSize={10} minTickGap={30} />
                <YAxis stroke="#6b7280" fontSize={10} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#141417',
                    borderColor: 'rgba(236, 236, 237, 0.12)',
                    borderRadius: '0.75rem',
                    fontSize: '0.75rem',
                    color: '#ececed'
                  }}
                  formatter={(val: any) => [`₹${Number(val).toLocaleString('en-IN')}`]}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Line type="monotone" dataKey="p90" stroke="#00ffa3" strokeWidth={1.5} dot={false} name="90th Percentile (Bullish)" />
                <Line type="monotone" dataKey="p50" stroke="#ececed" strokeWidth={2} dot={false} name="50th Percentile (Median)" />
                <Line type="monotone" dataKey="p10" stroke="#ff4d4d" strokeWidth={1.5} dot={false} name="10th Percentile (Worst Case)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Tab 2: 70/30 Train/Test Split */}
      {activeTab === 'trainTest' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3.5 bg-[#141417] rounded-xl border border-[rgba(236,236,237,0.08)]">
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-300 font-semibold">Overfitting Risk Diagnosis:</span>
              <span
                className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                  trainTestSplit.overfittingRisk === 'LOW'
                    ? 'bg-[#00ffa3]/10 text-[#00ffa3] border-[#00ffa3]/30'
                    : trainTestSplit.overfittingRisk === 'MODERATE'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                }`}
              >
                {trainTestSplit.overfittingRisk} OVERFITTING RISK
              </span>
            </div>
            <span className="text-xs text-neutral-400 font-mono">Split Date: {trainTestSplit.splitDate}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* In-Sample (70%) */}
            <div className="p-4 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl space-y-3">
              <div className="flex items-center justify-between border-b border-[rgba(236,236,237,0.08)] pb-2">
                <span className="text-xs font-bold text-[#00ffa3] uppercase tracking-wider">
                  In-Sample (Train 70%)
                </span>
                <span className="text-xs text-neutral-400">{trainTestSplit.trainMetrics.tradesCount} Trades</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-neutral-400">CAGR:</span>
                  <div className="font-mono font-bold text-white text-sm">{trainTestSplit.trainMetrics.cagr}%</div>
                </div>
                <div>
                  <span className="text-neutral-400">Sharpe Ratio:</span>
                  <div className="font-mono font-bold text-white text-sm">{trainTestSplit.trainMetrics.sharpe}</div>
                </div>
                <div>
                  <span className="text-neutral-400">Win Rate:</span>
                  <div className="font-mono font-bold text-white text-sm">{trainTestSplit.trainMetrics.winRate}%</div>
                </div>
                <div>
                  <span className="text-neutral-400">Max Drawdown:</span>
                  <div className="font-mono font-bold text-rose-400 text-sm">{trainTestSplit.trainMetrics.maxDrawdown}%</div>
                </div>
              </div>
            </div>

            {/* Out-of-Sample (30%) */}
            <div className="p-4 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl space-y-3">
              <div className="flex items-center justify-between border-b border-[rgba(236,236,237,0.08)] pb-2">
                <span className="text-xs font-bold text-[#00ffa3] uppercase tracking-wider">
                  Out-of-Sample (Test 30%)
                </span>
                <span className="text-xs text-neutral-400">{trainTestSplit.testMetrics.tradesCount} Trades</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-neutral-400">CAGR (Decay {trainTestSplit.cagrDecayRatio}x):</span>
                  <div className="font-mono font-bold text-white text-sm">{trainTestSplit.testMetrics.cagr}%</div>
                </div>
                <div>
                  <span className="text-neutral-400">Sharpe Ratio:</span>
                  <div className="font-mono font-bold text-white text-sm">{trainTestSplit.testMetrics.sharpe}</div>
                </div>
                <div>
                  <span className="text-neutral-400">Win Rate:</span>
                  <div className="font-mono font-bold text-white text-sm">{trainTestSplit.testMetrics.winRate}%</div>
                </div>
                <div>
                  <span className="text-neutral-400">Max Drawdown:</span>
                  <div className="font-mono font-bold text-rose-400 text-sm">{trainTestSplit.testMetrics.maxDrawdown}%</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Parameter Sensitivity Heatmap */}
      {activeTab === 'sensitivity' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>2D Grid: {sensitivityHeatmap.param1Name} (Rows) vs {sensitivityHeatmap.param2Name} (Columns)</span>
            <span className="text-[#00ffa3] font-semibold">Metric: Sharpe Ratio</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-center border-collapse">
              <thead>
                <tr>
                  <th className="p-2 text-neutral-500 font-mono text-[10px] text-left">SL \ TP</th>
                  {sensitivityHeatmap.param2Values.map(tp => (
                    <th key={tp} className="p-2 font-mono text-neutral-300 font-semibold">
                      {tp}%
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sensitivityHeatmap.matrix.map((row, rIdx) => {
                  const sl = sensitivityHeatmap.param1Values[rIdx];
                  return (
                    <tr key={sl} className="border-t border-[rgba(236,236,237,0.06)]">
                      <td className="p-2 font-mono text-neutral-400 font-semibold text-left">{sl}%</td>
                      {row.map((cell, cIdx) => {
                        const val = cell.metricValue;
                        const bgColor =
                          val >= 1.5
                            ? 'bg-[#00ffa3]/30 text-[#00ffa3]'
                            : val >= 1.0
                            ? 'bg-[#00ffa3]/15 text-[#00ffa3]'
                            : val >= 0.5
                            ? 'bg-[#00ffa3]/10 text-neutral-200'
                            : val >= 0
                            ? 'bg-[#1d1d21] text-neutral-300'
                            : 'bg-rose-500/20 text-rose-300';

                        return (
                          <td key={cIdx} className={`p-2.5 font-mono font-bold rounded m-0.5 ${bgColor}`}>
                            {val}
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
