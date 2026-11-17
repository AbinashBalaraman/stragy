import React, { useId, useState } from 'react';

export interface DataColumn<T> {
  key: string;
  header: string;
  /** First column is sticky by default; set false for a deliberate exception. */
  sticky?: boolean;
  /** Hide this column below 640px; repeat its value in the first cell for touch. */
  hideOnMobile?: boolean;
  align?: 'left' | 'right';
  render: (row: T) => React.ReactNode;
  className?: string;
}

interface Props<T> {
  caption: string;
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** Inline row cap before "Show all N". Default 8 (research §2.4). */
  initialLimit?: number;
  /**
   * Below 640px, pin the last column to the right edge so a row action stays
   * reachable while the wide data columns scroll under it.
   */
  stickyLastColumn?: boolean;
  /** Below 640px, let the table shrink to the card width instead of scrolling at 560px. */
  fitMobile?: boolean;
  empty?: string;
  className?: string;
}

/**
 * A real table for homogeneous rows: caption, scoped headers, a focusable
 * horizontal scroll region and a sticky first column. Wide data scrolls inside
 * this region, never the page.
 */
export function DataTable<T>({ caption, columns, rows, rowKey, initialLimit = 8, empty = 'No rows.', stickyLastColumn = false, fitMobile = false, className = '' }: Props<T>) {
  const [showAll, setShowAll] = useState(false);
  const captionId = useId();
  const visible = showAll ? rows : rows.slice(0, initialLimit);

  if (!rows.length) {
    return <p className="st-meta rounded-[var(--r-inner)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text-3)]">{empty}</p>;
  }

  return (
    <div className={className}>
      <div
        role="region"
        aria-label={caption}
        aria-describedby={captionId}
        tabIndex={0}
        className={'st-scroll-x overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ' + (stickyLastColumn || fitMobile ? '' : 'st-fade-right')}
      >
        <table className={'st-tnum w-full border-collapse text-left ' + (fitMobile ? 'min-w-0 sm:min-w-[560px]' : 'min-w-[560px]')}>
          <caption id={captionId} className="sr-only">{caption}</caption>
          <thead>
            <tr className="bg-[var(--surface-2)]">
              {columns.map((column, index) => {
                const sticky = column.sticky ?? index === 0;
                const stickyLast = stickyLastColumn && index === columns.length - 1 && columns.length > 1;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={
                      'text-[11px] whitespace-nowrap px-3 py-2 font-medium text-[var(--text-3)] ' +
                      (column.align === 'right' ? 'text-right ' : 'text-left ') +
                      (sticky ? 'sticky left-0 z-10 border-r border-[var(--line)] bg-[var(--surface-2)] ' : '') +
                      (column.hideOnMobile ? 'max-sm:hidden ' : '') +
                      (stickyLast ? 'max-sm:sticky max-sm:right-0 max-sm:z-20 max-sm:border-l max-sm:border-[var(--line)] max-sm:bg-[var(--surface-2)] max-sm:shadow-[-8px_0_12px_-8px_rgba(0,0,0,0.55)] ' : '') +
                      (column.className ?? '')
                    }
                  >
                    {column.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, rowIndex) => (
              <tr key={rowKey(row, rowIndex)} className="border-t border-[var(--line)] transition-colors hover:bg-[var(--surface-hover)]">
                {columns.map((column, index) => {
                  const sticky = column.sticky ?? index === 0;
                  const stickyLast = stickyLastColumn && index === columns.length - 1 && columns.length > 1;
                  const content = column.render(row);
                  const cellClass =
                    'st-table-text px-3 py-2 align-middle ' +
                    (column.align === 'right' ? 'text-right st-tnum ' : 'text-left ') +
                    (sticky ? 'sticky left-0 z-[1] border-r border-[var(--line)] bg-[var(--surface-1)] ' : '') +
                    (column.hideOnMobile ? 'max-sm:hidden ' : '') +
                    (stickyLast ? 'max-sm:sticky max-sm:right-0 max-sm:z-[1] max-sm:border-l max-sm:border-[var(--line)] max-sm:bg-[var(--surface-1)] max-sm:shadow-[-8px_0_12px_-8px_rgba(0,0,0,0.55)] ' : '') +
                    (column.className ?? '');
                  return index === 0 ? (
                    <th key={column.key} scope="row" className={cellClass + ' font-normal text-[var(--text-1)]'}>{content}</th>
                  ) : (
                    <td key={column.key} className={cellClass + ' text-[var(--text-2)]'}>{content}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > initialLimit && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => setShowAll(value => !value)}
            aria-expanded={showAll}
            className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] border border-[var(--line)] px-2.5 py-1 text-[var(--text-2)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--text-1)] sm:min-h-8"
          >
            {showAll ? 'Show fewer' : `Show all ${rows.length}`}
          </button>
        </div>
      )}
    </div>
  );
}
