import React, { useState } from 'react';

export interface SourceItem {
  label: string;
  href?: string;
  title?: string;
}

interface Props {
  sources: SourceItem[];
  max?: number;
  className?: string;
}

const chipClass = 'st-meta inline-flex min-h-6 shrink-0 items-center gap-1.5 rounded-[var(--r-pill)] bg-[var(--surface-2)] px-2 py-0.5 text-[var(--text-2)] transition-colors hover:text-[var(--text-1)]';

/** Link chips for citations: max 5 visible, the chip row alone may scroll. */
export const Sources: React.FC<Props> = ({ sources, max = 5, className = '' }) => {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? sources : sources.slice(0, max);
  const hidden = sources.length - visible.length;
  if (!sources.length) return null;
  return (
    <div className={'flex max-w-full items-center gap-1.5 overflow-x-auto ' + className} aria-label="Sources">
      {visible.map(source => source.href ? (
        <a
          key={source.label + source.href}
          href={source.href}
          target="_blank"
          rel="noreferrer"
          title={source.title ?? source.href}
          className={chipClass}
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          {source.label}
        </a>
      ) : (
        <span key={source.label} title={source.title} className={chipClass}>
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--text-3)]" />
          {source.label}
        </span>
      ))}
      {hidden > 0 && (
        <button type="button" onClick={() => setExpanded(true)} className={chipClass} aria-label={`Show ${hidden} more sources`}>
          +{hidden}
        </button>
      )}
    </div>
  );
};
