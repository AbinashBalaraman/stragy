import React from 'react';
import { IndianCostBreakdown, CostModelConfig } from '../../shared/strategy/types';
import { formatINR } from '../../shared/format';
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
  const brokerageFlat = config?.brokerageFlat;
  const slippageBps = config?.slippageBps;

  const items = [
    {
      name: 'Securities Transaction Tax (STT)',
      amount: effectiveCosts.stt,
      rate: 'Illustrative schedule',
      tooltip: 'Statutory direct tax levied by the Ministry of Finance on Indian exchange transactions.'
    },
    {
      name: 'GST',
      amount: effectiveCosts.gst,
      rate: 'Illustrative schedule',
      tooltip: '18% tax applied on brokerage and transaction fees.'
    },
    {
      name: 'Exchange transaction fees',
      amount: effectiveCosts.exchangeTxnCharges,
      rate: 'Illustrative schedule',
      tooltip: 'NSE cash-equity turnover charge.'
    },
    {
      name: 'SEBI regulatory charges',
      amount: effectiveCosts.sebiCharges,
      rate: 'Illustrative schedule',
      tooltip: 'Capital-market regulatory fee.'
    },
    {
      name: 'State stamp duty',
      amount: effectiveCosts.stampDuty,
      rate: 'Illustrative schedule',
      tooltip: 'Indian Stamp Act duty on equity delivery buy orders.'
    },
    {
      name: 'Brokerage',
      amount: effectiveCosts.brokerage,
      rate: brokerageFlat === undefined ? 'See run assumptions' : `${formatINR(brokerageFlat)} per fill`,
      tooltip: 'Flat discount brokerage fee across all executed entry and exit legs.'
    },
    {
      name: 'Embedded slippage (informational)',
      amount: effectiveCosts.slippage,
      rate: slippageBps === undefined ? 'Already in fills' : `${slippageBps} bps in fills`,
      tooltip: 'Already included in execution prices and gross P&L. Not an additional cash debit.'
    }
  ];

  return (
    <div className="space-y-4 rounded-2xl border border-[rgba(236,236,237,0.08)] bg-[#171719] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[rgba(236,236,237,0.08)] pb-3.5">
        <div className="flex items-center gap-2.5">
          <Receipt className="h-5 w-5 text-[#a8c7fa]" />
          <div>
            <h3 className="text-sm font-semibold text-[#ececed]">Illustrative fee breakdown (unverified)</h3>
            <p className="mt-0.5 text-[11px] text-[rgba(236,236,237,0.52)]">
              Turnover {formatINR(effectiveCosts.turnover)} · {effectiveTradeType === 'DELIVERY' ? 'Delivery' : 'Intraday'} · {tradesCount ?? 0} {(tradesCount ?? 0) === 1 ? 'trade' : 'trades'}
            </p>
          </div>
        </div>

        <div className="text-right">
          <span className="block text-[11px] text-[rgba(236,236,237,0.52)]">Cash-debited fees</span>
          <span className="font-mono text-sm font-semibold text-rose-300">
            {formatINR(-Math.abs(effectiveCosts.totalCharges))}
          </span>
        </div>
      </div>

      <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-100/90">
        Rates are not certified. DP and broker-specific charges are excluded. Gross P&amp;L already includes slippage; net P&amp;L subtracts cash-debited fees only.
        {typeof netPnl === 'number' ? ` Net P&L after fees: ${formatINR(netPnl, { signed: true })}.` : ''}
      </p>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(item => (
          <div key={item.name} className="min-w-0 space-y-1 rounded-xl border border-[rgba(236,236,237,0.08)] bg-[#151517] p-3">
            <div className="flex items-center justify-between gap-1 text-xs text-[rgba(236,236,237,0.58)]">
              <span className="flex min-w-0 items-center gap-1 font-medium leading-tight">
                <span className="break-words">{item.name}</span>
                <FinanceTooltip content={item.tooltip} />
              </span>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="font-mono text-sm font-semibold text-[#ececed]">{formatINR(item.amount)}</span>
              <span className="font-mono text-[10px] text-[rgba(236,236,237,0.45)]">{item.rate}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
