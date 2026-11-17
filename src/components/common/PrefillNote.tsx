import React, { useState } from 'react';
import { Disclosure } from './Disclosure';

interface Props {
  /** Assumptions the setup came with; shown behind a disclosure, never as a wall. */
  assumptions?: string[];
  /** Optional origin wording, e.g. "chat". */
  origin?: string;
  onDismiss?: () => void;
}

/**
 * A quiet hand-off marker: one line, no icon and no tint. The assumptions live
 * behind a disclosure; nothing here claims the setup was run.
 */
export const PrefillNote: React.FC<Props> = ({ assumptions = [], origin = 'chat', onDismiss }) => {
  const [open, setOpen] = useState(false);
  const count = assumptions.length;
  return (
    <div className="space-y-1 text-xs text-[var(--text-3)]" role="status">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>Filled from {origin}</span>
        {count > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <button type="button" className="underline decoration-[var(--line-strong)] underline-offset-2 hover:text-[var(--text-1)]" aria-expanded={open} onClick={() => setOpen(value => !value)}>
              {count} assumption{count === 1 ? '' : 's'}
            </button>
          </>
        )}
        {onDismiss && (
          <>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={onDismiss} className="underline decoration-[var(--line-strong)] underline-offset-2 hover:text-[var(--text-1)]">Dismiss</button>
          </>
        )}
      </p>
      {open && count > 0 && (
        <Disclosure summary="Assumptions">
          <ul className="list-disc space-y-0.5 pl-4">
            {assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}
          </ul>
        </Disclosure>
      )}
    </div>
  );
};
