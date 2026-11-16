import React, { useState } from 'react';
import { TradeRecord, SymbolMeta } from '../../shared/strategy/types';
import { formatDate, formatINR, formatPercent } from '../../shared/format';
import { DataTable, type DataColumn } from '../common/DataTable';

interface TradeLogTableProps {
  trades: TradeRecord[];
  symbol?: SymbolMeta;
}

const exitReasonLabel = (reason: TradeRecord['exitReason']): string => {
  switch (reason) {
    case 'TAKE_PROFIT': return 'Target hit';
    case 'STOP_LOSS': return 'Stop loss';
    case 'TRAILING_STOP': return 'Trailing stop';
    case 'MAX_DRAWDOWN': return 'Drawdown cutoff';
    case 'RULE_EXIT': return 'Rule exit';
    default: return 'End of period';
  }
};

/** Return on the entry notional after fees, so its sign matches net P&L. */
const netReturnPercent = (trade: TradeRecord): number => {
  const notional = Math.abs(trade.entryPrice * trade.quantity);
  return notional > 0 ? (trade.netPnl / notional) * 100 : trade.pnlPercent;
};

type Filter = 'ALL' | 'WINS' | 'LOSSES';

export const TradeLogTable: React.FC<TradeLogTableProps> = ({ trades }) => {
  const [filter, setFilter] = useState<Filter>('ALL');
  const filteredTrades = trades.filter(trade => {
    if (filter === 'WINS') return trade.netPnl > 0;
    if (filter === 'LOSSES') return trade.netPnl <= 0;
    return true;
  });

  const columns: DataColumn<TradeRecord>[] = [
    {
      key: 'id',
      header: 'Trade',
      render: trade => <span className="font-medium text-[var(--text-1)]">{trade.id}</span>,
    },
    {
      key: 'entry',
      header: 'Entry',
      render: trade => (
        <>
          <span className="st-tnum">{formatINR(trade.entryPrice)}</span>
          <span className="st-meta block text-[var(--text-3)]">{formatDate(trade.entryDate)}</span>
        </>
      ),
    },
    {
      key: 'exit',
      header: 'Exit',
      render: trade => (
        <>
          <span className="st-tnum">{formatINR(trade.exitPrice)}</span>
          <span className="st-meta block text-[var(--text-3)]">{formatDate(trade.exitDate)}</span>
        </>
      ),
    },
    { key: 'quantity', header: 'Qty', align: 'right', render: trade => trade.quantity },
    { key: 'holding', header: 'Held', align: 'right', render: trade => `${trade.holdingDays}d` },
    { key: 'reason', header: 'Exit reason', render: trade => <span className="text-[var(--text-2)]">{exitReasonLabel(trade.exitReason)}</span> },
    {
      key: 'net',
      header: 'Net P&L',
      align: 'right',
      render: trade => {
        const win = trade.netPnl > 0;
        return (
          <>
            <span className={'st-tnum whitespace-nowrap font-medium ' + (win ? 'text-[var(--up)]' : 'text-[var(--down)]')}>
              {formatINR(trade.netPnl, { signed: true })}
            </span>
            <span className="st-meta block text-[var(--text-3)]" title="Return on entry value after fees">
              {formatPercent(netReturnPercent(trade), { signed: true, decimals: 2 })}
            </span>
          </>
        );
      },
    },
  ];

  const filterButton = (value: Filter, label: string, count: number) => (
    <button
      key={value}
      type="button"
      aria-pressed={filter === value}
      onClick={() => setFilter(value)}
      className={'rounded-[var(--r-btn)] px-2.5 py-1 text-xs transition-colors ' + (filter === value ? 'bg-white/[0.08] font-medium text-[var(--text-1)]' : 'text-[var(--text-3)] hover:bg-white/[0.04] hover:text-[var(--text-2)]')}
    >
      {label} ({count})
    </button>
  );

  return (
    <section aria-labelledby="trade-log-title" className="space-y-3 rounded-[var(--r-card)] border border-[var(--line)] bg-[var(--surface-1)] p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="trade-log-title" className="st-title font-semibold text-[var(--text-1)]">Trade log</h2>
          <p className="st-meta mt-0.5 text-[var(--text-3)]">
            {trades.length} closed trade {trades.length === 1 ? 'cycle' : 'cycles'} · signals fill at the next open
          </p>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Trade filter">
          {filterButton('ALL', 'All', trades.length)}
          {filterButton('WINS', 'Wins', trades.filter(trade => trade.netPnl > 0).length)}
          {filterButton('LOSSES', 'Losses', trades.filter(trade => trade.netPnl <= 0).length)}
        </div>
      </div>

      <DataTable
        caption={`Trade log, ${filteredTrades.length} trades`}
        columns={columns}
        rows={filteredTrades}
        rowKey={trade => trade.id}
        initialLimit={10}
        empty="No trades match the selected filter."
      />
    </section>
  );
};
