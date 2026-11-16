import React from 'react';
import { ChevronRight } from 'lucide-react';

interface Props {
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

/** Native disclosure: 36px summary row, chevron, surface-2 body, no borders. */
export const Disclosure: React.FC<Props> = ({ summary, children, defaultOpen = false, className = '' }) => (
  <details className={'group rounded-[var(--r-inner)] ' + className} open={defaultOpen}>
    <summary className="st-meta flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 py-1.5 text-[var(--text-2)] [&::-webkit-details-marker]:hidden">
      <span className="min-w-0">{summary}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-3)] transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />
    </summary>
    <div className="st-meta mt-1 rounded-[var(--r-inner)] bg-[var(--surface-2)] px-3 py-2 leading-5 text-[var(--text-2)]">
      {children}
    </div>
  </details>
);
