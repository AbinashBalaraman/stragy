import React from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import type { ScanResult } from '../../client/api';
import { formatCount } from './chatUi';

/**
 * A read-only scan result restored from the engine when the transcript has the
 * tool result but no screen-payload plan (the real adapter shape for a live
 * scan). It shows only what the server reported: counts, rows and warnings. It
 * never reconstructs rules it does not have and offers no actions that would
 * need a plan.
 */
export const EngineScanResultCard: React.FC<{ result: ScanResult }> = ({ result }) => {
  const matches = result.matches.slice(0, 20);
  const countText = result.matched === 1 ? '1 match' : formatCount(result.matched) + ' matches';
  const checked = formatCount(result.succeeded) + ' of ' + formatCount(result.requested) + ' checked';

  return (
    <article aria-label="Scan results" data-testid="engine-scan-result" className="w-full max-w-[var(--chat-prose)] rounded-[var(--r-card)] border border-[var(--line)] bg-[var(--surface-1)] p-3 sm:p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h3 className="text-[15px] leading-6 font-medium text-[var(--text-1)]">Scan result</h3>
          <p className="st-meta text-[var(--text-3)]">{result.universe} · {result.mode === 'real' ? 'real data' : result.mode ?? 'data mode not reported'}</p>
        </div>
        <p className="st-tnum shrink-0 text-[12px] text-[var(--text-3)]">{checked}</p>
      </header>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-2 border-t border-[var(--line)] pt-3">
        <span className="st-stat font-semibold text-[var(--text-1)]">{countText}</span>
        {result.succeeded === 0 && <span className="text-[13px] leading-5 text-[var(--text-2)]">No successful data coverage. Matches are unknown, not zero.</span>}
        {result.succeeded > 0 && result.matched === 0 && <span className="text-[13px] leading-5 text-[var(--text-2)]">No stock met the scanned conditions.</span>}
      </div>

      {matches.length > 0 && (
        <ul className="mt-3 divide-y divide-[var(--line)]">
          {matches.map(match => (
            <li key={match.symbolId} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 first:pt-0 last:pb-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium leading-5 text-[var(--text-1)]">{match.ticker}</span>
                <span className="st-meta block truncate text-[var(--text-3)]">{match.name}</span>
              </span>
              <span className="st-tnum shrink-0 text-[13px] text-[var(--text-2)]">₹{match.lastClose.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span className="st-meta shrink-0 text-[var(--text-3)]">{match.lastDate}</span>
            </li>
          ))}
        </ul>
      )}

      {(result.errors.length > 0 || result.warnings.length > 0) && (
        <div className="mt-3 space-y-1 border-t border-[var(--line)] pt-2">
          {result.succeeded > 0 && (
            <p className="st-meta flex items-center gap-1.5 text-[var(--up)]"><Check size={12} aria-hidden="true" /> {formatCount(result.succeeded)} symbols evaluated</p>
          )}
          {result.failed > 0 && (
            <p className="st-meta flex items-center gap-1.5 text-[#f5d383]"><AlertTriangle size={12} aria-hidden="true" /> {formatCount(result.failed)} failed, {formatCount(result.unavailable)} unavailable</p>
          )}
          {result.warnings.slice(0, 3).map((warning, index) => (
            <p key={index} className="st-meta text-[var(--text-3)] [overflow-wrap:anywhere]">{warning}</p>
          ))}
        </div>
      )}

      <p className="st-meta mt-2 text-[var(--text-3)]">Saved engine result. The scan plan is not in this transcript, so its rules are not reconstructed here.</p>
    </article>
  );
};
