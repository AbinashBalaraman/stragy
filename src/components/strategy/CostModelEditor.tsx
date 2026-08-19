import React from 'react';
import { Receipt, Landmark, Zap, ShieldCheck } from 'lucide-react';
import { CostModelConfig } from '../../shared/strategy/types';
import { FinanceTooltip } from '../common/Tooltip';

interface CostModelEditorProps {
  costs: CostModelConfig;
  onChange: (costs: CostModelConfig) => void;
}

export const CostModelEditor: React.FC<CostModelEditorProps> = ({ costs, onChange }) => {
  return (
    <div className="space-y-4">
      {/* Trade Type Switcher */}
      <div className="p-4 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Landmark className="w-4 h-4 text-[#00ffa3]" />
            <span className="text-xs font-mono font-bold text-[#ececed] uppercase tracking-wider">INDIAN STATUTORY COST & TAX MODEL</span>
          </div>

          <div className="flex items-center bg-[#0c0c0e] p-1 rounded-lg border border-[rgba(236,236,237,0.08)]">
            <button
              type="button"
              onClick={() => onChange({ ...costs, tradeType: 'DELIVERY' })}
              className={`px-3 py-1 text-xs font-mono font-semibold rounded-md transition-all ${
                costs.tradeType === 'DELIVERY'
                  ? 'bg-[#00ffa3] text-[#0c0c0e] shadow-sm'
                  : 'text-neutral-400 hover:text-[#ececed]'
              }`}
            >
              DELIVERY (POSITIONAL)
            </button>
            <button
              type="button"
              onClick={() => onChange({ ...costs, tradeType: 'INTRADAY' })}
              className={`px-3 py-1 text-xs font-mono font-semibold rounded-md transition-all ${
                costs.tradeType === 'INTRADAY'
                  ? 'bg-[#00ffa3] text-[#0c0c0e] shadow-sm'
                  : 'text-neutral-400 hover:text-[#ececed]'
              }`}
            >
              INTRADAY (MIS)
            </button>
          </div>
        </div>

        {/* Regulatory Tax Schedule Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
          <div className="p-2.5 bg-[#0c0c0e] rounded-lg border border-[rgba(236,236,237,0.08)]">
            <div className="text-neutral-400 text-[10px] flex items-center justify-between uppercase">
              <span>STT (Securities Tax)</span>
              <FinanceTooltip content={costs.tradeType === 'DELIVERY' ? '0.1% on Buy & Sell turnover for equity delivery.' : '0.025% on Sell turnover only for intraday equity.'} />
            </div>
            <div className="text-[#00ffa3] font-mono font-bold mt-1 text-[11px]">
              {costs.tradeType === 'DELIVERY' ? '0.1% (Buy & Sell)' : '0.025% (Sell Only)'}
            </div>
          </div>

          <div className="p-2.5 bg-[#0c0c0e] rounded-lg border border-[rgba(236,236,237,0.08)]">
            <div className="text-neutral-400 text-[10px] flex items-center justify-between uppercase">
              <span>Exchange Txn Fee</span>
              <FinanceTooltip content="NSE Equity cash transaction charge: 0.00345% of total turnover." />
            </div>
            <div className="text-[#00ffa3] font-mono font-bold mt-1 text-[11px]">0.00345% (NSE)</div>
          </div>

          <div className="p-2.5 bg-[#0c0c0e] rounded-lg border border-[rgba(236,236,237,0.08)]">
            <div className="text-neutral-400 text-[10px] flex items-center justify-between uppercase">
              <span>SEBI Charges</span>
              <FinanceTooltip content="Securities and Exchange Board of India regulatory charge: ₹10 per crore." />
            </div>
            <div className="text-[#00ffa3] font-mono font-bold mt-1 text-[11px]">₹10 / Crore</div>
          </div>

          <div className="p-2.5 bg-[#0c0c0e] rounded-lg border border-[rgba(236,236,237,0.08)]">
            <div className="text-neutral-400 text-[10px] flex items-center justify-between uppercase">
              <span>GST & Stamp Duty</span>
              <FinanceTooltip content="GST 18% on (Brokerage + Txn Charges + SEBI) + 0.015% Stamp Duty on Buy turnover." />
            </div>
            <div className="text-[#00ffa3] font-mono font-bold mt-1 text-[11px]">18% GST + Stamp</div>
          </div>
        </div>

        {/* Slippage & Brokerage Sliders */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[rgba(236,236,237,0.08)]">
          <div>
            <div className="flex items-center justify-between text-xs mb-1 font-mono">
              <span className="text-neutral-300 flex items-center gap-1">
                EXECUTION SLIPPAGE
                <FinanceTooltip content="Expected adverse price difference during market order execution (1 bps = 0.01%)." />
              </span>
              <span className="font-mono text-[#00ffa3] font-bold">{costs.slippageBps} bps</span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="30"
                step="1"
                value={costs.slippageBps}
                onChange={e => onChange({ ...costs, slippageBps: parseInt(e.target.value, 10) || 0 })}
                className="flex-1 accent-[#00ffa3] cursor-pointer h-1.5 bg-[#1d1d21] rounded-lg"
              />
              <input
                type="number"
                value={costs.slippageBps}
                onChange={e => onChange({ ...costs, slippageBps: parseInt(e.target.value, 10) || 0 })}
                className="w-16 bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-1 text-xs text-right font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1 font-mono">
              <span className="text-neutral-300 flex items-center gap-1">
                FLAT BROKERAGE (PER ORDER)
                <FinanceTooltip content="Standard discount broker rate (e.g. Zerodha, Angel One ₹20/order)." />
              </span>
              <span className="font-mono text-[#00ffa3] font-bold">₹{costs.brokerageFlat}</span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="50"
                step="5"
                value={costs.brokerageFlat}
                onChange={e => onChange({ ...costs, brokerageFlat: parseFloat(e.target.value) || 0 })}
                className="flex-1 accent-[#00ffa3] cursor-pointer h-1.5 bg-[#1d1d21] rounded-lg"
              />
              <input
                type="number"
                value={costs.brokerageFlat}
                onChange={e => onChange({ ...costs, brokerageFlat: parseFloat(e.target.value) || 0 })}
                className="w-16 bg-[#0c0c0e] border border-[rgba(236,236,237,0.08)] rounded px-2 py-1 text-xs text-right font-mono text-[#ececed] focus:border-[#00ffa3] focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
