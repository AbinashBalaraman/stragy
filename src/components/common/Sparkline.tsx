import React from 'react';

interface Props {
  values: number[];
  /** Adjacent text summary for screen readers and context. */
  summary: string;
  width?: number;
  height?: number;
  tone?: 'accent' | 'up' | 'down';
  className?: string;
}

const toneColor: Record<NonNullable<Props['tone']>, string> = {
  accent: 'var(--accent)',
  up: 'var(--up)',
  down: 'var(--down)',
};

/** A 56px inline trend line: no axes, one dot, no chart library. */
export const Sparkline: React.FC<Props> = ({ values, summary, width = 100, height = 56, tone = 'accent', className = '' }) => {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const padX = 1.5;
  const points = values.map((value, index) => {
    const x = padX + (index / (values.length - 1)) * (width - padX * 2);
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${padX},${height} ${line} ${width - padX},${height}`;
  const [lastX, lastY] = points[points.length - 1];
  const color = toneColor[tone];
  return (
    <div className={className}>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block h-14 w-full"
        focusable="false"
      >
        <polygon points={area} fill={color} opacity="0.08" />
        <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {/* Zero-length round-cap path keeps the dot round under a stretched viewBox. */}
        <path d={`M ${lastX} ${lastY} L ${lastX} ${lastY}`} stroke={color} strokeWidth="4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="st-meta mt-1 text-[var(--text-3)]">{summary}</p>
    </div>
  );
};
