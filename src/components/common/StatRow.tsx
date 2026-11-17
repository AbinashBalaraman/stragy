import React from 'react';

export interface Stat {
  label: string;
  value: string;
  /** True renders an em dash instead of a misleading zero. */
  unavailable?: boolean;
  hint?: string;
}

interface Props {
  stats: Stat[];
  /** Desktop columns; mobile is always two. */
  columns?: 2 | 3 | 4;
  className?: string;
}

/** Backtest headline metrics: 3 columns desktop, 2 on mobile, tabular values. */
export const StatRow: React.FC<Props> = ({ stats, columns = 3, className = '' }) => (
  <dl className={'grid grid-cols-2 gap-x-4 gap-y-3 ' + (columns === 4 ? 'sm:grid-cols-4' : columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3') + ' ' + className}>
    {stats.map(stat => (
      <div key={stat.label} className="min-w-0">
        <dt className="text-xs text-[var(--text-3)]">{stat.label}</dt>
        <dd className="st-stat mt-0.5 whitespace-nowrap font-semibold text-[var(--text-1)]" title={stat.hint ?? (stat.unavailable ? 'Not reported for this run' : undefined)}>
          {stat.unavailable ? <span className="text-[var(--text-3)]">—</span> : stat.value}
        </dd>
      </div>
    ))}
  </dl>
);
