import React, { useEffect, useRef, useState } from 'react';
import { BookMarked, ChartNoAxesCombined, KeyRound, Menu, MessageSquare, Plus, Radio, Sparkles, X } from 'lucide-react';

export type AppView = 'chat' | 'builder' | 'results' | 'scanner' | 'library' | 'settings';

interface Props {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  onNewChat: () => void;
  dataMode: 'real' | 'demo' | 'unknown';
  /** Only set `connected` after an actual Angel One quote has arrived. */
  liveQuotes?: { connected: boolean; provider: 'angel' | null; loading?: boolean; failed?: boolean };
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const dataModeCopy = {
  real: 'Observed public daily data · delayed, not live',
  demo: 'Demo research · generated bars, not observed',
  unknown: 'Research only · data source not confirmed',
};

const viewLabel: Record<AppView, string> = {
  chat: 'Chat',
  builder: 'Strategy tester',
  results: 'Backtest results',
  scanner: 'Market scanner',
  library: 'Saved strategies',
  settings: 'AI providers',
};

/** Rail order is fixed by the owner: chat, then the research tools, then settings. */
const primaryViews = [
  { view: 'chat' as const, label: 'Chat', icon: MessageSquare },
  { view: 'scanner' as const, label: 'Market scanner', icon: Radio },
  { view: 'builder' as const, label: 'Strategy tester', icon: Sparkles },
  { view: 'results' as const, label: 'Backtest results', icon: ChartNoAxesCombined },
  { view: 'library' as const, label: 'Saved strategies', icon: BookMarked },
];

const NavItems: React.FC<{
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  onNewChat: () => void;
}> = ({ activeView, onNavigate, onNewChat }) => {
  const itemClass = (active: boolean) =>
    `flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm ${active ? 'bg-white/[0.08] text-neutral-100' : 'text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200'}`;
  return (
    <nav aria-label="Primary" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pb-2 pr-0.5">
      <button
        type="button"
        onClick={onNewChat}
        className="flex items-center gap-2.5 rounded-xl border border-[var(--line)] px-3 py-2.5 text-left text-sm font-medium text-[var(--text-1)] transition-colors hover:border-[var(--line-strong)] hover:bg-white/[0.04]"
      >
        <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
        New chat
      </button>
      {primaryViews.map(item => {
        const Icon = item.icon;
        return (
          <button
            key={item.view}
            type="button"
            onClick={() => onNavigate(item.view)}
            aria-current={activeView === item.view ? 'page' : undefined}
            className={itemClass(activeView === item.view)}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {item.label}
          </button>
        );
      })}
      <div className="mt-auto space-y-1 border-t border-white/8 pt-3">
        <p className="px-3 text-[11px] text-[var(--text-3)]">Settings</p>
        <button
          type="button"
          onClick={() => onNavigate('settings')}
          aria-current={activeView === 'settings' ? 'page' : undefined}
          className={'w-full ' + itemClass(activeView === 'settings')}
        >
          <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
          AI providers
        </button>
      </div>
    </nav>
  );
};

/**
 * A quiet, responsive shell. Chat is the product; the research tools sit in the
 * rail as equals, and settings stays at the bottom above the data-status footer.
 */
export const AppShell: React.FC<Props> = ({ activeView, onNavigate, onNewChat, dataMode, liveQuotes, children, footer }) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const closeDrawer = () => setDrawerOpen(false);
  const navigate = (view: AppView) => {
    onNavigate(view);
    setDrawerOpen(false);
  };
  const newChat = () => {
    onNewChat();
    setDrawerOpen(false);
  };

  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const restoreTo = previous && previous !== document.body && document.contains(previous) ? previous : triggerRef.current;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = drawerRef.current;
    const focusable = () => panel
      ? Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      : [];
    focusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDrawerOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = originalOverflow;
      restoreTo?.focus();
    };
  }, [drawerOpen]);

  const modeTone = dataMode === 'real'
    ? 'text-emerald-300/80'
    : dataMode === 'demo'
      ? 'text-amber-300/80'
      : 'text-neutral-500';

  const live = dataMode === 'real' && liveQuotes?.connected === true;
  // Before the first quote result we know nothing about the broker: do not claim
  // "delayed, not live", which reads as a settled statement about the data.
  const checkingQuotes = dataMode === 'real' && liveQuotes?.loading === true && !live;
  // A failed check is not "delayed daily data"; never claim a source that did not answer.
  const quotesFailed = dataMode === 'real' && liveQuotes?.failed === true && !live && !checkingQuotes;
  const liveProvider = liveQuotes?.provider === 'angel' ? 'Angel One' : 'broker';
  const statusFooter = live ? (
    <p className="flex items-center gap-1.5 text-[11px] leading-4 text-emerald-300/90">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      Live quotes · {liveProvider}
    </p>
  ) : checkingQuotes ? (
    <p role="status" className="text-[11px] leading-4 text-neutral-400">Checking quotes…</p>
  ) : quotesFailed ? (
    <p role="status" className="text-[11px] leading-4 text-[#f5d383]">Quotes unavailable · retrying</p>
  ) : (
    <p className={`text-[11px] leading-4 ${modeTone}`}>{dataModeCopy[dataMode]}</p>
  );

  return (
    <div className="flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-[#101012] text-neutral-200">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/8 px-3 lg:hidden">
        <button
          ref={triggerRef}
          type="button"
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          aria-controls="mobile-navigation"
          onClick={() => setDrawerOpen(true)}
          className="rounded-lg p-2 text-neutral-300 hover:bg-white/5"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => navigate('chat')} className="text-sm font-semibold tracking-tight text-neutral-100">
          Stragy
        </button>
        <div className="ml-auto flex items-center gap-2">
          {activeView !== 'chat' && <span className="text-[11px] text-[var(--text-3)]">{viewLabel[activeView]}</span>}
          <button type="button" onClick={newChat} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-white/5">
            New chat
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside aria-label="Workspace navigation" className="hidden w-60 shrink-0 flex-col border-r border-white/8 bg-[#131315] px-3 py-4 lg:flex">
          <button type="button" onClick={() => navigate('chat')} className="mb-6 flex items-center gap-2 px-2 text-left">
            <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-[13px] font-semibold text-neutral-100">S</span>
            <span className="text-sm font-semibold tracking-tight text-neutral-100">Stragy</span>
          </button>
          <NavItems
            activeView={activeView}
            onNavigate={navigate}
            onNewChat={newChat}
          />
          <div className="mt-auto space-y-2 px-2 pt-6">
            {statusFooter}
            <p className="text-[10px] leading-4 text-[var(--text-3)]">Backtests use daily bars</p>
            {footer && <div className="text-[11px] leading-4 text-[var(--text-3)]">{footer}</div>}
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close navigation overlay" onClick={closeDrawer} className="absolute inset-0 h-full w-full cursor-default bg-black/60" tabIndex={-1} />
          <div
            ref={drawerRef}
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="absolute inset-y-0 left-0 flex w-[min(19rem,88vw)] flex-col border-r border-white/10 bg-[#151517] px-4 py-4 shadow-2xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <span className="text-sm font-semibold tracking-tight text-neutral-100">Stragy</span>
              <button type="button" aria-label="Close navigation" onClick={closeDrawer} className="rounded-lg p-2 text-neutral-400 hover:bg-white/5 hover:text-neutral-100">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <NavItems
              activeView={activeView}
              onNavigate={navigate}
              onNewChat={newChat}
            />
            <div className="shrink-0 space-y-2 border-t border-white/8 pt-3 text-[11px] text-[var(--text-3)]">
              {statusFooter}
              <p className="text-[10px] leading-4 text-[var(--text-3)]">Backtests use daily bars</p>
              {footer}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
