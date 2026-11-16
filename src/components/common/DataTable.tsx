import React, { useId, useState } from 'react';

export interface DataColumn<T> {
  key: string;
  header: string;
  /** First column is sticky by default; set false for a deliberate exception. */
  sticky?: boolean;
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
  empty?: string;
  className?: string;
}

/**
 * A real table for homogeneous rows: caption, scoped headers, a focusable
 * horizontal scroll region and a sticky first column. Wide data scrolls inside
 * this region, never the page.
 */
export function DataTable<T>({ caption, columns, rows, rowKey, initialLimit = 8, empty = 'No rows.', className = '' }: Props<T>) {
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
        className="st-scroll-x overflow-x-auto st-fade-right focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
      >
        <table className="w-full min-w-[560px] border-collapse text-left">
          <caption id={captionId} className="sr-only">{caption}</caption>
          <thead>
            <tr className="bg-[var(--surface-2)]">
              {columns.map((column, index) => {
                const sticky = column.sticky ?? index === 0;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={
                      'st-label whitespace-nowrap px-3 py-2 font-medium text-[var(--text-3)] ' +
                      (column.align === 'right' ? 'text-right ' : 'text-left ') +
                      (sticky ? 'sticky left-0 z-10 border-r border-[var(--line)] bg-[var(--surface-2)] ' : '') +
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
                  const content = column.render(row);
                  const cellClass =
                    'st-table-text px-3 py-2 align-middle ' +
                    (column.align === 'right' ? 'text-right st-tnum ' : 'text-left ') +
                    (sticky ? 'sticky left-0 z-[1] border-r border-[var(--line)] bg-[var(--surface-1)] ' : '') +
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
            className="st-meta rounded-[var(--r-btn)] border border-[var(--line)] px-2.5 py-1 text-[var(--text-2)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--text-1)]"
          >
            {showAll ? 'Show fewer' : `Show all ${rows.length}`}
          </button>
        </div>
      )}
    </div>
  );
}
