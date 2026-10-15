import React from 'react';
import { IndianCostBreakdown, CostModelConfig } from '../../shared/strategy/types';
import { Receipt } from 'lucide-react';
import { FinanceTooltip } from '../common/Tooltip';

interface IndianCostWaterfallProps {
  costs?: IndianCostBreakdown;
  config?: CostModelConfig;
  costBreakdown?: IndianCostBreakdown;
  grossPnl?: number;
  netPnl?: number;
  tradesCount?: number;
  tradeType?: 'DELIVERY' | 'INTRADAY';
}

export const IndianCostWaterfall: React.FC<IndianCostWaterfallProps> = ({
  costs,
  config,
  costBreakdown,
  grossPnl,
  netPnl,
  tradesCount,
  tradeType
}) => {
  const effectiveCosts: IndianCostBreakdown = costs || costBreakdown || {
    stt: 0,
    gst: 0,
    exchangeTxnCharges: 0,
    sebiCharges: 0,
    stampDuty: 0,
    brokerage: 0,
    slippage: 0,
    totalCharges: 0,
    turnover: 0
  };

  const effectiveTradeType = config?.tradeType || tradeType || 'DELIVERY';
  const brokerageFlat = config?.brokerageFlat ?? 20;
  const slippageBps = config?.slippageBps ?? 5;

  const items = [
    {
      name: 'Securities Transaction Tax (STT)',
      amount: effectiveCosts.stt,
      rate: effectiveTradeType === 'DELIVERY' ? '0.1% on Buy & Sell' : '0.025% on Sell',
      tooltip: 'Statutory direct tax levied by Ministry of Finance on Indian exchange transactions.'
    },
    {
      name: 'GST (Goods & Services Tax)',
      amount: effectiveCosts.gst,
      rate: '18% on (Brokerage + Txn + SEBI)',
      tooltip: '18% tax applied on brokerage and transaction fees.'
    },
    {
      name: 'Exchange Transaction Fees',
      amount: effectiveCosts.exchangeTxnCharges,
      rate: '0.00345% of Turnover',
      tooltip: 'NSE cash equity turnover charge.'
    },
    {
      name: 'SEBI Regulatory Charges',
      amount: effectiveCosts.sebiCharges,
      rate: '₹10 per Crore',
      tooltip: 'Capital market regulatory fee.'
    },
    {
      name: 'State Stamp Duty',
      amount: effectiveCosts.stampDuty,
      rate: '0.015% on Buy Turnover',
      tooltip: 'Indian Stamp Act duty on equity delivery buy orders.'
    },
    {
      name: 'Brokerage Charges',
      amount: effectiveCosts.brokerage,
      rate: `₹${brokerageFlat} per order leg`,
      tooltip: 'Flat discount brokerage fee across all executed entry and exit legs.'
    },
    {
      name: 'Execution Slippage',
      amount: effectiveCosts.slippage,
      rate: `${slippageBps} bps`,
      tooltip: 'Estimated market impact and spread cost.'
    }
  ];

  return (
    <div className="p-4 sm:p-6 bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl space-y-4">
      <div className="flex items-center justify-between border-b border-[rgba(236,236,237,0.08)] pb-3.5">
        <div className="flex items-center gap-2.5">
          <Receipt className="w-5 h-5 text-[#00ffa3]" />
          <div>
            <h3 className="font-syne font-bold text-sm text-[#ececed]">Indian Statutory Tax & Cost Waterfall</h3>
            <p className="text-[11px] text-[rgba(236,236,237,0.5)]">
              Total Turnover: ₹{effectiveCosts.turnover.toLocaleString('en-IN')} • Mode: {effectiveTradeType}
            </p>
          </div>
        </div>

        <div className="text-right">
          <span className="text-xs text-[rgba(236,236,237,0.5)] block">Total Execution Friction</span>
          <span className="text-sm font-extrabold font-mono text-amber-400">
            -₹{effectiveCosts.totalCharges.toLocaleString('en-IN')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {items.map((item, idx) => (
          <div key={idx} className="p-3 bg-[#141417] border border-[rgba(236,236,237,0.08)] rounded-xl space-y-1">
            <div className="flex items-center justify-between text-xs text-neutral-400">
              <span className="font-medium truncate flex items-center gap-1">
                {item.name}
                <FinanceTooltip content={item.tooltip} />
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-sm font-bold text-[#ececed]">
                ₹{item.amount.toLocaleString('en-IN')}
              </span>
              <span className="text-[10px] text-neutral-500 font-mono">{item.rate}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
