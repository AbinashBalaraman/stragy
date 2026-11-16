import React from 'react';

interface Props {
  symbol: string;
  price?: number | null;
  changePercent?: number | null;
  loading?: boolean;
  className?: string;
}

const priceText = (price: number) => '₹' + price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Inline ticker with a stable price slot: the chip keeps its width while a
 * quote is loading instead of reflowing the sentence around it.
 */
export const TickerChip: React.FC<Props> = ({ symbol, price, changePercent, loading = false, className = '' }) => {
  const hasPrice = typeof price === 'number' && Number.isFinite(price);
  return (
    <span
      className={'inline-flex items-center gap-1.5 rounded-[6px] bg-[var(--surface-2)] px-1.5 py-0.5 align-baseline ' + className}
      aria-busy={loading || undefined}
      title={loading ? 'Quote loading' : undefined}
    >
      <span className="st-meta font-semibold text-[var(--text-1)]">{symbol}</span>
      <span className="st-meta st-tnum inline-block min-w-[4.75rem] text-right text-[var(--text-2)]">
        {hasPrice ? priceText(price) : loading ? 'LTP …' : '—'}
      </span>
      {(typeof changePercent === 'number' || loading) && (
        <span className={'st-meta st-tnum inline-block min-w-[3rem] text-right ' + (changePercent === undefined || changePercent === null ? 'text-[var(--text-3)]' : changePercent >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]')}>
          {typeof changePercent === 'number' ? (changePercent >= 0 ? '+' : '') + changePercent.toFixed(2) + '%' : loading ? '—' : ''}
        </span>
      )}
    </span>
  );
};
