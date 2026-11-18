import React, { useEffect, useRef, useState } from 'react';
import { Download, MessageSquarePlus, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import type { EngineSessionSummary } from '../../client/engine';
import { Badge, formatRelative, panelButton, panelPrimaryButton } from './chatUi';

/**
 * Engine chat history. The title, relative time and model come from the
 * server; a missing title is a neutral "Untitled chat", never `undefined`.
 * Search is server-side (`?q=`), debounced by the parent, and the active chat
 * stays pinned even when it does not match the query.
 */

export interface SessionHistoryPanelProps {
  sessions: EngineSessionSummary[];
  activeSessionId: string | null;
  /** The active chat is always shown, even when the search excludes it. */
  activeSession?: EngineSessionSummary | null;
  loading: boolean;
  error: string;
  query: string;
  onQueryChange: (query: string) => void;
  onRetry: () => void;
  onNewChat: () => void;
  onSwitch: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => Promise<boolean>;
  onDelete: (sessionId: string) => Promise<boolean>;
  onExport: (sessionId: string, format: 'md' | 'json') => void;
  /** Called once a rename/delete/export settles so the panel can announce it. */
  status: string;
}

export const sessionTitle = (session: Pick<EngineSessionSummary, 'title' | 'sessionId'>): string => {
  const title = session.title?.trim();
  if (title) return title;
  return 'Untitled chat';
};

export const modelLabelOf = (session: EngineSessionSummary): string => {
  const model = session.model?.id?.trim();
  return model || '';
};

const rowActionClass = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-btn)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-8 sm:min-w-8';

interface RowProps {
  session: EngineSessionSummary;
  active: boolean;
  onSwitch: () => void;
  onRename: (title: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onExport: (format: 'md' | 'json') => void;
}

const SessionRow: React.FC<RowProps> = ({ session, active, onSwitch, onRename, onDelete, onExport }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sessionTitle(session));
  const [confirming, setConfirming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const save = async () => {
    const title = draft.trim();
    if (!title || title === sessionTitle(session)) { setEditing(false); return; }
    setBusy(true);
    const ok = await onRename(title);
    setBusy(false);
    if (ok) setEditing(false);
  };

  const remove = async () => {
    setBusy(true);
    const ok = await onDelete();
    setBusy(false);
    if (ok) setConfirming(false);
  };

  const time = formatRelative(session.updatedAt);
  const model = modelLabelOf(session);
  const tokens = session.tokens?.input || session.tokens?.output
    ? (session.tokens.input ?? 0) + (session.tokens.output ?? 0)
    : null;

  return (
    <li data-testid="session-row" data-active={active || undefined} className={'relative rounded-[var(--r-inner)] border ' + (active ? 'border-[var(--accent)]/35 bg-[var(--accent)]/[0.06]' : 'border-transparent hover:border-[var(--line)]')}>
      {editing ? (
        <form
          className="flex min-h-11 flex-wrap items-center gap-2 p-1.5"
          onSubmit={event => { event.preventDefault(); void save(); }}
        >
          <label className="sr-only" htmlFor={'rename-' + session.sessionId}>Chat title</label>
          <input
            id={'rename-' + session.sessionId}
            ref={inputRef}
            value={draft}
            maxLength={120}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setEditing(false); } }}
            className="min-h-11 min-w-0 flex-1 rounded-[var(--r-btn)] border border-[var(--line-strong)] bg-[#18181b] px-2 text-[13px] text-[var(--text-1)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          />
          <button type="submit" disabled={busy || !draft.trim()} className={panelPrimaryButton}>Save</button>
          <button type="button" disabled={busy} onClick={() => setEditing(false)} className={panelButton}>Cancel</button>
        </form>
      ) : confirming ? (
        <div className="flex min-h-11 flex-wrap items-center gap-2 p-1.5">
          <p className="st-meta min-w-0 flex-1 text-[var(--text-2)]">Delete “{sessionTitle(session)}”? This removes it from the server.</p>
          <button type="button" disabled={busy} onClick={() => void remove()} className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] border border-[var(--danger)]/40 px-3 font-semibold text-[#fca5a5] transition-colors hover:bg-[var(--danger)]/10 disabled:opacity-40">
            Delete
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={panelButton}>Cancel</button>
        </div>
      ) : (
        <div className="flex min-h-11 items-stretch gap-0.5 p-1">
          <button
            type="button"
            onClick={onSwitch}
            aria-current={active ? 'true' : undefined}
            className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center rounded-[var(--r-btn)] px-2 py-1 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            <span className="flex w-full min-w-0 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-[var(--text-1)]">{sessionTitle(session)}</span>
              {active && <Badge tone="accent">Current</Badge>}
            </span>
            <span className="st-meta flex w-full min-w-0 items-center gap-1.5 text-[var(--text-3)]">
              {time && <span className="shrink-0">{time}</span>}
              {model && <><span aria-hidden="true" className="shrink-0">·</span><span className="truncate">{model}</span></>}
              {tokens !== null && <><span aria-hidden="true" className="shrink-0">·</span><span className="st-tnum shrink-0">{tokens.toLocaleString('en-IN')} tokens</span></>}
            </span>
          </button>
          <div ref={menuRef} className="relative shrink-0">
            <button
              type="button"
              aria-label={'Actions for ' + sessionTitle(session)}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(value => !value)}
              className={rowActionClass}
            >
              <span aria-hidden="true" className="text-[16px] leading-none">⋯</span>
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 top-full z-10 mt-1 w-[190px] rounded-[var(--r-inner)] border border-[var(--line-strong)] bg-[#202024] p-1 shadow-[0_12px_30px_rgba(0,0,0,0.45)]">
                <button type="button" role="menuitem" data-testid="session-rename" onClick={() => { setMenuOpen(false); setDraft(sessionTitle(session)); setEditing(true); }} className="flex min-h-11 w-full items-center gap-2 rounded-[var(--r-btn)] px-2 text-left text-[13px] text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)]">
                  <Pencil size={14} aria-hidden="true" /> Rename
                </button>
                <button type="button" role="menuitem" data-testid="export-session" onClick={() => { setMenuOpen(false); onExport('md'); }} className="flex min-h-11 w-full items-center gap-2 rounded-[var(--r-btn)] px-2 text-left text-[13px] text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)]">
                  <Download size={14} aria-hidden="true" /> Export Markdown
                </button>
                <button type="button" role="menuitem" data-testid="export-session-json" onClick={() => { setMenuOpen(false); onExport('json'); }} className="flex min-h-11 w-full items-center gap-2 rounded-[var(--r-btn)] px-2 text-left text-[13px] text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)]">
                  <Download size={14} aria-hidden="true" /> Export JSON
                </button>
                <button type="button" role="menuitem" data-testid="session-delete" onClick={() => { setMenuOpen(false); setConfirming(true); }} className="flex min-h-11 w-full items-center gap-2 rounded-[var(--r-btn)] px-2 text-left text-[13px] text-[#fca5a5] hover:bg-[var(--danger)]/10">
                  <Trash2 size={14} aria-hidden="true" /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </li>
  );
};

export const SessionHistoryPanel: React.FC<SessionHistoryPanelProps> = ({
  sessions,
  activeSessionId,
  activeSession,
  loading,
  error,
  query,
  onQueryChange,
  onRetry,
  onNewChat,
  onSwitch,
  onRename,
  onDelete,
  onExport,
  status,
}) => {
  const active = activeSessionId ? sessions.find(session => session.sessionId === activeSessionId) ?? activeSession ?? null : null;
  const others = sessions.filter(session => session.sessionId !== activeSessionId);
  const searching = query.trim().length > 0;

  return (
    <div className="flex min-h-full flex-col">
      <div className="space-y-2">
        <button type="button" onClick={onNewChat} data-testid="new-chat" className={panelPrimaryButton + ' w-full'}>
          <MessageSquarePlus size={15} aria-hidden="true" /> New chat
        </button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-3)]" aria-hidden="true" />
          <label htmlFor="chat-history-search" className="sr-only">Search conversations</label>
          <input
            id="chat-history-search"
            data-testid="history-search"
            type="search"
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            placeholder="Search conversations"
            autoComplete="off"
            className="min-h-11 w-full rounded-[var(--r-btn)] border border-[var(--line-strong)] bg-[#18181b] pl-9 pr-10 text-[13px] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onQueryChange('')}
              className="absolute right-0.5 top-1/2 inline-flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-[var(--r-btn)] text-[var(--text-3)] hover:text-[var(--text-1)]"
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {status && <p role="status" className="st-meta mt-2 text-[var(--text-3)]">{status}</p>}
      {error && (
        <div role="alert" className="mt-2 rounded-[var(--r-inner)] border border-[var(--danger)]/30 bg-[var(--danger)]/[0.06] px-3 py-2">
          <p className="st-meta text-[#fca5a5]">{error}</p>
          <button type="button" onClick={onRetry} className={panelButton + ' mt-2'}>Try again</button>
        </div>
      )}

      <div className="mt-4 min-h-0 flex-1">
        {active && (
          <section aria-label="Current chat" className="mb-4">
            <h3 className="st-label mb-1 px-1 text-[var(--text-3)]">Current chat</h3>
            <ul className="space-y-1">
              <SessionRow
                session={active}
                active
                onSwitch={() => onSwitch(active.sessionId)}
                onRename={title => onRename(active.sessionId, title)}
                onDelete={() => onDelete(active.sessionId)}
                onExport={format => onExport(active.sessionId, format)}
              />
            </ul>
          </section>
        )}

        <section aria-label="Earlier chats">
          {active && <h3 className="st-label mb-1 px-1 text-[var(--text-3)]">{searching ? 'Matches' : 'Earlier chats'}</h3>}
          {loading && <p className="st-meta px-1 py-2 text-[var(--text-3)]">Loading conversations…</p>}
          {!loading && !others.length && (
            <p className="st-meta px-1 py-3 text-[var(--text-3)]">
              {searching ? 'No conversations match' : 'No earlier conversations yet.'}
            </p>
          )}
          <ul className="space-y-1">
            {others.map(session => (
              <SessionRow
                key={session.sessionId}
                session={session}
                active={false}
                onSwitch={() => onSwitch(session.sessionId)}
                onRename={title => onRename(session.sessionId, title)}
                onDelete={() => onDelete(session.sessionId)}
                onExport={format => onExport(session.sessionId, format)}
              />
            ))}
          </ul>
        </section>

        {!active && !loading && !others.length && !searching && !error && (
          <div className="mt-4 rounded-[var(--r-inner)] border border-dashed border-[var(--line)] px-3 py-4">
            <p className="st-meta flex items-center gap-2 text-[var(--text-3)]">
              <Plus size={14} aria-hidden="true" /> Start a chat and it will appear here, saved on the server.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
