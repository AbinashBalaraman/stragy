import React from 'react';
import { Checkbox } from '../common/Checkbox';

/**
 * One composer option, shown inline inside the composer box. It used to be an
 * absolutely positioned popover, which covered the textarea at 390 and 1440;
 * in flow it can only push the conversation, never the field being typed in.
 */
export const RequestOptionsPanel: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Escape closes the panel and returns focus to its trigger. */
  onClose: () => void;
}> = ({ checked, onChange, onClose }) => (
  <div
    id="composer-options"
    onKeyDown={event => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    }}
    className="mb-2 rounded-[var(--r-inner)] bg-[var(--surface-2)] px-3 py-2"
  >
    <label className="flex min-h-11 items-start gap-2 text-[12px] leading-4 text-[var(--text-2)] sm:min-h-6">
      <Checkbox checked={checked} onChange={onChange} className="mt-0.5" />
      Allow local keyword fallback (not AI)
    </label>
    <p className="mt-2 text-[12px] leading-4 text-[var(--text-3)]">Local tools only understand explicit stop, target, trailing-stop and symbol edits.</p>
  </div>
);

/** The disclosure trigger that lives in the composer's action row. */
export const RequestOptionsButton = React.forwardRef<HTMLButtonElement, { open: boolean; onToggle: () => void }>(
  ({ open, onToggle }, ref) => (
    <button
      type="button"
      ref={ref}
      aria-label="Request options"
      aria-expanded={open}
      aria-controls="composer-options"
      onClick={onToggle}
      className="flex min-h-11 cursor-pointer items-center whitespace-nowrap rounded-[var(--r-btn)] px-2 text-[12px] text-[var(--text-3)] transition-colors hover:text-[var(--text-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:min-h-8"
    >
      Request options
    </button>
  ),
);
RequestOptionsButton.displayName = 'RequestOptionsButton';
