import React from 'react';

export type CardTone = 'default' | 'review' | 'warn';
export type CardState = 'idle' | 'pending' | 'partial' | 'error';
export type CardDensity = 'compact' | 'default' | 'comfortable';

interface Props {
  title: string;
  /** Optional context above the title, 11px uppercase. Use sparingly. */
  eyebrow?: string;
  tone?: CardTone;
  state?: CardState;
  density?: CardDensity;
  /** One short meta line under the title. */
  meta?: React.ReactNode;
  /** Chip content; the shell renders exactly one chip with role="status". */
  status?: React.ReactNode;
  /** Footer actions, max two. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

const toneClass: Record<CardTone, string> = {
  default: 'border-[var(--line)]',
  review: 'border-[#a8c7fa]/35',
  warn: 'border-[var(--warn)]/35',
};

const densityClass: Record<CardDensity, { header: string; body: string; footer: string; gap: string }> = {
  compact: { header: 'px-3 pt-3', body: 'px-3 py-2', footer: 'px-3 py-2', gap: 'space-y-2' },
  default: { header: 'px-4 pt-4', body: 'px-4 py-4', footer: 'px-4 py-3', gap: 'space-y-5' },
  comfortable: { header: 'px-5 pt-5', body: 'px-5 py-5', footer: 'px-5 py-3', gap: 'space-y-6' },
};

const stateStatus: Record<Exclude<CardState, 'idle'>, string> = {
  pending: 'In progress',
  partial: 'Partial results',
  error: 'Could not complete',
};

const stateChip: Record<Exclude<CardState, 'idle'>, string> = {
  pending: 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-3)]',
  partial: 'border-[var(--warn)]/30 bg-[var(--warn)]/[0.08] text-[#f5d383]',
  error: 'border-[var(--danger)]/30 bg-[var(--danger)]/[0.08] text-[#fca5a5]',
};

/**
 * The one card shell. Variants are a single tone tint, never a new border
 * system; inner sections are spacing or surface-2 blocks, not nested boxes.
 */
export const CardShell: React.FC<Props> = ({
  title,
  eyebrow,
  tone = 'default',
  state = 'idle',
  density = 'default',
  meta,
  status,
  footer,
  children,
  className = '',
}) => {
  const titleId = React.useId();
  const chip = status ?? (state === 'idle' ? null : stateStatus[state]);
  const spacing = densityClass[density];
  return (
    <section
      aria-labelledby={titleId}
      aria-busy={state === 'pending' || undefined}
      className={`st-card-surface ${toneClass[tone]} ${className}`}
    >
      <header className={spacing.header}>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="st-label text-[var(--text-3)]">{eyebrow}</p>}
            <h3 id={titleId} className="st-title line-clamp-2 font-semibold text-[var(--text-1)]">{title}</h3>
            {meta && <div className="st-meta mt-0.5 text-[var(--text-3)]">{meta}</div>}
          </div>
          {chip && state !== 'idle' && (
            <span role="status" className={'st-meta shrink-0 rounded-[var(--r-pill)] border px-2 py-0.5 ' + stateChip[state]}>
              {chip}
            </span>
          )}
          {chip && state === 'idle' && (
            <span role="status" className="st-meta shrink-0 rounded-[var(--r-pill)] border border-[var(--line)] bg-[var(--surface-2)] px-2 py-0.5 text-[var(--text-3)]">
              {chip}
            </span>
          )}
        </div>
      </header>
      <div className={spacing.body + ' ' + spacing.gap}>{children}</div>
      {footer && <footer className={spacing.footer + ' border-t border-[var(--line)]'}>{footer}</footer>}
    </section>
  );
};
