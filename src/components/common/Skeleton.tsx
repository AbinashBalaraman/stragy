import React from 'react';

interface Props {
  /** Bar widths as percentages; defaults to a three-line placeholder. */
  widths?: number[];
  className?: string;
}

/** Decorative loading bars. The card's status chip carries the announcement. */
export const Skeleton: React.FC<Props> = ({ widths = [60, 90, 40], className = '' }) => (
  <div aria-hidden="true" className={'space-y-2 ' + className}>
    {widths.map((width, index) => (
      <div key={index} className="h-3 animate-pulse rounded bg-white/[0.06]" style={{ width: `${Math.max(5, Math.min(100, width))}%` }} />
    ))}
  </div>
);
