import React from 'react';
import { useDerivativeRequest } from './useDerivativeRequest';
import { parseBasisSpreads } from './derivativeContracts';
import { RefreshCw, TrendingUpDown } from 'lucide-react';

interface BasisSpreadScannerProps {
  onSelectStockAndBacktest: (symbolId: number) => void;
}

export const BasisSpreadScanner: React.FC<BasisSpreadScannerProps> = () => {
  const { data, isLoading, error, refresh } = useDerivativeRequest('basis', '/api/market/basis-spreads', parseBasisSpreads);
  const spreads = data?.spreads ?? [];

  return (
    <div className="space-y-4">
      <p className="text-xs text-amber-300">Demo/model · Latest-only · Model reference date: 2026-09-30. Not observations or a live feed.</p>
      {isLoading && <p role="status">Loading demo/model…</p>}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {data && data.spreads.map(s => <p key={s.ticker} className="text-xs text-neutral-400">{s.ticker}: {s.provenance.source} · Model as-of {s.provenance.asOf}. {s.provenance.assumptions.join('; ')}</p>)}
      {/* Header */}
      <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <TrendingUpDown className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Demo Cash/Futures Basis & Calendar Spread</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                  Modeled carry, not executable arbitrage
                </span>
              </h3>
              <p className="text-xs text-neutral-400">
                Fictional spot/futures basis. Carry assumes 6.8% annually and 12/40 days to expiry; fees, funding and execution risks are excluded. Yields are not risk-free.
              </p>
            </div>
          </div>

          <button
            onClick={refresh}
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
                      {s.calendarSpreadInr > 0 ? '+' : ''}{s.calendarSpreadInr} ({s.calendarSpreadPct}%)
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
