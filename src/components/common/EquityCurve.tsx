import React from 'react';

interface Props {
  values: number[];
  /** Three axis labels: start, middle, end. Defaults to the values themselves. */
  labels?: [string, string, string];
  ariaLabel: string;
  height?: number;
  className?: string;
}

const money = (value: number) => '₹' + value.toLocaleString('en-IN', { maximumFractionDigits: 0 });

/** A 120px equity curve: accent line, 6% fill, start/mid/end labels. Inline SVG. */
export const EquityCurve: React.FC<Props> = ({ values, labels, ariaLabel, height = 120, className = '' }) => {
  if (values.length < 2) return null;
  const width = 100;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = (high - low || 1) * 0.12;
  const min = low - padding;
  const max = high + padding;
  const span = max - min || 1;
  const pad = 4;
  const padX = 1.5;
  const points = values.map((value, index) => {
    const x = padX + (index / (values.length - 1)) * (width - padX * 2);
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const baselineY = height - pad - ((values[0] - min) / span) * (height - pad * 2);
  const line = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${padX},${height} ${line} ${width - padX},${height}`;
  const mid = values[Math.floor(values.length / 2)];
  const axis = labels ?? [money(values[0]), money(mid), money(values[values.length - 1])];

  return (
    <figure className={className}>
      <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }}>
        <line x1="0" y1={baselineY} x2={width} y2={baselineY} stroke="var(--line-strong)" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        <polygon points={area} fill="var(--accent)" opacity="0.06" />
        <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="st-meta mt-1 flex justify-between gap-3 text-[var(--text-3)]">
        <span className="st-tnum">{axis[0]}</span>
        <span className="st-tnum">{axis[1]}</span>
        <span className="st-tnum">{axis[2]}</span>
      </figcaption>
    </figure>
  );
};
