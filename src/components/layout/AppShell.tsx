import React, { useEffect, useRef, useState } from 'react';
import { BookMarked, ChartNoAxesCombined, ChevronDown, Menu, MessageSquare, Plus, Radio, Settings2, Sparkles, X } from 'lucide-react';

export type AppView = 'chat' | 'builder' | 'results' | 'scanner' | 'library';

interface Props {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  onNewChat: () => void;
  dataMode: 'real' | 'demo' | 'unknown';
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
  builder: 'Builder',
  results: 'Analytics',
  scanner: 'Scanner',
  library: 'Saved strategies',
};

const NavItems: React.FC<{
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  onNewChat: () => void;
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
  idPrefix: string;
}> = ({ activeView, onNavigate, onNewChat, advancedOpen, onAdvancedOpenChange, idPrefix }) => {
  const advanced = [
    { view: 'builder' as const, label: 'Strategy builder', icon: Sparkles },
    { view: 'scanner' as const, label: 'Market scanner', icon: Radio },
    { view: 'results' as const, label: 'Backtest analytics', icon: ChartNoAxesCombined },
  ];
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onNewChat}
        className="flex items-center gap-2.5 rounded-xl bg-white/[0.06] px-3 py-2.5 text-left text-sm font-medium text-neutral-100 hover:bg-white/[0.1]"
      >
        <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
        New chat
      </button>
      <button
        type="button"
        onClick={() => onNavigate('chat')}
        aria-current={activeView === 'chat' ? 'page' : undefined}
        className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm ${activeView === 'chat' ? 'bg-white/[0.08] text-neutral-100' : 'text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200'}`}
      >
        <MessageSquare className="h-4 w-4 shrink-0" aria-hidden="true" />
        Conversation
      </button>
      <button
        type="button"
        onClick={() => onNavigate('library')}
        aria-current={activeView === 'library' ? 'page' : undefined}
        className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm ${activeView === 'library' ? 'bg-white/[0.08] text-neutral-100' : 'text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200'}`}
      >
        <BookMarked className="h-4 w-4 shrink-0" aria-hidden="true" />
        Saved strategies
      </button>

      <button
        type="button"
        id={idPrefix + '-advanced-tools'}
        aria-expanded={advancedOpen}
        aria-controls={idPrefix + '-advanced-tools-panel'}
        onClick={() => onAdvancedOpenChange(!advancedOpen)}
        className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium text-neutral-500 hover:text-neutral-300"
      >
        <Settings2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Advanced tools
        <ChevronDown className={'ml-auto h-3.5 w-3.5 transition-transform ' + (advancedOpen ? 'rotate-180' : '')} aria-hidden="true" />
      </button>
      {advancedOpen && (
        <div id={idPrefix + '-advanced-tools-panel'} role="group" aria-label="Advanced tools" className="space-y-0.5 pl-2">
          {advanced.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.view}
                type="button"
                onClick={() => onNavigate(item.view)}
                aria-current={activeView === item.view ? 'page' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${activeView === item.view ? 'bg-white/[0.08] text-neutral-100' : 'text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200'}`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </nav>
  );
};

/**
 * A quiet, responsive shell. Chat is the product; builder/scanner/analytics live
 * behind an explicit Advanced tools disclosure and remain fully reachable.
 */
export const AppShell: React.FC<Props> = ({ activeView, onNavigate, onNewChat, dataMode, children, footer }) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [drawerAdvancedOpen, setDrawerAdvancedOpen] = useState(false);
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
        <span className="ml-auto text-[11px] text-neutral-500">{viewLabel[activeView]}</span>
        <button type="button" onClick={newChat} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-white/5">
          New chat
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside aria-label="Workspace navigation" className="hidden w-60 shrink-0 flex-col border-r border-white/8 bg-[#131315] px-3 py-4 lg:flex">
          <button type="button" onClick={() => navigate('chat')} className="mb-6 flex items-center gap-2 px-2 text-left">
            <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-[13px] font-semibold text-neutral-100">S</span>
            <span>
              <span className="block text-sm font-semibold tracking-tight text-neutral-100">Stragy</span>
              <span className="block text-[10px] uppercase tracking-[0.18em] text-neutral-500">Research chat</span>
            </span>
          </button>
          <NavItems
            activeView={activeView}
            onNavigate={navigate}
            onNewChat={newChat}
            advancedOpen={advancedOpen}
            onAdvancedOpenChange={setAdvancedOpen}
            idPrefix="desktop"
          />
          <div className="mt-auto space-y-3 px-2 pt-6">
            <p className={`text-[11px] leading-4 ${modeTone}`}>{dataModeCopy[dataMode]}</p>
            {footer && <div className="text-[11px] leading-4 text-neutral-500">{footer}</div>}
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
              advancedOpen={drawerAdvancedOpen}
              onAdvancedOpenChange={setDrawerAdvancedOpen}
              idPrefix="mobile"
            />
            <div className="mt-auto space-y-2 pt-6 text-[11px] text-neutral-500">
              <p className={modeTone}>{dataModeCopy[dataMode]}</p>
              {footer}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
