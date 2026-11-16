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
import { formatDate, formatINR, formatPercent } from '../../shared/format';
import { TrendingUp, ShieldAlert } from 'lucide-react';

interface EquityChartsProps {
  equityCurve: EquityPoint[];
  benchmarkReturnPercent?: number;
  benchmarkLabel?: string;
  trades?: TradeRecord[];
  initialCapital?: number;
  layoutMode?: 'grid' | 'stacked';
}

export const EquityCharts: React.FC<EquityChartsProps> = ({ equityCurve, initialCapital, benchmarkLabel = 'Instrument buy-and-hold', layoutMode = 'stacked' }) => {
  if (!equityCurve || equityCurve.length === 0) return null;

  const firstPoint = equityCurve[0];
  const lastPoint = equityCurve[equityCurve.length - 1];
  const capital = initialCapital ?? firstPoint.equity;
  const totalStrategyReturn = capital > 0 ? formatPercent((lastPoint.equity / capital - 1) * 100, { signed: true }) : 'N/A';
  const totalBenchmarkReturn = capital > 0 ? formatPercent((lastPoint.benchmarkEquity / capital - 1) * 100, { signed: true }) : 'N/A';
  const maxDrawdown = formatPercent(Math.max(...equityCurve.map(point => Math.abs(point.drawdownPercent || 0))), { decimals: 2 });

  return (
    <div className={`grid gap-5 ${layoutMode === 'grid' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
      <div className="space-y-4 rounded-[var(--r-card)] border border-[var(--line)] bg-[var(--surface-1)] p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-2 border-b border-[var(--line)] pb-3 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="st-title font-semibold text-[var(--text-1)]">Portfolio equity vs benchmark</h3>
              <span className="st-meta rounded bg-[var(--surface-2)] px-2 py-0.5 text-[var(--text-2)]">
                {totalStrategyReturn} strategy
              </span>
            </div>
            <p className="st-meta mt-0.5 text-[var(--text-3)]">
              Initial {formatINR(capital)} · final {formatINR(lastPoint.equity)}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 text-[11px] text-[var(--text-3)]">
            <span className="flex items-center gap-1 text-[var(--text-2)]">
              <TrendingUp className="h-3 w-3" /> Strategy
            </span>
            <span className="text-[rgba(236,236,237,0.25)]">·</span>
            <span className="flex items-center gap-1 text-[var(--text-3)]">
              {benchmarkLabel} ({totalBenchmarkReturn})
            </span>
          </div>
        </div>

        <div className="h-64 w-full sm:h-72 lg:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={equityCurve} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(236, 236, 237, 0.05)" />
              <XAxis
                dataKey="date"
                stroke="#6b7280"
                fontSize={10}
                tickFormatter={value => String(value).slice(5)}
                minTickGap={30}
              />
              <YAxis
                stroke="#6b7280"
                fontSize={10}
                tickFormatter={value => `₹${(value / 1000).toFixed(0)}k`}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#151517',
                  borderColor: 'rgba(236, 236, 237, 0.12)',
                  borderRadius: '0.75rem',
                  fontSize: '0.75rem',
                  color: '#ececed',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.7)'
                }}
                labelFormatter={label => formatDate(String(label))}
                formatter={(value: number, name: string) => [
                  formatINR(value),
                  name === 'Strategy Equity' ? 'Strategy equity' : benchmarkLabel
                ]}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
              <Line type="monotone" dataKey="equity" stroke="#a8c7fa" strokeWidth={2.2} dot={false} name="Strategy Equity" />
              <Line type="monotone" dataKey="benchmarkEquity" stroke="#9a9aa3" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name={benchmarkLabel} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="space-y-4 rounded-[var(--r-card)] border border-[var(--line)] bg-[var(--surface-1)] p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-2 border-b border-[var(--line)] pb-3 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-[#ececed] sm:text-base">Drawdown</h3>
              <span className="rounded border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-rose-300 sm:text-xs">
                Max {maxDrawdown}
              </span>
            </div>
            <p className="st-meta mt-0.5 text-[var(--text-3)]">
              Peak-to-trough capital decline during adverse periods
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-rose-300">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>Downside risk</span>
          </div>
        </div>

        <div className="h-60 w-full sm:h-72 lg:h-80">
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
                tickFormatter={value => String(value).slice(5)}
                minTickGap={30}
              />
              <YAxis
                stroke="#6b7280"
                fontSize={10}
                domain={['auto', 0]}
                tickFormatter={value => formatPercent(Number(value), { decimals: 0 })}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#151517',
                  borderColor: 'rgba(236, 236, 237, 0.12)',
                  borderRadius: '0.75rem',
                  fontSize: '0.75rem',
                  color: '#ececed',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.7)'
                }}
                labelFormatter={label => formatDate(String(label))}
                formatter={(value: number) => [formatPercent(Number(value), { decimals: 2 }), 'Drawdown']}
              />
              <Area
                type="monotone"
                dataKey={point => -Math.abs(point.drawdownPercent)}
                stroke="#ff4d4d"
                strokeWidth={1.8}
                fill="url(#drawdownGradient)"
                name="Drawdown"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
