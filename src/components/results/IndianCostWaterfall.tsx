import React from 'react';
import { IndianCostBreakdown, CostModelConfig } from '../../shared/strategy/types';
import { formatINR } from '../../shared/format';
import { CardShell } from '../common/CardShell';
import { DataTable, type DataColumn } from '../common/DataTable';
import { StatRow } from '../common/StatRow';
import { Disclosure } from '../common/Disclosure';

interface IndianCostWaterfallProps {
  costs?: IndianCostBreakdown;
  config?: CostModelConfig;
  costBreakdown?: IndianCostBreakdown;
  grossPnl?: number;
  netPnl?: number;
  tradesCount?: number;
  tradeType?: 'DELIVERY' | 'INTRADAY';
}

interface CostRow {
  name: string;
  basis: string;
  amount: number;
  hint: string;
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
    stt: 0, gst: 0, exchangeTxnCharges: 0, sebiCharges: 0, stampDuty: 0, brokerage: 0, slippage: 0, totalCharges: 0, turnover: 0,
  };
  const effectiveTradeType = config?.tradeType || tradeType || 'DELIVERY';
  const brokerageFlat = config?.brokerageFlat;
  const slippageBps = config?.slippageBps;

  const rows: CostRow[] = [
    { name: 'Securities transaction tax (STT)', amount: effectiveCosts.stt, basis: 'Illustrative schedule', hint: 'Statutory tax on Indian exchange transactions.' },
    { name: 'GST', amount: effectiveCosts.gst, basis: 'Illustrative schedule', hint: '18% on brokerage and transaction fees.' },
    { name: 'Exchange transaction fees', amount: effectiveCosts.exchangeTxnCharges, basis: 'Illustrative schedule', hint: 'NSE cash-equity turnover charge.' },
    { name: 'SEBI regulatory charges', amount: effectiveCosts.sebiCharges, basis: 'Illustrative schedule', hint: 'Capital-market regulatory fee.' },
    { name: 'State stamp duty', amount: effectiveCosts.stampDuty, basis: 'Illustrative schedule', hint: 'Stamp duty on delivery buy orders.' },
    { name: 'Brokerage', amount: effectiveCosts.brokerage, basis: brokerageFlat === undefined ? 'See run assumptions' : `${formatINR(brokerageFlat)} per fill`, hint: 'Flat discount brokerage across entry and exit legs.' },
    { name: 'Slippage (informational)', amount: effectiveCosts.slippage, basis: slippageBps === undefined ? 'Already in fills' : `${slippageBps} bps in fills`, hint: 'Already included in execution prices and gross P&L; not an extra cash debit.' },
  ];

  const columns: DataColumn<CostRow>[] = [
    { key: 'name', header: 'Fee', render: row => <span className="text-[var(--text-1)]" title={row.hint}>{row.name}</span> },
    { key: 'basis', header: 'Basis', render: row => <span className="text-[var(--text-3)]">{row.basis}</span> },
    { key: 'amount', header: 'Amount', align: 'right', render: row => <span className="st-tnum whitespace-nowrap">{formatINR(row.amount)}</span> },
  ];

  return (
    <CardShell
      title="Costs"
      meta={`${effectiveTradeType === 'DELIVERY' ? 'Delivery' : 'Intraday'} · ${tradesCount ?? 0} ${(tradesCount ?? 0) === 1 ? 'trade' : 'trades'} · turnover ${formatINR(effectiveCosts.turnover)}`}
      status={undefined}
      footer={<Disclosure summary="Rates are illustrative, not certified">
        <p>No statutory or broker schedule is installed. DP and broker-specific charges are excluded. Gross P&amp;L already includes slippage; net P&amp;L subtracts cash-debited fees only.</p>
      </Disclosure>}
    >
      <StatRow
        columns={3}
        stats={[
          { label: 'Cash-debited fees', value: formatINR(-Math.abs(effectiveCosts.totalCharges)), hint: 'Fees subtracted from net P&L.' },
          { label: 'Net P&L', value: typeof netPnl === 'number' ? formatINR(netPnl, { signed: true }) : '—', unavailable: typeof netPnl !== 'number', hint: 'After cash-debited fees.' },
          { label: 'Total charges', value: formatINR(effectiveCosts.totalCharges), hint: 'Sum of the rows below.' },
        ]}
      />
      <DataTable caption="Cost breakdown by fee" columns={columns} rows={rows} rowKey={row => row.name} initialLimit={8} />
    </CardShell>
  );
};
