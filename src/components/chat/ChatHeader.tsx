import React, { useState } from 'react';
import { ChevronDown, Database, Gauge, History, Plus, Sparkles } from 'lucide-react';
import type { EngineModel, EngineSessionSummary } from '../../client/engine';
import { Badge, formatRelative, formatTokens, formatUsd, PopoverMenu } from './chatUi';
import { sessionTitle } from './SessionHistoryPanel';

/**
 * The chat header: who this conversation belongs to, which model runs it, and
 * the management surfaces. Icon-only on mobile so 390px never overflows, and
 * every control keeps a 44px touch target.
 */

export interface ChatHeaderProps {
  session: EngineSessionSummary | null;
  sessionId: string | null;
  models: EngineModel[];
  modelsLoading: boolean;
  modelsError: string;
  selectedModel: { providerID: string; id: string } | null;
  onSelectModel: (model: EngineModel) => void;
  onRetryModels: () => void;
  modelsBusy: boolean;
  link: 'connecting' | 'live' | 'reconnecting';
  loading: boolean;
  onOpenHistory: () => void;
  onOpenData: () => void;
  onOpenSystem: () => void;
  onNewChat: () => void;
}

const iconButtonClass = 'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-[var(--r-btn)] px-2 text-[var(--text-3)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]';

const linkLabel: Record<ChatHeaderProps['link'], string> = {
  live: 'Engine live',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
};

const linkDot: Record<ChatHeaderProps['link'], string> = {
  live: 'bg-[var(--up)]',
  connecting: 'bg-[var(--text-3)]',
  reconnecting: 'bg-[var(--warn)]',
};

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  session, sessionId, models, modelsLoading, modelsError, selectedModel, onSelectModel, onRetryModels,
  modelsBusy, link, loading, onOpenHistory, onOpenData, onOpenSystem, onNewChat,
}) => {
  const [modelOpen, setModelOpen] = useState(false);
  const title = session ? sessionTitle(session) : sessionId ? 'Untitled chat' : 'New chat';
  const updated = session ? formatRelative(session.updatedAt) : '';
  const tokens = session?.tokens && (session.tokens.input !== undefined || session.tokens.output !== undefined)
    ? (session.tokens.input ?? 0) + (session.tokens.output ?? 0)
    : null;
  const cost = session?.cost;

  const chosen = selectedModel
    ? models.find(model => model.providerID === selectedModel.providerID && model.id === selectedModel.id) ?? null
    : null;
  const chosenLabel = chosen?.label ?? selectedModel?.id ?? (models.find(model => model.default)?.label ?? 'Choose model');
  const chosenPaid = chosen ? chosen.free === false : false;
  const anyPaid = models.some(model => model.free === false);

  return (
    <header className="shrink-0 border-b border-[var(--line)] bg-[#111113]" aria-label="Chat header">
      <div className="mx-auto flex w-full max-w-[832px] flex-col gap-1 px-4 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className={'h-1.5 w-1.5 shrink-0 rounded-full ' + (loading ? 'animate-pulse ' : '') + linkDot[link]} />
          <div className="min-w-0">
            <h1 className="truncate text-[14px] font-medium leading-5 text-[var(--text-1)]">{title}</h1>
            <p className="st-meta flex min-w-0 items-center gap-1.5 truncate text-[var(--text-3)]">
              <span className="shrink-0">{linkLabel[link]}</span>
              {updated && <><span aria-hidden="true">·</span><span className="shrink-0">{updated}</span></>}
              {tokens !== null && <><span aria-hidden="true" className="hidden sm:inline">·</span><span className="st-tnum hidden shrink-0 sm:inline">{formatTokens(tokens)} tokens</span></>}
              {cost !== undefined && <><span aria-hidden="true">·</span><span className="st-tnum shrink-0">{formatUsd(cost)}</span></>}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-0.5">
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <button
              type="button"
              aria-label="Choose model"
              aria-haspopup="dialog"
              aria-expanded={modelOpen}
              data-testid="model-select"
              onClick={() => setModelOpen(value => !value)}
              title={chosenLabel}
              className="flex min-h-11 w-full min-w-0 items-center gap-1.5 rounded-[var(--r-btn)] border border-[var(--line)] px-2 text-[var(--text-2)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] sm:w-auto sm:min-w-[132px] sm:max-w-[220px]"
            >
              <Sparkles size={14} aria-hidden="true" className="shrink-0 text-[var(--accent)]" />
              <span className="min-w-0 flex-1 truncate text-[12px]">{chosenLabel}</span>
              {chosenPaid && <Badge tone="warn">paid</Badge>}
              <ChevronDown size={13} aria-hidden="true" className="shrink-0 text-[var(--text-3)]" />
            </button>
            <PopoverMenu
              open={modelOpen}
              label="Model"
              onClose={() => setModelOpen(false)}
              loading={modelsLoading}
              loadingLabel="Loading models…"
              error={modelsError}
              emptyLabel="No models are available on this server."
              options={models.map(model => ({
                id: model.providerID + '/' + model.id,
                label: model.label,
                meta: model.providerID + ' · ' + model.id,
                selected: selectedModel ? selectedModel.providerID === model.providerID && selectedModel.id === model.id : model.default,
                disabled: modelsBusy,
                badge: model.free === false ? <Badge tone="warn">paid</Badge> : model.free === true ? <Badge tone="up">free</Badge> : undefined,
                onSelect: () => { setModelOpen(false); onSelectModel(model); },
              }))}
              footer={(
                <div className="space-y-1.5">
                  {anyPaid && (
                    <p className="st-meta text-[#f5d383]">
                      Paid models run on your engine provider&rsquo;s credits; each run can cost money. Free models stay free.
                    </p>
                  )}
                  {modelsError && (
                    <button type="button" onClick={onRetryModels} className="st-meta inline-flex min-h-11 items-center rounded-[var(--r-btn)] border border-[var(--line-strong)] px-2.5 text-[var(--text-2)] hover:text-[var(--text-1)]">
                      Try again
                    </button>
                  )}
                  <p className="st-meta text-[var(--text-3)]">Only models this server reports are listed.</p>
                </div>
              )}
            />
          </div>

          <button type="button" aria-label="Market data" title="Market data" onClick={onOpenData} className={iconButtonClass}>
            <Database size={15} aria-hidden="true" />
            <span className="st-meta hidden md:inline">Data</span>
          </button>
          <button type="button" aria-label="System status" title="Usage, jobs and providers" onClick={onOpenSystem} className={iconButtonClass}>
            <Gauge size={15} aria-hidden="true" />
            <span className="st-meta hidden md:inline">System</span>
          </button>
          <button type="button" aria-label="Chat history" title="Chat history" data-testid="chat-history-toggle" onClick={onOpenHistory} className={iconButtonClass}>
            <History size={15} aria-hidden="true" />
          </button>
          <button type="button" aria-label="New chat" title="New chat" data-testid="new-chat" onClick={onNewChat} className={iconButtonClass + ' text-[var(--accent)]'}>
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
};
