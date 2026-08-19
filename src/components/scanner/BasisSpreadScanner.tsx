import React, { useState, useEffect } from 'react';
import { BasisSpreadItem } from '../../server/data/smartApi';
import { RefreshCw, TrendingUpDown, ArrowRight, Activity, Percent, ShieldCheck } from 'lucide-react';

interface BasisSpreadScannerProps {
  onSelectStockAndBacktest: (symbolId: number) => void;
}

export const BasisSpreadScanner: React.FC<BasisSpreadScannerProps> = ({ onSelectStockAndBacktest }) => {
  const [spreads, setSpreads] = useState<BasisSpreadItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchSpreads = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/market/basis-spreads');
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.success && Array.isArray(data.spreads)) {
          setSpreads(data.spreads);
        }
      }
    } catch (e) {
      console.error('Failed to load basis spreads:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSpreads();
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <TrendingUpDown className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Cash vs. Futures Basis & Calendar Spread Arbitrage</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                  Multi-Month Rollover Yields
                </span>
              </h3>
              <p className="text-xs text-neutral-400">
                Track spot vs near/next-month futures basis, contango/backwardation mispricings, and annualized risk-free cash-and-carry yields
              </p>
            </div>
          </div>

          <button
            onClick={fetchSpreads}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1d1d21] hover:bg-[#27272a] text-white font-semibold text-xs rounded-xl border border-[rgba(236,236,237,0.12)] shadow-sm active:scale-95 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh Spreads</span>
          </button>
        </div>
      </div>

      {/* Spreads Table */}
      <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-[#141417] text-neutral-400 font-semibold border-b border-[rgba(236,236,237,0.08)] text-[11px]">
                <th className="py-3 px-3">Symbol & Sector</th>
                <th className="py-3 px-2 text-right">Cash Spot</th>
                <th className="py-3 px-2 text-right">Near Fut</th>
                <th className="py-3 px-2 text-right">Next Fut</th>
                <th className="py-3 px-2 text-right">Near Basis (₹ / %)</th>
                <th className="py-3 px-2 text-right">Calendar Spread</th>
                <th className="py-3 px-2 text-right text-emerald-400">Annualized Yield</th>
                <th className="py-3 px-2 text-center">Regime</th>
                <th className="py-3 px-3 text-left">Arbitrage Signal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1d1d21]/60 font-mono text-[11px]">
              {spreads.map(s => {
                const isContango = s.state === 'CONTANGO';
                return (
                  <tr key={s.ticker} className="hover:bg-[#1d1d21]/30 transition-colors">
                    <td className="py-2.5 px-3">
                      <span className="font-extrabold text-sm text-white">{s.ticker}</span>
                      <span className="text-[10px] text-neutral-400 block font-sans truncate">{s.name} (Lot: {s.lotSize})</span>
                    </td>
                    <td className="py-2.5 px-2 text-right font-extrabold text-white">
                      ₹{s.cashLtp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5 px-2 text-right text-neutral-300">
                      ₹{s.nearFutLtp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5 px-2 text-right text-neutral-400">
                      ₹{s.nextFutLtp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className={`py-2.5 px-2 text-right font-bold ${isContango ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isContango ? '+' : ''}{s.nearBasisInr} ({s.nearBasisPct}%)
                    </td>
                    <td className="py-2.5 px-2 text-right text-cyan-300">
                      +{s.calendarSpreadInr} ({s.calendarSpreadPct}%)
                    </td>
                    <td className="py-2.5 px-2 text-right font-extrabold text-emerald-400">
                      {s.annualizedYieldPct}% p.a.
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${isContango ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                        {s.state}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-left font-sans text-xs">
                      <span className="text-neutral-300 font-semibold">{s.arbitrageSignal}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
