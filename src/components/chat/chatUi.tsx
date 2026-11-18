import React, { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Shared chrome for the chat management surfaces (history, model, usage,
 * cache, jobs, providers). These are dialogs, so they own Escape, a focus
 * trap and focus restore; the chat underneath keeps its scroll position.
 */

/** Relative time, honest and compact. Never invents a timestamp. */
export function formatRelative(value: string | number | null | undefined, now = Date.now()): string {
  if (value === null || value === undefined) return '';
  const stamp = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(stamp)) return '';
  const diff = now - stamp;
  if (diff < 0) return 'just now';
  if (diff < 45_000) return 'just now';
  if (diff < 3_600_000) return Math.max(1, Math.round(diff / 60_000)) + 'm ago';
  if (diff < 86_400_000) return Math.max(1, Math.round(diff / 3_600_000)) + 'h ago';
  if (diff < 7 * 86_400_000) return Math.max(1, Math.round(diff / 86_400_000)) + 'd ago';
  const date = new Date(stamp);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function formatTokens(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '';
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return (value / 1_000).toFixed(value < 10_000 ? 1 : 0).replace(/\.0$/, '') + 'k';
  return (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

/** Only call with a number the server reported; the UI never estimates cost. */
export function formatUsd(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '';
  if (value === 0) return '$0.00';
  if (value < 0.01) return '$' + value.toFixed(4);
  return '$' + value.toFixed(2);
}

export function formatBytes(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
  if (value < 1_024) return Math.round(value) + ' B';
  if (value < 1_024 * 1_024) return (value / 1_024).toFixed(value < 10 * 1_024 ? 1 : 0) + ' KB';
  if (value < 1_024 * 1_024 * 1_024) return (value / (1_024 * 1_024)).toFixed(1) + ' MB';
  return (value / (1_024 * 1_024 * 1_024)).toFixed(2) + ' GB';
}

export function formatCount(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-IN');
}

/** A small status badge: free, paid, connected. Sentence case, no shouting. */
export const Badge: React.FC<{ tone?: 'neutral' | 'accent' | 'warn' | 'up' | 'down'; children: React.ReactNode }> = ({ tone = 'neutral', children }) => {
  const tones: Record<string, string> = {
    neutral: 'border-[var(--line)] text-[var(--text-3)]',
    accent: 'border-[var(--accent)]/30 text-[var(--accent)]',
    warn: 'border-[var(--warn)]/35 text-[#f5d383]',
    up: 'border-[var(--up)]/30 text-[var(--up)]',
    down: 'border-[var(--down)]/35 text-[var(--down)]',
  };
  return (
    <span className={'inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] leading-3 font-medium tracking-[0.01em] ' + tones[tone]}>
      {children}
    </span>
  );
};

function focusableElements(node: HTMLElement): HTMLElement[] {
  const selector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(node.querySelectorAll<HTMLElement>(selector)).filter(element => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');
}

/**
 * A modal panel with a real focus trap. Used for the mobile slide-over and
 * for the desktop management drawers; Escape closes and focus returns to the
 * control that opened it.
 */
export const SlideOver: React.FC<{
  open: boolean;
  title: string;
  subtitle?: string;
  side?: 'left' | 'right';
  onClose: () => void;
  children: React.ReactNode;
  testId?: string;
}> = ({ open, title, subtitle, side = 'right', onClose, children, testId }) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = panelRef.current;
    const focusables = node ? focusableElements(node) : [];
    (focusables[0] ?? node)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const items = focusableElements(node);
      if (!items.length) { event.preventDefault(); node.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !node.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const frame = side === 'left' ? 'left-0 border-r' : 'right-0 border-l';
  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/55" aria-hidden="true" onClick={() => closeRef.current()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        tabIndex={-1}
        className={'absolute inset-y-0 flex w-full max-w-[380px] flex-col border-[var(--line)] bg-[#141416] shadow-[0_16px_60px_rgba(0,0,0,0.5)] outline-none ' + frame + (side === 'left' ? ' animate-[slide-in-left_180ms_ease-out]' : '')}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-[15px] font-medium leading-6 text-[var(--text-1)]">{title}</h2>
            {subtitle && <p className="st-meta mt-0.5 text-[var(--text-3)]">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label={'Close ' + title}
            onClick={() => closeRef.current()}
            className="-mr-1 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-[var(--r-btn)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
};

/** A labelled number/string for the management panels. No fake values. */
export const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string; wide?: boolean }> = ({ label, value, hint, wide }) => (
  <div className={'min-w-0 py-1.5' + (wide ? ' col-span-2' : '')}>
    <dt className="st-label text-[var(--text-3)]">{label}</dt>
    <dd className="st-tnum mt-0.5 min-w-0 text-[13px] leading-5 text-[var(--text-1)] [overflow-wrap:anywhere]">{value}</dd>
    {hint && <p className="st-meta mt-0.5 text-[var(--text-3)]">{hint}</p>}
  </div>
);

export const PanelSection: React.FC<{ title: string; children: React.ReactNode; meta?: string }> = ({ title, children, meta }) => (
  <section className="border-b border-[var(--line)] pb-4 last:border-0 last:pb-0">
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="st-label text-[var(--text-3)]">{title}</h3>
      {meta && <span className="st-meta text-[var(--text-3)]">{meta}</span>}
    </div>
    <div className="mt-2">{children}</div>
  </section>
);

/** Shared button classes for panel actions; 44px on touch. */
export const panelButton = 'st-meta inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--r-btn)] border border-[var(--line-strong)] px-3 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40';
export const panelPrimaryButton = 'st-meta inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--r-btn)] bg-[var(--accent)] px-3.5 font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40';

export interface MenuOption {
  id: string;
  label: string;
  meta?: string;
  badge?: React.ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * A compact popover menu. Anchored to its trigger on desktop, a sheet on
 * mobile; Escape and outside clicks close it and focus returns to the trigger.
 */
export const PopoverMenu: React.FC<{
  open: boolean;
  label: string;
  onClose: () => void;
  options: MenuOption[];
  footer?: React.ReactNode;
  error?: string;
  loading?: boolean;
  loadingLabel?: string;
  emptyLabel?: string;
}> = ({ open, label, onClose, options, footer, error, loading, loadingLabel, emptyLabel }) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const labelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      const node = panelRef.current;
      const first = node ? focusableElements(node)[0] : null;
      (first ?? node)?.focus();
    }, 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-[55] bg-black/40 sm:bg-transparent" aria-hidden="true" onClick={() => closeRef.current()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={labelId}
        tabIndex={-1}
        className="fixed left-3 right-3 top-20 z-[56] max-h-[min(70vh,520px)] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-[var(--r-card)] border border-[var(--line-strong)] bg-[#1a1a1d] p-2 shadow-[0_16px_50px_rgba(0,0,0,0.55)] outline-none sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[320px]"
      >
        <p id={labelId} className="st-label px-2 py-1.5 text-[var(--text-3)]">{label}</p>
        {error && <p role="alert" className="st-meta mx-1 mb-1 rounded-[var(--r-btn)] bg-[var(--danger)]/10 px-2 py-1.5 text-[#fca5a5]">{error}</p>}
        {loading && <p className="st-meta px-2 py-2 text-[var(--text-3)]">{loadingLabel ?? 'Loading…'}</p>}
        {!loading && !options.length && <p className="st-meta px-2 py-2 text-[var(--text-3)]">{emptyLabel ?? 'Nothing to choose.'}</p>}
        <div role="menu" aria-label={label}>
          {options.map(option => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={option.selected === true}
              disabled={option.disabled}
              onClick={option.onSelect}
              className={'flex min-h-11 w-full items-center gap-2 rounded-[var(--r-btn)] px-2 py-2 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 ' + (option.selected ? 'text-[var(--text-1)]' : 'text-[var(--text-2)]')}
            >
              <span aria-hidden="true" className={'h-1.5 w-1.5 shrink-0 rounded-full ' + (option.selected ? 'bg-[var(--accent)]' : 'bg-transparent')} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] leading-5">{option.label}</span>
                {option.meta && <span className="st-meta block truncate text-[var(--text-3)]">{option.meta}</span>}
              </span>
              {option.badge}
            </button>
          ))}
        </div>
        {footer && <div className="mt-1 border-t border-[var(--line)] px-2 pb-1 pt-2">{footer}</div>}
      </div>
    </>
  );
};

/** Download a text file from an in-memory response; no server URL is exposed. */
export function downloadTextFile(filename: string, content: string, mime: string): boolean {
  try {
    const blob = new Blob([content], { type: mime });
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return true;
  } catch {
    return false;
  }
}

/** Debounce any value; used by the history search box (250 ms). */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Stable callback identity for effect deps without re-running on every render. */
export function useEvent<T extends (...args: never[]) => unknown>(handler: T): T {
  const ref = useRef(handler);
  ref.current = handler;
  return useCallback(((...args: never[]) => ref.current(...args)) as T, []);
}
