import React, { useState, useEffect } from 'react';
import { VolumeProfileData } from '../../shared/strategy/types';
import { NSE_SYMBOLS } from '../../server/data/symbols';
import { Activity, BarChart2, TrendingUp, ShieldAlert, RefreshCw, Compass } from 'lucide-react';

interface VolumeProfileScannerProps {
  onSelectStockAndBacktest: (symbolId: number) => void;
}

export const VolumeProfileScanner: React.FC<VolumeProfileScannerProps> = ({ onSelectStockAndBacktest }) => {
  const [selectedSymbolId, setSelectedSymbolId] = useState<number>(4); // Default TCS
  const [data, setData] = useState<VolumeProfileData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchProfile = async (id: number) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/market/volume-profile?symbolId=${id}`);
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json && json.success) {
          setData(json);
        }
      }
    } catch (e) {
      console.error('Failed to load volume profile:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile(selectedSymbolId);
  }, [selectedSymbolId]);

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <BarChart2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Institutional Volume Profile & Microstructure VWAP</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 font-mono">
                  SmartAPI High-Resolution Distribution
                </span>
              </h3>
              <p className="text-xs text-neutral-400">
                Point of Control (POC), 70% Value Area (VAH / VAL), Session VWAP with ±1σ, ±2σ, ±3σ Standard Deviation Bands
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedSymbolId}
              onChange={e => setSelectedSymbolId(Number(e.target.value))}
              className="bg-[#141417] border border-[rgba(236,236,237,0.12)] text-white text-xs font-bold rounded-xl px-3 py-2 outline-none focus:border-purple-500"
            >
              {NSE_SYMBOLS.map(s => (
                <option key={s.id} value={s.id}>
                  {s.ticker} - {s.name.slice(0, 22)} (₹{s.currentPrice})
                </option>
              ))}
            </select>

            <button
              onClick={() => fetchProfile(selectedSymbolId)}
              disabled={isLoading}
              className="p-2 rounded-xl bg-[#1d1d21] hover:bg-[#27272a] border border-[rgba(236,236,237,0.12)] text-neutral-300 hover:text-white transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Profile Metrics Ribbon */}
        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-2 border-t border-[rgba(236,236,237,0.08)]">
            <div className="p-3 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl">
              <span className="text-[10px] text-neutral-400 uppercase font-semibold">Spot Price (LTP)</span>
              <div className="text-base font-extrabold text-white font-mono mt-0.5">
                ₹{data.spotPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div className="p-3 bg-[#141417] border border-amber-500/30 rounded-xl bg-amber-500/5">
              <span className="text-[10px] text-amber-400 uppercase font-semibold">Point of Control (POC)</span>
              <div className="text-base font-extrabold text-amber-400 font-mono mt-0.5">
                ₹{data.pocPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div className="p-3 bg-[#141417] border border-emerald-500/30 rounded-xl bg-emerald-500/5">
              <span className="text-[10px] text-emerald-400 uppercase font-semibold">Value Area High (VAH)</span>
              <div className="text-base font-extrabold text-emerald-400 font-mono mt-0.5">
                ₹{data.vahPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div className="p-3 bg-[#141417] border border-rose-500/30 rounded-xl bg-rose-500/5">
              <span className="text-[10px] text-rose-400 uppercase font-semibold">Value Area Low (VAL)</span>
              <div className="text-base font-extrabold text-rose-400 font-mono mt-0.5">
                ₹{data.valPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div className="p-3 bg-[#141417] border border-cyan-500/30 rounded-xl bg-cyan-500/5">
              <span className="text-[10px] text-cyan-400 uppercase font-semibold">Session VWAP</span>
              <div className="text-base font-extrabold text-cyan-400 font-mono mt-0.5">
                ₹{data.vwap.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Interactive Volume Profile Distribution Histogram & Bands */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Main Visual Profile Canvas (2 Columns) */}
          <div className="lg:col-span-2 bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between pb-2 border-b border-[rgba(236,236,237,0.08)]">
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-purple-400" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Horizontal Volume Node Distribution (70% Value Area)
                </h4>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 font-mono">
                {data.marketRegime}
              </span>
            </div>

            {/* Price Level Volume Bars */}
            <div className="space-y-1 font-mono text-[11px]">
              {[...data.profileLevels].reverse().map(lvl => {
                const isSpotNearby = Math.abs(lvl.price - data.spotPrice) < (data.spotPrice * 0.003);
                return (
                  <div
                    key={lvl.price}
                    className={`flex items-center gap-3 p-1 rounded-lg transition-all ${
                      lvl.isPOC
                        ? 'bg-amber-500/20 border border-amber-500/40 font-bold text-amber-300'
                        : isSpotNearby
                        ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-200'
                        : lvl.inValueArea
                        ? 'bg-[#141417]/70 text-neutral-200'
                        : 'text-neutral-500'
                    }`}
                  >
                    {/* Price Tag */}
                    <div className="w-20 text-right shrink-0 flex items-center justify-end gap-1">
                      {lvl.isPOC && <span className="text-[9px] px-1 bg-amber-500 text-[#0c0c0e] rounded font-bold">POC</span>}
                      {isSpotNearby && <span className="text-[9px] px-1 bg-cyan-500 text-[#0c0c0e] rounded font-bold">LTP</span>}
                      <span>₹{lvl.price.toFixed(1)}</span>
                    </div>

                    {/* Dual Buy/Sell Volume Bar */}
                    <div className="flex-1 bg-[#141417] h-4 rounded overflow-hidden flex border border-[rgba(236,236,237,0.08)]">
                      <div
                        style={{ width: `${(lvl.buyVol / (data.totalSessionVolume * 0.15)) * 100}%` }}
                        className={`h-full ${lvl.inValueArea ? 'bg-emerald-500' : 'bg-emerald-700/60'} transition-all`}
                        title={`Buy Vol: ${lvl.buyVol.toLocaleString()}`}
                      />
                      <div
                        style={{ width: `${(lvl.sellVol / (data.totalSessionVolume * 0.15)) * 100}%` }}
                        className={`h-full ${lvl.inValueArea ? 'bg-rose-500' : 'bg-rose-700/60'} transition-all`}
                        title={`Sell Vol: ${lvl.sellVol.toLocaleString()}`}
                      />
                    </div>

                    {/* Total Vol & % */}
                    <div className="w-24 text-right shrink-0 text-[10px] text-neutral-400">
                      {lvl.totalVol.toLocaleString()} ({lvl.pctOfTotal}%)
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* VWAP Standard Deviation & Microstructure Sidebar (1 Column) */}
          <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
            <div className="pb-2 border-b border-[rgba(236,236,237,0.08)]">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-cyan-400" />
                <span>VWAP Standard Deviation Bands</span>
              </h4>
              <p className="text-[10px] text-neutral-400 mt-0.5">Statistical mean-reversion boundaries</p>
            </div>

            <div className="space-y-2 font-mono text-xs">
              <div className="p-2.5 bg-[#141417] rounded-xl border border-rose-900/40 flex items-center justify-between">
                <span className="text-rose-400 font-bold">+3σ Band (Extreme Resistance)</span>
                <span className="text-white font-extrabold">₹{data.stdDev3Upper}</span>
              </div>

              <div className="p-2.5 bg-[#141417] rounded-xl border border-rose-900/20 flex items-center justify-between">
                <span className="text-rose-300 font-semibold">+2σ Band (Institutional Exhaustion)</span>
                <span className="text-white font-extrabold">₹{data.stdDev2Upper}</span>
              </div>

              <div className="p-2.5 bg-[#141417] rounded-xl border border-rose-800/20 flex items-center justify-between">
                <span className="text-rose-200/80">+1σ Band (Expansion Zone)</span>
                <span className="text-white font-bold">₹{data.stdDev1Upper}</span>
              </div>

              <div className="p-3 bg-cyan-950/30 rounded-xl border border-cyan-500/40 flex items-center justify-between font-bold">
                <span className="text-cyan-300 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-cyan-400" />
                  VWAP Baseline
                </span>
                <span className="text-cyan-200 text-sm font-extrabold">₹{data.vwap}</span>
              </div>

              <div className="p-2.5 bg-[#141417] rounded-xl border border-emerald-800/20 flex items-center justify-between">
                <span className="text-emerald-200/80">-1σ Band (Pullback Value)</span>
                <span className="text-white font-bold">₹{data.stdDev1Lower}</span>
              </div>

              <div className="p-2.5 bg-[#141417] rounded-xl border border-emerald-900/20 flex items-center justify-between">
                <span className="text-emerald-300 font-semibold">-2σ Band (Discount Zone)</span>
                <span className="text-white font-extrabold">₹{data.stdDev2Lower}</span>
              </div>

              <div className="p-2.5 bg-[#141417] rounded-xl border border-emerald-900/40 flex items-center justify-between">
                <span className="text-emerald-400 font-bold">-3σ Band (Extreme Oversold)</span>
                <span className="text-white font-extrabold">₹{data.stdDev3Lower}</span>
              </div>
            </div>

            <div className="p-3 bg-[#141417] rounded-xl border border-[rgba(236,236,237,0.08)] text-xs space-y-1.5">
              <span className="text-[10px] text-neutral-400 uppercase font-semibold">Buyer vs Seller Absorption</span>
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-emerald-400">Buyers {data.buyPressurePct}%</span>
                <span className="text-rose-400">Sellers {(100 - data.buyPressurePct).toFixed(1)}%</span>
              </div>
              <div className="w-full bg-[#1d1d21] h-2 rounded-full overflow-hidden flex">
                <div style={{ width: `${data.buyPressurePct}%` }} className="h-full bg-emerald-500" />
                <div style={{ width: `${100 - data.buyPressurePct}%` }} className="h-full bg-rose-500" />
              </div>
            </div>

            <button
              onClick={() => onSelectStockAndBacktest(selectedSymbolId)}
              className="w-full py-2.5 rounded-xl bg-purple-500 hover:bg-purple-400 text-[#0c0c0e] font-bold text-xs shadow-md shadow-purple-500/20 transition-all flex items-center justify-center gap-1.5"
            >
              <span>Backtest Strategy on {data.ticker}</span>
              <TrendingUp className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
