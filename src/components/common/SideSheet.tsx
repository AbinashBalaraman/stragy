import React, { useEffect, useId, useRef } from 'react';
import { Maximize2, X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** "Open full page" keeps the existing route when the sheet closes. */
  onOpenFullPage?: () => void;
  fullPageLabel?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * A right-hand sheet on >=1024px and a full-screen sheet below it. It keeps
 * the conversation in place while a large result is inspected.
 */
export const SideSheet: React.FC<Props> = ({ open, onClose, title, onOpenFullPage, fullPageLabel = 'Open full page', children, footer }) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const restoreTo = previous && previous !== document.body && document.contains(previous) ? previous : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    const focusable = () => panel
      ? Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      : [];
    panel?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
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
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        aria-label="Close sheet"
        onClick={onClose}
        tabIndex={-1}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute inset-0 flex flex-col border-[var(--line)] bg-[#101012] shadow-2xl shadow-black/50 outline-none lg:left-auto lg:inset-y-0 lg:right-0 lg:w-[min(760px,92vw)] lg:border-l"
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--line)] px-4">
          <h2 id={titleId} className="st-title min-w-0 flex-1 truncate font-semibold text-[var(--text-1)]">{title}</h2>
          {onOpenFullPage && (
            <button
              type="button"
              onClick={onOpenFullPage}
              className="st-meta inline-flex min-h-9 items-center gap-1.5 rounded-[var(--r-btn)] border border-[var(--line)] px-2.5 py-1 text-[var(--text-2)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--text-1)]"
            >
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
              {fullPageLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--r-btn)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-1)] lg:h-9 lg:w-9"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </div>
        {footer && <div className="shrink-0 border-t border-[var(--line)] px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
};
