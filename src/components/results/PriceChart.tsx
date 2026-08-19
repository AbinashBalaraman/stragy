import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceDot
} from 'recharts';
import { OHLCVBar, TradeRecord, IndicatorConfig, SymbolMeta } from '../../shared/strategy/types';

interface PriceChartProps {
  bars?: OHLCVBar[];
  trades?: TradeRecord[];
  indicators?: IndicatorConfig[];
  indicatorsData?: Record<string, (number | null)[]>;
  symbol?: SymbolMeta;
  ticker?: string;
}

export const PriceChart: React.FC<PriceChartProps> = ({
  bars = [],
  trades = [],
  indicators = [],
  indicatorsData = {},
  symbol,
  ticker
}) => {
  const displayTicker = symbol?.ticker || ticker || 'NSE';
  const safeBars = Array.isArray(bars) ? bars : [];
  const safeTrades = Array.isArray(trades) ? trades : [];
  const safeIndicators = Array.isArray(indicators) ? indicators : [];
  const safeIndData = indicatorsData && typeof indicatorsData === 'object' ? indicatorsData : {};

  const chartData = useMemo(() => {
    return safeBars.map((bar, idx) => {
      const point: Record<string, any> = {
        date: bar?.date || `Bar ${idx + 1}`,
        close: bar?.close ?? 0,
        open: bar?.open ?? 0,
        high: bar?.high ?? 0,
        low: bar?.low ?? 0,
        volume: bar?.volume ?? 0
      };

      // Add indicator data safely
      for (const ind of safeIndicators) {
        if (!ind || !ind.id) continue;
        if (ind.type === 'SUPERTREND') {
          point['supertrend'] = safeIndData[ind.id]?.[idx] ?? null;
        } else if (ind.type === 'EMA' || ind.type === 'SMA') {
          point[ind.id] = safeIndData[ind.id]?.[idx] ?? null;
        } else if (ind.type === 'BBANDS') {
          point[`${ind.id}_upper`] = safeIndData[`${ind.id}_upper`]?.[idx] ?? null;
          point[`${ind.id}_lower`] = safeIndData[`${ind.id}_lower`]?.[idx] ?? null;
        }
      }

      return point;
    });
  }, [safeBars, safeIndicators, safeIndData]);

  const profitableTrades = safeTrades.filter(t => (t?.netPnl ?? 0) > 0).length;

  if (safeBars.length === 0) {
    return (
      <div className="p-8 bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl text-center text-neutral-400 text-xs">
        No price action bars available to display.
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[rgba(236,236,237,0.08)] pb-3.5">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-syne font-bold text-sm sm:text-base text-[#ececed]">Price Action & Execution Map</h3>
          <span className="text-xs text-[#00ffa3] font-mono font-semibold px-2 py-0.5 rounded bg-[rgba(0,255,163,0.1)] border border-[rgba(0,255,163,0.25)]">
            {displayTicker}
          </span>
          <span className="text-[11px] text-[rgba(236,236,237,0.5)] font-mono hidden sm:inline">
            ({safeTrades.length} Signals • {profitableTrades} Profitable)
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-[rgba(236,236,237,0.6)] shrink-0">
          <div className="flex items-center gap-1.5 font-mono">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00ffa3] shadow-sm shadow-[#00ffa3]/50" />
            <span className="text-[#00ffa3] font-semibold">Buy Entry</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff4d4d] shadow-sm shadow-[#ff4d4d]/50" />
            <span className="text-[#ff4d4d] font-semibold">Sell Exit</span>
          </div>
        </div>
      </div>

      <div className="h-64 sm:h-80 md:h-96 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(236, 236, 237, 0.05)" />
            <XAxis
              dataKey="date"
              stroke="#6b7280"
              fontSize={10}
              tickFormatter={val => (typeof val === 'string' && val.length > 5 ? val.slice(5) : val || '')}
              minTickGap={30}
            />
            <YAxis
              stroke="#6b7280"
              fontSize={10}
              domain={['auto', 'auto']}
              tickFormatter={val => `₹${Math.round(val || 0)}`}
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
                typeof val === 'number' ? `₹${val.toFixed(2)}` : val ?? '-',
                (name || '').toUpperCase()
              ]}
            />
            <Line
              type="monotone"
              dataKey="close"
              stroke="#ececed"
              strokeWidth={1.8}
              dot={false}
              name="Close Price"
            />

            {/* Overlays */}
            {safeIndicators.some(i => i?.type === 'SUPERTREND') && (
              <Line
                type="monotone"
                dataKey="supertrend"
                stroke="#00ffa3"
                strokeWidth={1.5}
                strokeDasharray="4 2"
                dot={false}
                name="Supertrend"
              />
            )}

            {/* Trades Entry and Exit Reference Dots */}
            {safeTrades.map(t => (
              t && t.entryDate && t.entryPrice !== undefined ? (
                <ReferenceDot
                  key={`entry_${t.id}`}
                  x={t.entryDate}
                  y={t.entryPrice}
                  r={4.5}
                  fill="#00ffa3"
                  stroke="#0c0c0e"
                  strokeWidth={1.5}
                />
              ) : null
            ))}

            {safeTrades.map(t => (
              t && t.exitDate && t.exitPrice !== undefined ? (
                <ReferenceDot
                  key={`exit_${t.id}`}
                  x={t.exitDate}
                  y={t.exitPrice}
                  r={4.5}
                  fill="#ff4d4d"
                  stroke="#0c0c0e"
                  strokeWidth={1.5}
                />
              ) : null
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
