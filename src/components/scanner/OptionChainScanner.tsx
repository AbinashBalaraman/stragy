import React, { useState, useEffect } from 'react';
import { OptionChainData, OptionChainStrike } from '../../shared/strategy/types';
import { NSE_SYMBOLS } from '../../server/data/symbols';
import { Layers, ShieldAlert, ArrowRight, Gauge, RefreshCw, BarChart2, Activity } from 'lucide-react';

interface OptionChainScannerProps {
  onSelectStockAndBacktest: (symbolId: number) => void;
}

export const OptionChainScanner: React.FC<OptionChainScannerProps> = ({ onSelectStockAndBacktest }) => {
  const [selectedTicker, setSelectedTicker] = useState<string>('^NSEI');
  const [data, setData] = useState<OptionChainData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchOptionChain = async (ticker: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/derivatives/option-chain?symbolId=${encodeURIComponent(ticker)}`);
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json && json.success) {
          setData(json);
        }
      }
    } catch (e) {
      console.error('Failed to load option chain:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOptionChain(selectedTicker);
  }, [selectedTicker]);

  const fnoSymbols = NSE_SYMBOLS.filter(s => s.lotSize && s.lotSize > 0);

  return (
    <div className="space-y-4">
      {/* Selector & Key Metrics Header */}
      <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Option Chain & Real-Time Black-Scholes Greeks</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono">
                  SmartAPI NFO Engine
                </span>
              </h3>
              <p className="text-xs text-neutral-400">
                Live Delta (Δ), Gamma (Γ), Theta (Θ), Vega (ν), IV Skews, Put-Call Ratio (PCR), and Max Pain Strike
              </p>
            </div>
          </div>

          {/* Symbol Select Buttons */}
          <div className="flex items-center gap-2">
            <select
              value={selectedTicker}
              onChange={e => setSelectedTicker(e.target.value)}
              className="bg-[#141417] border border-[rgba(236,236,237,0.12)] text-white text-xs font-bold rounded-xl px-3 py-2 outline-none focus:border-cyan-500"
            >
              {fnoSymbols.map(s => (
                <option key={s.ticker} value={s.ticker}>
                  {s.ticker} - {s.name.slice(0, 20)} (₹{s.currentPrice})
                </option>
              ))}
            </select>

            <button
              onClick={() => fetchOptionChain(selectedTicker)}
              disabled={isLoading}
              className="p-2 rounded-xl bg-[#1d1d21] hover:bg-[#27272a] border border-[rgba(236,236,237,0.12)] text-neutral-300 hover:text-white transition-all disabled:opacity-50"
              title="Refresh Option Chain"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Overview Metric Ribbon */}
        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2 border-t border-[rgba(236,236,237,0.08)]">
            <div className="p-3 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl">
              <span className="text-[10px] text-neutral-400 uppercase font-semibold">Underlying Spot LTP</span>
              <div className="text-base font-extrabold text-white font-mono mt-0.5">
                ₹{data.spotPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div className="p-3 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl">
              <span className="text-[10px] text-neutral-400 uppercase font-semibold">ATM Strike</span>
              <div className="text-base font-extrabold text-cyan-400 font-mono mt-0.5">
                {data.atmStrike}
              </div>
            </div>

            <div className="p-3 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl">
              <span className="text-[10px] text-neutral-400 uppercase font-semibold">PCR (Put-Call Ratio)</span>
              <div className={`text-base font-extrabold font-mono mt-0.5 ${data.pcr >= 1.0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {data.pcr} <span className="text-[10px] font-normal text-neutral-400">({data.pcr >= 1 ? 'Bullish Bias' : 'Bearish / Neutral'})</span>
              </div>
            </div>

            <div className="p-3 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl">
              <span className="text-[10px] text-neutral-400 uppercase font-semibold">Max Pain Strike</span>
              <div className="text-base font-extrabold text-amber-400 font-mono mt-0.5">
                {data.maxPainStrike}
              </div>
            </div>

            <div className="p-3 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl">
              <span className="text-[10px] text-neutral-400 uppercase font-semibold">ATM Implied Vol (IV)</span>
              <div className="text-base font-extrabold text-purple-400 font-mono mt-0.5">
                {data.atmIV}%
              </div>
            </div>

            <div className="p-3 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl">
              <span className="text-[10px] text-neutral-400 uppercase font-semibold">Weekly Expiry</span>
              <div className="text-xs font-bold text-neutral-200 mt-1">
                {data.expiry}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Option Chain Table */}
      {data && (
        <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl overflow-hidden shadow-sm">
          <div className="p-3.5 border-b border-[rgba(236,236,237,0.08)] flex flex-wrap items-center justify-between gap-2 bg-[#141417]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">CALLS (CE)</span>
            </div>
            <div className="text-xs font-mono font-bold text-amber-400">
              STRIKE PRICE LADDER
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white uppercase tracking-wider">PUTS (PE)</span>
              <span className="w-2.5 h-2.5 rounded-full bg-purple-400" />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[11px] text-left border-collapse">
              <thead>
                <tr className="bg-[#141417] text-neutral-400 font-semibold border-b border-[rgba(236,236,237,0.08)]">
                  {/* CALLS */}
                  <th className="py-2.5 px-2 text-right">Call OI</th>
                  <th className="py-2.5 px-2 text-right">IV %</th>
                  <th className="py-2.5 px-2 text-right">Delta (Δ)</th>
                  <th className="py-2.5 px-2 text-right">Theta (Θ)</th>
                  <th className="py-2.5 px-2 text-right">Vega (ν)</th>
                  <th className="py-2.5 px-2 text-right text-emerald-400">Call LTP</th>
                  
                  {/* STRIKE */}
                  <th className="py-2.5 px-3 text-center bg-[#161619] font-bold text-amber-300">STRIKE</th>
                  
                  {/* PUTS */}
                  <th className="py-2.5 px-2 text-left text-rose-400">Put LTP</th>
                  <th className="py-2.5 px-2 text-left">Vega (ν)</th>
                  <th className="py-2.5 px-2 text-left">Theta (Θ)</th>
                  <th className="py-2.5 px-2 text-left">Delta (Δ)</th>
                  <th className="py-2.5 px-2 text-left">IV %</th>
                  <th className="py-2.5 px-2 text-left">Put OI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1d1d21]/60 font-mono">
                {data.strikes.map(s => {
                  const isAtm = s.isAtm;
                  const isCallItm = s.strikePrice < data.spotPrice;
                  const isPutItm = s.strikePrice > data.spotPrice;

                  return (
                    <tr
                      key={s.strikePrice}
                      className={`transition-colors ${
                        isAtm
                          ? 'bg-amber-500/10 font-bold border-y border-amber-500/40'
                          : 'hover:bg-[#1d1d21]/40'
                      }`}
                    >
                      {/* CALL DATA */}
                      <td className={`py-2 px-2 text-right ${isCallItm ? 'bg-emerald-950/20 text-emerald-300' : 'text-neutral-300'}`}>
                        {s.call.oi.toLocaleString()}
                      </td>
                      <td className="py-2 px-2 text-right text-purple-300">{s.call.iv}%</td>
                      <td className="py-2 px-2 text-right text-cyan-300">{s.call.delta}</td>
                      <td className="py-2 px-2 text-right text-rose-400">{s.call.theta}</td>
                      <td className="py-2 px-2 text-right text-neutral-400">{s.call.vega}</td>
                      <td className="py-2 px-2 text-right font-extrabold text-emerald-400">
                        ₹{s.call.ltp}
                      </td>

                      {/* STRIKE */}
                      <td className={`py-2 px-3 text-center font-extrabold ${isAtm ? 'bg-amber-500 text-[#0c0c0e]' : 'bg-[#161619] text-white'}`}>
                        {s.strikePrice} {isAtm && <span className="text-[9px] block font-mono">ATM</span>}
                      </td>

                      {/* PUT DATA */}
                      <td className="py-2 px-2 text-left font-extrabold text-rose-400">
                        ₹{s.put.ltp}
                      </td>
                      <td className="py-2 px-2 text-left text-neutral-400">{s.put.vega}</td>
                      <td className="py-2 px-2 text-left text-rose-400">{s.put.theta}</td>
                      <td className="py-2 px-2 text-left text-cyan-300">{s.put.delta}</td>
                      <td className="py-2 px-2 text-left text-purple-300">{s.put.iv}%</td>
                      <td className={`py-2 px-2 text-left ${isPutItm ? 'bg-rose-950/20 text-rose-300' : 'text-neutral-300'}`}>
                        {s.put.oi.toLocaleString()}
                      </td>
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
