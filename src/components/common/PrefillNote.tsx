import React, { useState } from 'react';
import { Sparkles, X } from 'lucide-react';

interface Props {
  /** Assumptions the setup came with; shown behind a disclosure, never as a wall. */
  assumptions?: string[];
  /** Optional origin wording, e.g. "chat". */
  origin?: string;
  onDismiss?: () => void;
}

/**
 * A quiet, dismissible note that a feature was filled from a hand-off rather
 * than typed here. It never claims anything was run or applied.
 */
export const PrefillNote: React.FC<Props> = ({ assumptions = [], origin = 'chat', onDismiss }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-start gap-x-2 gap-y-1 rounded-lg border border-[#a8c7fa]/25 bg-[#a8c7fa]/[0.06] px-3 py-2 text-[11px] leading-5 text-neutral-300" role="status">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#a8c7fa]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p>
          Filled from {origin} · review before running
          {assumptions.length > 0 && (
            <>
              {' · '}
              <button type="button" className="underline decoration-neutral-500 underline-offset-2 hover:text-neutral-100" aria-expanded={open} onClick={() => setOpen(value => !value)}>
                {assumptions.length} assumption{assumptions.length === 1 ? '' : 's'}
              </button>
            </>
          )}
        </p>
        {open && assumptions.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-neutral-400">
            {assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}
          </ul>
        )}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss filled-from note" className="shrink-0 rounded p-0.5 text-neutral-500 hover:bg-white/5 hover:text-neutral-200">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
};
