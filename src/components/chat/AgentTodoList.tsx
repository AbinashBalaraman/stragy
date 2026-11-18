import React from 'react';
import { Check, Circle, Loader2, Minus } from 'lucide-react';
import { humanSummary } from './agentToolLabels';

/**
 * The model's own multi-step plan, kept quiet under the activity timeline.
 * Read-only by design: the engine owns todo state, the UI only reflects it and
 * ticks items off as they arrive. Hidden entirely when there is no plan.
 */

export type AgentTodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface AgentTodoItem {
  content: string;
  status: AgentTodoStatus;
}

export interface AgentTodoListProps {
  items: AgentTodoItem[];
}

const STATUS_ICON = {
  pending: { Icon: Circle, className: 'text-[var(--text-3)]' },
  in_progress: { Icon: Loader2, className: 'animate-spin text-[var(--accent)]' },
  completed: { Icon: Check, className: 'text-[var(--up)]' },
  cancelled: { Icon: Minus, className: 'text-[var(--text-disabled)]' },
} as const;

const STATUS_TEXT: Record<AgentTodoStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Done',
  cancelled: 'Cancelled',
};

const contentClass: Record<AgentTodoStatus, string> = {
  pending: 'text-[var(--text-2)]',
  in_progress: 'text-[var(--text-1)]',
  completed: 'text-[var(--text-3)] line-through',
  // A cancelled step is not done: no strike, a muted dash and an explicit tag.
  cancelled: 'text-[var(--text-disabled)]',
};

export const AgentTodoList: React.FC<AgentTodoListProps> = ({ items }) => {
  const visible = items.filter(item => humanSummary(item.content));
  if (!visible.length) return null;
  const done = visible.filter(item => item.status === 'completed').length;

  return (
    <section aria-label="Agent plan" data-testid="agent-todo-list" className="mt-3 w-full max-w-[var(--chat-prose)]">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <span className="st-label text-[var(--text-3)]">Plan</span>
        <span className="st-tnum text-[11px] text-[var(--text-3)]">{done} of {visible.length}</span>
      </div>
      <ul className="mt-1 space-y-1.5">
        {visible.map((item, index) => {
          const status = STATUS_ICON[item.status] ?? STATUS_ICON.pending;
          const StatusIcon = status.Icon;
          // "Skipped" when the plan moved on to later work; "stopped" when the
          // cancellation ended the plan in place. Never confusable with done.
          const skipped = item.status === 'cancelled' && visible.slice(index + 1).some(later => later.status === 'completed' || later.status === 'in_progress');
          return (
            <li
              key={item.content + '-' + index}
              className="flex min-w-0 items-start gap-2 text-[13px] leading-5"
              aria-current={item.status === 'in_progress' ? 'step' : undefined}
              data-status={item.status}
            >
              <StatusIcon className={'mt-1 h-3 w-3 shrink-0 ' + status.className} aria-hidden="true" />
              <span className="sr-only">{STATUS_TEXT[item.status]}: </span>
              <span className={'min-w-0 flex-1 [overflow-wrap:anywhere] ' + contentClass[item.status]}>
                {humanSummary(item.content, 200)}
                {item.status === 'cancelled' && (
                  <span
                    className="ml-2 inline-flex items-center rounded-full border border-[var(--line)] px-1.5 py-0.5 align-middle text-[10px] leading-3 text-[var(--text-3)]"
                    data-testid="todo-cancelled-tag"
                  >
                    {skipped ? 'skipped' : 'stopped'}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
