import React, { useState } from 'react';
import { TradeRecord, SymbolMeta } from '../../shared/strategy/types';
import { formatDate, formatINR, formatPercent } from '../../shared/format';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface TradeLogTableProps {
  trades: TradeRecord[];
  symbol?: SymbolMeta;
}

const exitReasonLabel = (reason: TradeRecord['exitReason']): string => {
  switch (reason) {
    case 'TAKE_PROFIT':
      return 'Target hit';
    case 'STOP_LOSS':
      return 'Stop loss';
    case 'TRAILING_STOP':
      return 'Trailing stop';
    case 'MAX_DRAWDOWN':
      return 'Drawdown cutoff';
    case 'RULE_EXIT':
      return 'Rule exit';
    default:
      return 'End of period';
  }
};

/** Return on the entry notional after fees, so its sign matches net P&L. */
const netReturnPercent = (trade: TradeRecord): number => {
  const notional = Math.abs(trade.entryPrice * trade.quantity);
  return notional > 0 ? (trade.netPnl / notional) * 100 : trade.pnlPercent;
};

const ExitReasonBadge: React.FC<{ reason: TradeRecord['exitReason'] }> = ({ reason }) => {
  const tone = reason === 'TAKE_PROFIT' || reason === 'TRAILING_STOP'
    ? 'border-[#a8c7fa]/25 bg-[#a8c7fa]/10 text-[#a8c7fa]'
    : reason === 'STOP_LOSS' || reason === 'MAX_DRAWDOWN'
      ? 'border-rose-500/25 bg-rose-500/10 text-rose-300'
      : 'border-[rgba(236,236,237,0.1)] bg-[rgba(236,236,237,0.04)] text-[rgba(236,236,237,0.66)]';
  return <span className={`inline-flex whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>{exitReasonLabel(reason)}</span>;
};

export const TradeLogTable: React.FC<TradeLogTableProps> = ({ trades }) => {
  const [filter, setFilter] = useState<'ALL' | 'WINS' | 'LOSSES'>('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const filteredTrades = trades.filter(t => {
    if (filter === 'WINS') return t.netPnl > 0;
    if (filter === 'LOSSES') return t.netPnl <= 0;
    return true;
  });

  const totalPages = Math.ceil(filteredTrades.length / pageSize) || 1;
  const paginatedTrades = filteredTrades.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const filterButton = (value: typeof filter, label: string, count: number, tone?: 'loss') => (
    <button
      type="button"
      aria-pressed={filter === value}
      onClick={() => { setFilter(value); setCurrentPage(1); }}
      className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
        filter === value
          ? tone === 'loss'
            ? 'bg-rose-400 font-semibold text-[#101012]'
            : 'bg-[#a8c7fa] font-semibold text-[#101012]'
          : 'text-[rgba(236,236,237,0.58)] hover:text-[#ececed]'
      }`}
    >
      {label} <span className={filter === value ? 'opacity-70' : 'text-[rgba(236,236,237,0.4)]'}>({count})</span>
    </button>
  );

  return (
    <div className="space-y-4 rounded-2xl border border-[rgba(236,236,237,0.08)] bg-[#171719] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(236,236,237,0.08)] pb-3.5">
        <div>
          <h3 className="text-sm font-semibold text-[#ececed]">Trade log</h3>
          <p className="mt-0.5 text-[11px] text-[rgba(236,236,237,0.52)]">
            {trades.length} closed trade {trades.length === 1 ? 'cycle' : 'cycles'} · signals fill at the next open
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-[rgba(236,236,237,0.08)] bg-[#1e1e21] p-1">
          {filterButton('ALL', 'All', trades.length)}
          {filterButton('WINS', 'Wins', trades.filter(t => t.netPnl > 0).length)}
          {filterButton('LOSSES', 'Losses', trades.filter(t => t.netPnl <= 0).length, 'loss')}
        </div>
      </div>

      {paginatedTrades.length === 0 && (
        <p className="py-6 text-center text-xs text-[rgba(236,236,237,0.52)]">No trades match the selected filter.</p>
      )}

      {/* Mobile: one card per trade, with the exit reason and net P&L always visible. */}
      <ul className="space-y-3 sm:hidden">
        {paginatedTrades.map(t => {
          const isWin = t.netPnl > 0;
          return (
            <li key={t.id} className="min-w-0 space-y-2.5 rounded-xl border border-[rgba(236,236,237,0.08)] bg-[#151517] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] font-semibold text-[rgba(236,236,237,0.58)]">{t.id}</span>
                <ExitReasonBadge reason={t.exitReason} />
              </div>

              <div className="flex items-center gap-1.5 font-mono text-xs text-[#ececed]">
                <span>{formatDate(t.entryDate)}</span>
                <span className="text-[rgba(236,236,237,0.35)]">→</span>
                <span>{formatDate(t.exitDate)}</span>
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-[rgba(236,236,237,0.42)]">Entry</dt>
                  <dd className="font-mono text-[#ececed]">{formatINR(t.entryPrice)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-[rgba(236,236,237,0.42)]">Exit</dt>
                  <dd className="font-mono text-[#ececed]">{formatINR(t.exitPrice)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-[rgba(236,236,237,0.42)]">Quantity</dt>
                  <dd className="font-mono text-[#ececed]">{t.quantity}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-[rgba(236,236,237,0.42)]">Holding</dt>
                  <dd className="font-mono text-[#ececed]">{t.holdingDays} days</dd>
                </div>
              </dl>

              <div className="flex items-baseline justify-between gap-2 border-t border-[rgba(236,236,237,0.06)] pt-2">
                <span className="text-[11px] text-[rgba(236,236,237,0.5)]">Net P&amp;L</span>
                <span className={`font-mono text-sm font-semibold ${isWin ? 'text-[#a8c7fa]' : 'text-rose-300'}`}>
                  {formatINR(t.netPnl, { signed: true })}
                  <span className={`ml-1.5 text-[11px] font-medium ${isWin ? 'text-[#a8c7fa]/75' : 'text-rose-300/75'}`} title="Return on entry value after fees">
                    {formatPercent(netReturnPercent(t), { signed: true, decimals: 2 })}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#151517] text-[11px] font-semibold uppercase tracking-wider text-[rgba(236,236,237,0.52)]">
            <tr>
              <th className="p-3">ID</th>
              <th className="p-3">Entry</th>
              <th className="p-3">Exit</th>
              <th className="p-3">Qty</th>
              <th className="p-3">Holding</th>
              <th className="p-3">Exit reason</th>
              <th className="p-3 text-right">Net P&amp;L</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgba(236,236,237,0.06)]">
            {paginatedTrades.map(t => {
              const isWin = t.netPnl > 0;
              return (
                <tr key={t.id} className="transition-colors hover:bg-white/[0.02]">
                  <td className="p-3 font-mono font-semibold text-[rgba(236,236,237,0.58)]">{t.id}</td>
                  <td className="p-3">
                    <div className="font-mono text-[#ececed]">{formatINR(t.entryPrice)}</div>
                    <div className="text-[10px] text-[rgba(236,236,237,0.48)]">{formatDate(t.entryDate)}</div>
                  </td>
                  <td className="p-3">
                    <div className="font-mono text-[#ececed]">{formatINR(t.exitPrice)}</div>
                    <div className="text-[10px] text-[rgba(236,236,237,0.48)]">{formatDate(t.exitDate)}</div>
                  </td>
                  <td className="p-3 font-mono text-[#ececed]">{t.quantity}</td>
                  <td className="p-3 font-mono text-[rgba(236,236,237,0.66)]">{t.holdingDays}d</td>
                  <td className="p-3"><ExitReasonBadge reason={t.exitReason} /></td>
                  <td className="p-3 text-right">
                    <div className={`flex items-center justify-end gap-0.5 font-mono font-semibold ${isWin ? 'text-[#a8c7fa]' : 'text-rose-300'}`}>
                      {isWin ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                      <span>{formatINR(t.netPnl, { signed: true })}</span>
                    </div>
                    <div className={`font-mono text-[10px] ${isWin ? 'text-[#a8c7fa]/75' : 'text-rose-300/75'}`} title="Return on entry value after fees">
                      {formatPercent(netReturnPercent(t), { signed: true, decimals: 2 })}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-[rgba(236,236,237,0.08)] pt-3 text-xs text-[rgba(236,236,237,0.55)]">
          <span>Page {currentPage} of {totalPages}</span>
          <div className="flex gap-1.5">
            <button
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage(page => page - 1)}
              className="rounded-lg border border-[rgba(236,236,237,0.1)] bg-[#1e1e21] px-3 py-1.5 text-[#ececed] transition-colors hover:border-[#a8c7fa]/40 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage(page => page + 1)}
              className="rounded-lg border border-[rgba(236,236,237,0.1)] bg-[#1e1e21] px-3 py-1.5 text-[#ececed] transition-colors hover:border-[#a8c7fa]/40 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
