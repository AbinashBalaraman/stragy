import React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from 'recharts';
import { EquityPoint, TradeRecord } from '../../shared/strategy/types';
import { TrendingUp, ShieldAlert } from 'lucide-react';

interface EquityChartsProps {
  equityCurve: EquityPoint[];
  benchmarkReturnPercent?: number;
  trades?: TradeRecord[];
  initialCapital?: number;
  layoutMode?: 'grid' | 'stacked';
}

export const EquityCharts: React.FC<EquityChartsProps> = ({ equityCurve, layoutMode = 'stacked' }) => {
  if (!equityCurve || equityCurve.length === 0) return null;

  const firstPoint = equityCurve[0];
  const lastPoint = equityCurve[equityCurve.length - 1];
  const totalStrategyReturn = firstPoint && lastPoint
    ? (((lastPoint.equity - firstPoint.equity) / firstPoint.equity) * 100).toFixed(1)
    : '0';
  const totalBenchmarkReturn = firstPoint && lastPoint
    ? (((lastPoint.benchmarkEquity - firstPoint.benchmarkEquity) / firstPoint.benchmarkEquity) * 100).toFixed(1)
    : '0';

  const maxDrawdown = Math.max(...equityCurve.map(p => Math.abs(p.drawdownPercent || 0))).toFixed(1);

  return (
    <div className={`grid gap-5 ${layoutMode === 'grid' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
      {/* 1. Equity Curve vs Benchmark */}
      <div className="p-4 sm:p-6 bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[rgba(236,236,237,0.08)] pb-3.5">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-syne font-bold text-sm sm:text-base text-[#ececed]">Portfolio Equity vs Benchmark</h3>
              <span className="text-[10px] sm:text-xs font-mono font-semibold px-2 py-0.5 rounded bg-[rgba(0,255,163,0.1)] text-[#00ffa3] border border-[rgba(0,255,163,0.25)]">
                +{totalStrategyReturn}% Strategy
              </span>
            </div>
            <p className="text-[11px] text-[rgba(236,236,237,0.5)] mt-0.5">
              Initial Capital: ₹1,00,000 • Final: ₹{lastPoint?.equity?.toLocaleString('en-IN') || '1,00,000'}
            </p>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-[rgba(236,236,237,0.5)] shrink-0">
            <span className="flex items-center gap-1 font-mono text-[#00ffa3]">
              <TrendingUp className="w-3 h-3" /> Strategy
            </span>
            <span className="text-neutral-600">•</span>
            <span className="flex items-center gap-1 font-mono text-neutral-400">
              NIFTY (+{totalBenchmarkReturn}%)
            </span>
          </div>
        </div>

        <div className="h-64 sm:h-72 lg:h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={equityCurve} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(236, 236, 237, 0.05)" />
              <XAxis
                dataKey="date"
                stroke="#6b7280"
                fontSize={10}
                tickFormatter={val => val.slice(5)}
                minTickGap={30}
              />
              <YAxis
                stroke="#6b7280"
                fontSize={10}
                tickFormatter={val => `₹${(val / 1000).toFixed(0)}k`}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#141417',
                  borderColor: 'rgba(236, 236, 237, 0.12)',
                  borderRadius: '0.75rem',
                  fontSize: '0.75rem',
                  color: '#ececed',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.7)'
                }}
                formatter={(val: any, name: string) => [
                  `₹${Number(val).toLocaleString('en-IN')}`,
                  name === 'equity' ? 'Strategy Equity' : 'NIFTY 50 Benchmark'
                ]}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
              <Line
                type="monotone"
                dataKey="equity"
                stroke="#00ffa3"
                strokeWidth={2.2}
                dot={false}
                name="Strategy Equity"
              />
              <Line
                type="monotone"
                dataKey="benchmarkEquity"
                stroke="#64748b"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                name="Benchmark (Buy & Hold)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 2. Underwater Drawdown Curve */}
      <div className="p-4 sm:p-6 bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[rgba(236,236,237,0.08)] pb-3.5">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-syne font-bold text-sm sm:text-base text-[#ececed]">Underwater Drawdown Decay</h3>
              <span className="text-[10px] sm:text-xs font-mono font-semibold px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                Max DD: -{maxDrawdown}%
              </span>
            </div>
            <p className="text-[11px] text-[rgba(236,236,237,0.5)] mt-0.5">
              Historical peak-to-trough capital decline profile during adverse regimes
            </p>
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono text-rose-400 shrink-0">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Downside Risk Exposure</span>
          </div>
        </div>

        <div className="h-60 sm:h-72 lg:h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={equityCurve} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
              <defs>
                <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ff4d4d" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="#ff4d4d" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(236, 236, 237, 0.05)" />
              <XAxis
                dataKey="date"
                stroke="#6b7280"
                fontSize={10}
                tickFormatter={val => val.slice(5)}
                minTickGap={30}
              />
              <YAxis
                stroke="#6b7280"
                fontSize={10}
                domain={['auto', 0]}
                tickFormatter={val => `${val}%`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#141417',
                  borderColor: 'rgba(236, 236, 237, 0.12)',
                  borderRadius: '0.75rem',
                  fontSize: '0.75rem',
                  color: '#ececed',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.7)'
                }}
                formatter={(val: any) => [`${val}%`, 'Drawdown']}
              />
              <Area
                type="monotone"
                dataKey={d => -Math.abs(d.drawdownPercent)}
                stroke="#ff4d4d"
                strokeWidth={1.8}
                fill="url(#drawdownGradient)"
                name="Drawdown %"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
