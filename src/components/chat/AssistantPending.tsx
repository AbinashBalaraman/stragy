import React from 'react';
import { Skeleton } from '../common/Skeleton';

interface Props {
  /** Honest, single line: no invented steps or percentage. */
  label?: string;
}

/**
 * The in-flow placeholder while a reply is being prepared (research §2.5,
 * P0-2). The one polite status region in AiCopilotDock announces progress, so
 * this block stays decorative.
 */
export const AssistantPending: React.FC<Props> = ({ label = 'Reading your request…' }) => (
  <div data-testid="assistant-pending" className="w-full space-y-2">
    <p className="st-meta text-[var(--text-3)]">Stragy</p>
    <div className="st-prose">
      <Skeleton widths={[60, 90, 40]} />
    </div>
    <p className="st-meta text-[var(--text-3)]">{label}</p>
  </div>
);
