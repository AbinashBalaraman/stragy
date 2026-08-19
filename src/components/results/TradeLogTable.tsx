import React, { useState } from 'react';
import { TradeRecord, SymbolMeta } from '../../shared/strategy/types';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface TradeLogTableProps {
  trades: TradeRecord[];
  symbol?: SymbolMeta;
}

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

  const getExitReasonBadge = (reason: TradeRecord['exitReason']) => {
    switch (reason) {
      case 'TAKE_PROFIT':
        return <span className="px-2 py-0.5 rounded bg-[#00ffa3]/10 text-[#00ffa3] border border-[#00ffa3]/20 text-[10px] font-bold">Target Hit</span>;
      case 'STOP_LOSS':
        return <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-bold">Stop Loss</span>;
      case 'TRAILING_STOP':
        return <span className="px-2 py-0.5 rounded bg-[#00ffa3]/10 text-[#00ffa3] border border-[#00ffa3]/20 text-[10px] font-bold">Trailing Stop</span>;
      case 'MAX_DRAWDOWN':
        return <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-bold">Drawdown Cutoff</span>;
      case 'RULE_EXIT':
        return <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[10px] font-bold">Rule Trigger</span>;
      default:
        return <span className="px-2 py-0.5 rounded bg-[#1d1d21] text-neutral-400 text-[10px]">End of Period</span>;
    }
  };

  return (
    <div className="p-4 sm:p-6 bg-[#161619] border border-[rgba(236,236,237,0.08)] rounded-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(236,236,237,0.08)] pb-3.5">
        <div>
          <h3 className="font-syne font-bold text-sm text-[#ececed]">Trade Execution Log & Journal</h3>
          <p className="text-[11px] text-[rgba(236,236,237,0.5)]">Total {trades.length} Executed Trade Cycles (Next-Bar Open Execution)</p>
        </div>

        <div className="flex items-center gap-1.5 bg-[#1d1d21] p-1 rounded-xl border border-[rgba(236,236,237,0.08)] text-xs">
          <button
            type="button"
            onClick={() => { setFilter('ALL'); setCurrentPage(1); }}
            className={`px-3 py-1 rounded-lg font-semibold transition-all ${filter === 'ALL' ? 'bg-[#00ffa3] text-[#0c0c0e] font-bold shadow-sm' : 'text-neutral-400 hover:text-white'}`}
          >
            All ({trades.length})
          </button>
          <button
            type="button"
            onClick={() => { setFilter('WINS'); setCurrentPage(1); }}
            className={`px-3 py-1 rounded-lg font-semibold transition-all ${filter === 'WINS' ? 'bg-[#00ffa3] text-[#0c0c0e] font-bold shadow-sm' : 'text-neutral-400 hover:text-white'}`}
          >
            Wins ({trades.filter(t => t.netPnl > 0).length})
          </button>
          <button
            type="button"
            onClick={() => { setFilter('LOSSES'); setCurrentPage(1); }}
            className={`px-3 py-1 rounded-lg font-semibold transition-all ${filter === 'LOSSES' ? 'bg-rose-500 text-white font-bold shadow-sm' : 'text-neutral-400 hover:text-white'}`}
          >
            Losses ({trades.filter(t => t.netPnl <= 0).length})
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead className="bg-[#141417] text-[rgba(236,236,237,0.5)] font-semibold text-[11px] uppercase tracking-wider">
            <tr>
              <th className="p-3">ID</th>
              <th className="p-3">Entry Date / Price</th>
              <th className="p-3">Exit Date / Price</th>
              <th className="p-3">Qty</th>
              <th className="p-3">Holding</th>
              <th className="p-3">Exit Reason</th>
              <th className="p-3 text-right">Net PnL (₹ / %)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgba(236,236,237,0.06)]">
            {paginatedTrades.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-neutral-500">
                  No trades match the selected filter.
                </td>
              </tr>
            ) : (
              paginatedTrades.map(t => {
                const isWin = t.netPnl > 0;
                return (
                  <tr key={t.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="p-3 font-mono text-neutral-400 font-semibold">{t.id}</td>
                    <td className="p-3">
                      <div className="font-mono text-[#ececed]">₹{t.entryPrice?.toFixed(2)}</div>
                      <div className="text-[10px] text-neutral-500">{t.entryDate}</div>
                    </td>
                    <td className="p-3">
                      <div className="font-mono text-[#ececed]">₹{t.exitPrice?.toFixed(2)}</div>
                      <div className="text-[10px] text-neutral-500">{t.exitDate}</div>
                    </td>
                    <td className="p-3 font-mono text-[#ececed]">{t.quantity}</td>
                    <td className="p-3 text-neutral-400 font-mono">{t.holdingDays}d</td>
                    <td className="p-3">{getExitReasonBadge(t.exitReason)}</td>
                    <td className="p-3 text-right">
                      <div className={`font-mono font-bold flex items-center justify-end gap-0.5 ${isWin ? 'text-[#00ffa3]' : 'text-rose-400'}`}>
                        {isWin ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                        <span>{isWin ? '+' : ''}₹{t.netPnl?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className={`text-[10px] font-mono ${isWin ? 'text-[#00ffa3]/80' : 'text-rose-400/80'}`}>
                        {isWin ? '+' : ''}{t.pnlPercent?.toFixed(2)}%
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-3 border-t border-[rgba(236,236,237,0.08)] text-xs text-neutral-400">
          <span>Page {currentPage} of {totalPages}</span>
          <div className="flex gap-1.5">
            <button
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage(p => p - 1)}
              className="px-3 py-1 rounded bg-[#1d1d21] disabled:opacity-40 text-[#ececed]"
            >
              Previous
            </button>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage(p => p + 1)}
              className="px-3 py-1 rounded bg-[#1d1d21] disabled:opacity-40 text-[#ececed]"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
