import React, { useState, useEffect } from 'react';
import { GttBracketConfig } from '../../server/data/smartApi';
import { NSE_SYMBOLS } from '../../server/data/symbols';
import { ShieldAlert, Zap, Copy, Check, ArrowRight, RefreshCw, Calculator, Flame } from 'lucide-react';

interface GttBracketCalculatorProps {
  onSelectStockAndBacktest: (symbolId: number) => void;
}

export const GttBracketCalculator: React.FC<GttBracketCalculatorProps> = ({ onSelectStockAndBacktest }) => {
  const [selectedSymbolId, setSelectedSymbolId] = useState<number>(4); // TCS
  const [action, setAction] = useState<'BUY' | 'SELL'>('BUY');
  const [capitalAllocated, setCapitalAllocated] = useState<number>(100000);
  const [riskPct, setRiskPct] = useState<number>(1.5);
  const [rewardRatio, setRewardRatio] = useState<number>(2.5);
  const [trailPct, setTrailPct] = useState<number>(0.5);

  const [orderConfig, setOrderConfig] = useState<GttBracketConfig | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const calculateOrder = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/orders/gtt-bracket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbolId: selectedSymbolId,
          action,
          capitalAllocated,
          riskPct,
          rewardRatio,
          trailPct
        })
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.success) {
          setOrderConfig(data);
        }
      }
    } catch (e) {
      console.error('Failed to calculate bracket order:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    calculateOrder();
  }, [selectedSymbolId, action, capitalAllocated, riskPct, rewardRatio, trailPct]);

  const copyPayload = () => {
    if (!orderConfig) return;
    navigator.clipboard.writeText(JSON.stringify(orderConfig.smartApiPayload, null, 2));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Configuration Header Card */}
      <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Automated GTT Bracket & Dynamic Trailing Stop-Loss Engine</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
                  Angel One SmartAPI ROBO Payload
                </span>
              </h3>
              <p className="text-xs text-neutral-400">
                Precision entry, multi-leg OCO bracket risk containment, dynamic trailing profit lock, and ready API dispatch
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setAction('BUY')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all ${
                action === 'BUY'
                  ? 'bg-emerald-500 text-[#0c0c0e] shadow-md shadow-emerald-500/20'
                  : 'bg-[#141417] text-neutral-400 border border-[rgba(236,236,237,0.08)]'
              }`}
            >
              LONG / BUY
            </button>
            <button
              onClick={() => setAction('SELL')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all ${
                action === 'SELL'
                  ? 'bg-rose-500 text-[#0c0c0e] shadow-md shadow-rose-500/20'
                  : 'bg-[#141417] text-neutral-400 border border-[rgba(236,236,237,0.08)]'
              }`}
            >
              SHORT / SELL
            </button>
          </div>
        </div>

        {/* Input Parameters Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2 border-t border-[rgba(236,236,237,0.08)]">
          <div>
            <label className="text-[10px] text-neutral-400 uppercase font-semibold block mb-1">Target Stock</label>
            <select
              value={selectedSymbolId}
              onChange={e => setSelectedSymbolId(Number(e.target.value))}
              className="w-full bg-[#141417] border border-[rgba(236,236,237,0.12)] text-white text-xs font-bold rounded-xl px-3 py-2 outline-none focus:border-amber-500"
            >
              {NSE_SYMBOLS.map(s => (
                <option key={s.id} value={s.id}>
                  {s.ticker} - ₹{s.currentPrice}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] text-neutral-400 uppercase font-semibold block mb-1">Capital Allocated (₹)</label>
            <input
              type="number"
              value={capitalAllocated}
              onChange={e => setCapitalAllocated(Number(e.target.value))}
              step={10000}
              className="w-full bg-[#141417] border border-[rgba(236,236,237,0.12)] text-white font-mono text-xs font-bold rounded-xl px-3 py-2 outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="text-[10px] text-neutral-400 uppercase font-semibold block mb-1">Stop-Loss Risk ({riskPct}%)</label>
            <input
              type="range"
              min={0.5}
              max={5.0}
              step={0.1}
              value={riskPct}
              onChange={e => setRiskPct(Number(e.target.value))}
              className="w-full accent-amber-500"
            />
          </div>

          <div>
            <label className="text-[10px] text-neutral-400 uppercase font-semibold block mb-1">Risk:Reward (1 : {rewardRatio})</label>
            <input
              type="range"
              min={1.0}
              max={5.0}
              step={0.25}
              value={rewardRatio}
              onChange={e => setRewardRatio(Number(e.target.value))}
              className="w-full accent-emerald-500"
            />
          </div>

          <div>
            <label className="text-[10px] text-neutral-400 uppercase font-semibold block mb-1">Trailing Step Jump ({trailPct}%)</label>
            <input
              type="range"
              min={0.2}
              max={2.0}
              step={0.1}
              value={trailPct}
              onChange={e => setTrailPct(Number(e.target.value))}
              className="w-full accent-cyan-500"
            />
          </div>
        </div>
      </div>

      {/* Computed Order Execution Specs */}
      {orderConfig && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Order Metrics Card */}
          <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between pb-2 border-b border-[rgba(236,236,237,0.08)]">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Calculator className="w-4 h-4 text-amber-400" />
                <span>Calculated Risk-Reward Matrix</span>
              </h4>
              <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${action === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                {action} {orderConfig.qty} SHARES
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono">
              <div className="p-3 bg-[#141417] rounded-xl border border-[rgba(236,236,237,0.08)]">
                <span className="text-[10px] text-neutral-400 uppercase font-semibold">Entry LTP</span>
                <div className="text-sm font-extrabold text-white mt-0.5">₹{orderConfig.entryPrice}</div>
              </div>

              <div className="p-3 bg-[#141417] rounded-xl border border-rose-500/30 bg-rose-500/5">
                <span className="text-[10px] text-rose-400 uppercase font-semibold">Stop-Loss Limit</span>
                <div className="text-sm font-extrabold text-rose-400 mt-0.5">₹{orderConfig.stopLossPrice}</div>
                <span className="text-[9px] text-neutral-400">(-{orderConfig.stopLossPct}%)</span>
              </div>

              <div className="p-3 bg-[#141417] rounded-xl border border-emerald-500/30 bg-emerald-500/5">
                <span className="text-[10px] text-emerald-400 uppercase font-semibold">Target Take-Profit</span>
                <div className="text-sm font-extrabold text-emerald-400 mt-0.5">₹{orderConfig.targetPrice}</div>
                <span className="text-[9px] text-neutral-400">(+{orderConfig.targetPct}%)</span>
              </div>

              <div className="p-3 bg-[#141417] rounded-xl border border-[rgba(236,236,237,0.08)]">
                <span className="text-[10px] text-neutral-400 uppercase font-semibold">Max Downside Loss</span>
                <div className="text-sm font-extrabold text-rose-400 mt-0.5">₹{orderConfig.stopLossAmountInr.toLocaleString()}</div>
              </div>

              <div className="p-3 bg-[#141417] rounded-xl border border-[rgba(236,236,237,0.08)]">
                <span className="text-[10px] text-neutral-400 uppercase font-semibold">Expected Upside Gain</span>
                <div className="text-sm font-extrabold text-emerald-400 mt-0.5">₹{orderConfig.targetAmountInr.toLocaleString()}</div>
              </div>

              <div className="p-3 bg-[#141417] rounded-xl border border-cyan-500/30 bg-cyan-500/5">
                <span className="text-[10px] text-cyan-400 uppercase font-semibold">Trailing SL Step</span>
                <div className="text-sm font-extrabold text-cyan-400 mt-0.5">₹{orderConfig.trailingStopLossStep}</div>
                <span className="text-[9px] text-neutral-400">({orderConfig.trailingJumpPct}% increment)</span>
              </div>
            </div>

            <div className="p-3 bg-[#141417] rounded-xl border border-[rgba(236,236,237,0.08)] text-xs space-y-1">
              <span className="text-[10px] text-neutral-400 font-semibold uppercase">Smart Trailing Mechanism</span>
              <p className="text-[11px] text-neutral-300">
                When {orderConfig.ticker} advances by <span className="text-emerald-400 font-bold">₹{orderConfig.trailingStopLossStep}</span>, Angel One&apos;s matching engine automatically shifts your Stop-Loss upward by <span className="text-cyan-400 font-bold">₹{orderConfig.trailingStopLossStep}</span>, locking in guaranteed profits while keeping risk strictly capped at <span className="text-rose-400 font-bold">₹{orderConfig.stopLossAmountInr}</span>.
              </p>
            </div>
          </div>

          {/* Angel One SmartAPI JSON Payload Output */}
          <div className="bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl p-4 sm:p-5 space-y-3 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-[rgba(236,236,237,0.08)]">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Flame className="w-4 h-4 text-cyan-400" />
                  <span>SmartAPI Order JSON Specification</span>
                </h4>
                <button
                  onClick={copyPayload}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#1d1d21] hover:bg-[#27272a] text-xs font-semibold text-white border border-[rgba(236,236,237,0.12)] transition-all"
                >
                  {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{isCopied ? 'Copied!' : 'Copy JSON'}</span>
                </button>
              </div>

              <div className="mt-2 p-3 bg-[#141417] rounded-xl border border-[rgba(236,236,237,0.08)] font-mono text-[10px] text-cyan-300 max-h-56 overflow-y-auto">
                <pre>{JSON.stringify(orderConfig.smartApiPayload, null, 2)}</pre>
              </div>
            </div>

            <button
              onClick={() => onSelectStockAndBacktest(selectedSymbolId)}
              className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0c0c0e] font-bold text-xs shadow-md shadow-amber-500/20 transition-all flex items-center justify-center gap-1.5"
            >
              <span>Backtest Strategy on {orderConfig.ticker}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
