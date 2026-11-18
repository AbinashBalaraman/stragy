import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Circle, ListChecks, Loader2, Square } from 'lucide-react';
import { humanSummary, toolLabel } from './agentToolLabels';

/**
 * A quiet, collapsible timeline of engine tool calls for one assistant turn.
 * Expanded while the turn runs (with the current step and Stop), collapsed to a
 * one-line summary when the answer arrives. It renders summaries the server
 * already made human; raw JSON is never shown, and failed steps explain
 * themselves in plain words. The parent owns all wiring (stream + interrupt);
 * this component is presentational.
 */

export type AgentToolStatus = 'called' | 'running' | 'success' | 'failed';

export interface AgentToolEntry {
  type: 'tool';
  name: string;
  status: AgentToolStatus;
  summary?: string;
  durationMs?: number;
  error?: { code: string; message: string };
  /** Repeated polls are one row; this is how many times it ran. */
  attempts?: number;
}

export interface AgentActivityProps {
  entries: AgentToolEntry[];
  running: boolean;
  currentStep?: string;
  onStop?: () => void;
}

const STATUS_ICON = {
  called: { Icon: Circle, className: 'text-[var(--text-3)]' },
  running: { Icon: Loader2, className: 'animate-spin text-[var(--accent)]' },
  success: { Icon: Check, className: 'text-[var(--up)]' },
  failed: { Icon: AlertTriangle, className: 'text-[var(--danger)]' },
} as const;

const STATUS_TEXT: Record<AgentToolStatus, string> = {
  called: 'Queued',
  running: 'Running',
  success: 'Done',
  failed: 'Failed',
};

/** Durations are short and honest: milliseconds, seconds, or minutes + seconds. */
export function formatDuration(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1_000) return Math.round(ms) + ' ms';
  if (ms < 60_000) {
    const seconds = ms / 1_000;
    return (seconds < 10 ? seconds.toFixed(1) : String(Math.round(seconds))).replace(/\.0$/, '') + ' s';
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return minutes + ' m' + (seconds ? ' ' + seconds + ' s' : '');
}

function errorLine(entry: AgentToolEntry): string | undefined {
  const message = humanSummary(entry.error?.message, 220);
  if (message) return message;
  const code = entry.error?.code?.trim();
  if (!code) return undefined;
  const words = code.replace(/[_-]+/g, ' ').toLowerCase();
  return 'This step could not finish (' + words + ').';
}

function totalDuration(entries: AgentToolEntry[]): number {
  return entries.reduce((sum, entry) => sum + (typeof entry.durationMs === 'number' && entry.durationMs > 0 ? entry.durationMs : 0), 0);
}

export const AgentActivity: React.FC<AgentActivityProps> = ({ entries, running, currentStep, onStop }) => {
  const [open, setOpen] = useState(running);
  const wasRunning = useRef(running);
  const panelId = useId();

  // Expanded while the turn runs, collapsed the moment the answer arrives. A
  // reader can still toggle either way; only the transition is automatic.
  useEffect(() => {
    if (wasRunning.current === running) return;
    wasRunning.current = running;
    setOpen(running);
  }, [running]);

  if (!entries.length && !running) return null;

  const failed = entries.filter(entry => entry.status === 'failed').length;
  const done = entries.filter(entry => entry.status === 'success').length;
  const duration = formatDuration(totalDuration(entries));
  const step = humanSummary(currentStep, 240);
  // The active step already owns the strip above; do not repeat the same call as
  // a timeline row while the turn is running.
  const rows = running && step
    ? entries.filter(entry => {
      if (entry.status !== 'running' && entry.status !== 'called') return true;
      return (humanSummary(entry.summary) ?? toolLabel(entry.name)) !== step;
    })
    : entries;
  const heading = running
    ? 'Working' + (entries.length ? ' · ' + entries.length + (entries.length === 1 ? ' step' : ' steps') : '')
    : entries.length + (entries.length === 1 ? ' step' : ' steps');
  const rightMeta = running
    ? (entries.length ? done + ' of ' + entries.length + ' done' : '')
    : [failed ? failed + ' failed' : '', duration].filter(Boolean).join(' · ');
  const HeaderIcon = running ? Loader2 : failed ? AlertTriangle : ListChecks;

  return (
    <section aria-label="Agent activity" data-testid="agent-activity" className="mt-2 w-full max-w-[var(--chat-prose)] text-[13px] leading-5">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-[var(--r-btn)] px-1 text-left text-[var(--text-3)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text-2)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]"
      >
        <HeaderIcon
          className={'h-3.5 w-3.5 shrink-0 ' + (running ? 'animate-spin text-[var(--accent)]' : failed ? 'text-[var(--danger)]' : 'text-[var(--text-3)]')}
          aria-hidden="true"
        />
        <span className={'min-w-0 flex-1 truncate ' + (failed && !running ? 'text-[#fca5a5]' : '')}>{heading}</span>
        {rightMeta && <span className="st-tnum shrink-0 text-[11px] text-[var(--text-3)]">{rightMeta}</span>}
        <ChevronDown className={'h-3.5 w-3.5 shrink-0 text-[var(--text-3)] transition-transform duration-150 ' + (open ? 'rotate-180' : '')} aria-hidden="true" />
      </button>

      {running && step && (
        <div role="status" aria-live="polite" className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 rounded-[var(--r-inner)] bg-[var(--surface-2)] px-3 py-2">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--accent)]" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-[13px] leading-5 text-[var(--text-2)] [overflow-wrap:anywhere]">{step}</p>
          {onStop && (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop the current step"
              className="ml-auto inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-[var(--r-btn)] border border-[var(--line-strong)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]"
            >
              <Square className="h-3 w-3 fill-current" aria-hidden="true" />
              Stop
            </button>
          )}
        </div>
      )}

      {open && rows.length > 0 && (
        <ol id={panelId} aria-label="Tool calls" className="mt-2 space-y-2 border-l border-[var(--line)] pl-3">
          {rows.map((entry, index) => {
            const status = STATUS_ICON[entry.status] ?? STATUS_ICON.called;
            const StatusIcon = status.Icon;
            const summary = humanSummary(entry.summary);
            const primary = summary ?? toolLabel(entry.name);
            const failure = entry.status === 'failed' ? errorLine(entry) : undefined;
            const durationMs = entry.status === 'running' || entry.status === 'called' ? undefined : entry.durationMs;
            const attempts = entry.attempts && entry.attempts > 1 ? entry.attempts : null;
            return (
              <li key={entry.name + '-' + index} className="flex min-w-0 items-start gap-2" data-status={entry.status}>
                <StatusIcon className={'mt-0.5 h-3.5 w-3.5 shrink-0 ' + status.className} aria-hidden="true" />
                <span className="sr-only">{STATUS_TEXT[entry.status]}: </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="min-w-0 text-[13px] leading-5 text-[var(--text-2)] [overflow-wrap:anywhere]">{primary}</span>
                    {attempts !== null && <span className="st-tnum shrink-0 text-[11px] text-[var(--text-3)]">attempt {attempts}</span>}
                    {durationMs !== undefined && <span className="st-tnum shrink-0 text-[11px] text-[var(--text-3)]">{formatDuration(durationMs)}</span>}
                  </div>
                  {failure && <p className="mt-0.5 text-[12px] leading-5 text-[#fca5a5] [overflow-wrap:anywhere]">{failure}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};
