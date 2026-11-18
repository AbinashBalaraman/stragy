import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * A typed engine failure that belongs to the conversation. The chat has one
 * path (the OpenCode engine); a failure states its code, never falls back to a
 * different model route, and Retry resends the same turn.
 */

export interface EngineErrorCardProps {
  message: string;
  code?: string;
  status?: number;
  retryable: boolean;
  retrying?: boolean;
  onRetry?: () => void;
}

export const EngineErrorCard: React.FC<EngineErrorCardProps> = ({ message, code, status, retryable, retrying, onRetry }) => (
  <article
    aria-label="Engine error"
    data-testid="engine-error-card"
    className="mt-2 w-full max-w-[var(--chat-prose)] rounded-[var(--r-inner)] border border-[var(--danger)]/30 bg-[var(--danger)]/[0.05] px-3 py-2.5"
  >
    <div className="flex items-start gap-2">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p role="alert" className="min-w-0 text-[13px] leading-5 text-[#fca5a5] [overflow-wrap:anywhere]">{message}</p>
        <p className="st-meta mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[var(--text-3)]">
          {code && <code className="rounded-[4px] border border-[var(--line)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text-2)]">{code}</code>}
          {status ? <span>HTTP {status}</span> : null}
          <span>Nothing was run and no reply was invented.</span>
        </p>
        {retryable && onRetry && (
          <button
            type="button"
            disabled={retrying}
            onClick={onRetry}
            className="st-meta mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--r-btn)] border border-[var(--line-strong)] px-3 font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9"
          >
            <RefreshCw size={14} aria-hidden="true" className={retrying ? 'animate-spin' : undefined} /> {retrying ? 'Retrying…' : 'Retry'}
          </button>
        )}
        {!retryable && <p className="st-meta mt-1 text-[var(--text-3)]">This error is not retryable. Reload the app after the server is updated.</p>}
      </div>
    </div>
  </article>
);
