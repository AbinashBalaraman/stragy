import React from 'react';

export interface RowAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

interface Props {
  actions: RowAction[];
  /** Optional leading content (sources, status text). */
  leading?: React.ReactNode;
  className?: string;
}

/** Copy/retry actions: 44px targets on touch, 28px on pointer. */
export const ActionRow: React.FC<Props> = ({ actions, leading, className = '' }) => (
  <div className={'flex flex-wrap items-center gap-1.5 ' + className}>
    {leading}
    {actions.map(action => (
      <button
        key={action.id}
        type="button"
        onClick={action.onClick}
        disabled={action.disabled}
        aria-label={action.label}
        title={action.label}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-btn)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:text-[var(--text-disabled)] sm:min-h-7 sm:min-w-7"
      >
        {action.icon}
      </button>
    ))}
  </div>
);
