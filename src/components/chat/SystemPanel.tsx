import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, RefreshCw, Square } from 'lucide-react';
import {
  cancelJob, getEngineUsage, getProviderStatus, listJobs, resumeJob,
  type EngineSessionSummary, type EngineUsage, type JobSummary, type ProviderStatus,
} from '../../client/engine';
import {
  Badge, formatCount, formatRelative, formatTokens, formatUsd, panelButton, PanelSection, SlideOver, Stat,
} from './chatUi';

/**
 * The "System" surface: token/cost usage, durable jobs, and provider status.
 * Every value is reported by the server; a missing number is "Not reported",
 * never zero, and no credential or raw JSON is ever rendered.
 */

type SystemTab = 'usage' | 'jobs' | 'providers';

const JOB_KIND: Record<string, string> = {
  scan: 'Scan', chart: 'Chart', backtest: 'Backtest', market: 'Market',
};

const kindLabel = (kind: string): string => JOB_KIND[kind.toLowerCase()] ?? (kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : 'Job');

const statusTone = (status: JobSummary['status']): 'neutral' | 'accent' | 'up' | 'down' | 'warn' => {
  if (status === 'running') return 'accent';
  if (status === 'succeeded') return 'up';
  if (status === 'failed') return 'down';
  if (status === 'interrupted') return 'warn';
  return 'neutral';
};

const jobProgress = (job: JobSummary): string => {
  if (job.progress) return job.progress.processed + ' of ' + job.progress.total;
  if (job.stage) return job.stage;
  return '';
};

const errorLine = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'The server did not answer.';
  const status = (error as { status?: number }).status;
  return status ? message + ' (' + status + ')' : message;
};

const UsageTab: React.FC<{ usage: EngineUsage | null; loading: boolean; error: string; activeSessionId: string | null; activeSession: EngineSessionSummary | null; onRetry: () => void }> = ({
  usage, loading, error, activeSessionId, activeSession, onRetry,
}) => {
  const session = usage?.sessions.find(item => item.sessionId === activeSessionId) ?? null;
  const stats = usage?.stats ?? null;
  const input = stats?.tokens.input;
  const output = stats?.tokens.output;
  const hasTokenSplit = input !== undefined || output !== undefined;
  const totalTokens = hasTokenSplit ? (input ?? 0) + (output ?? 0) : undefined;
  const sessionTokens = session?.tokens ?? activeSession?.tokens;
  const sessionCost = session?.cost ?? activeSession?.cost;
  const windowLabel = usage?.windowDays ? 'Last ' + usage.windowDays + ' days' : usage?.since ? 'Since ' + usage.since : 'Reported by the engine';

  return (
    <div className="space-y-5">
      {loading && <p className="st-meta text-[var(--text-3)]">Reading usage…</p>}
      {error && (
        <div role="alert" className="rounded-[var(--r-inner)] border border-[var(--danger)]/30 bg-[var(--danger)]/[0.06] px-3 py-2">
          <p className="st-meta text-[#fca5a5]">{error}</p>
          <button type="button" onClick={onRetry} className={panelButton + ' mt-2'}>Try again</button>
        </div>
      )}

      <PanelSection title="This chat" meta={activeSessionId ? undefined : 'No engine chat yet'}>
        {!activeSessionId && <p className="st-meta text-[var(--text-3)]">Send a message to start a durable chat.</p>}
        {activeSessionId && (sessionTokens || sessionCost !== undefined) ? (
          <dl className="grid grid-cols-2 gap-x-4">
            <Stat label="Tokens" value={sessionTokens ? [formatTokens(sessionTokens.input), 'in ·', formatTokens(sessionTokens.output), 'out'].filter(Boolean).join(' ') : 'Not reported'} />
            <Stat label="Cost" value={sessionCost !== undefined ? formatUsd(sessionCost) : 'Not reported'} />
          </dl>
        ) : activeSessionId ? (
          <p className="st-meta text-[var(--text-3)]">The engine has not reported usage for this chat yet.</p>
        ) : null}
      </PanelSection>

      <PanelSection title="Server totals" meta={usage ? windowLabel : undefined}>
        {usage && !stats && (
          <div className="rounded-[var(--r-inner)] border border-[var(--warn)]/25 bg-[var(--warn)]/[0.04] px-3 py-2">
            <p className="st-meta text-[var(--text-2)]">Usage is not available.</p>
            {usage.warnings.length > 0 && (
              <ul className="st-meta mt-1 list-disc space-y-0.5 pl-4 text-[var(--text-3)]">
                {usage.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
              </ul>
            )}
            <p className="st-meta mt-1 text-[var(--text-3)]">The engine did not report totals. No numbers are shown rather than zeros.</p>
          </div>
        )}
        {stats && (
          <dl className="grid grid-cols-2 gap-x-4">
            <Stat label="Chats" value={formatCount(stats.sessions)} />
            <Stat label="Prompts" value={formatCount(stats.prompts)} />
            <Stat label="Engine steps" value={formatCount(stats.steps)} />
            <Stat
              label="Tokens"
              value={hasTokenSplit ? [formatTokens(input), 'in ·', formatTokens(output), 'out'].filter(Boolean).join(' ') : 'Not reported'}
              hint={totalTokens !== undefined ? formatCount(totalTokens) + ' total' : undefined}
            />
            <Stat label="Cost" value={stats.cost !== null ? formatUsd(stats.cost) : 'Not reported'} hint={stats.cost === null ? 'The engine reports no dollar amount.' : undefined} />
          </dl>
        )}
        {!usage && !loading && !error && <p className="st-meta text-[var(--text-3)]">No usage reported.</p>}
      </PanelSection>

      {usage && usage.warnings.length > 0 && stats && (
        <ul className="st-meta list-disc space-y-1 pl-4 text-[var(--text-3)]">
          {usage.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
        </ul>
      )}

      {stats && stats.models.length > 0 && (
        <PanelSection title="By model">
          <ul className="divide-y divide-[var(--line)]">
            {stats.models.map((model, index) => {
              const tokens = model.tokens && (model.tokens.input !== undefined || model.tokens.output !== undefined)
                ? (model.tokens.input ?? 0) + (model.tokens.output ?? 0)
                : null;
              return (
                <li key={(model.providerID ?? 'model') + '-' + (model.id ?? index)} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 first:pt-0 last:pb-0">
                  <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-[var(--text-2)]">{model.label ?? model.id ?? model.providerID ?? 'Model'}</span>
                  <span className="st-tnum flex shrink-0 items-center gap-3 text-[12px] text-[var(--text-3)]">
                    {tokens !== null && <span>{formatTokens(tokens)} tokens</span>}
                    {model.cost !== undefined && <span className="text-[var(--text-1)]">{formatUsd(model.cost)}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </PanelSection>
      )}

      {usage && usage.sessions.length > 0 && (
        <PanelSection title="Recent chats">
          <ul className="divide-y divide-[var(--line)]">
            {usage.sessions.slice(0, 8).map(item => {
              const tokens = item.tokens && (item.tokens.input !== undefined || item.tokens.output !== undefined)
                ? (item.tokens.input ?? 0) + (item.tokens.output ?? 0)
                : null;
              return (
                <li key={item.sessionId} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 first:pt-0 last:pb-0">
                  <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-[var(--text-2)]">{item.title?.trim() || 'Untitled chat'}</span>
                  <span className="st-tnum flex shrink-0 gap-3 text-[12px] text-[var(--text-3)]">
                    {tokens !== null && <span>{formatTokens(tokens)} tokens</span>}
                    {item.cost !== undefined && <span className="text-[var(--text-1)]">{formatUsd(item.cost)}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </PanelSection>
      )}
    </div>
  );
};

const JobsTab: React.FC = () => {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async (announce = false) => {
    try {
      const next = await listJobs(20);
      if (!mounted.current) return;
      setJobs(next);
      setError('');
      if (announce) setStatus(next.length ? 'Jobs refreshed.' : 'No jobs yet.');
    } catch (caught) {
      if (!mounted.current) return;
      setError('Jobs could not be loaded. ' + errorLine(caught));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  const hasActive = jobs.some(job => job.status === 'queued' || job.status === 'running');
  useEffect(() => {
    if (!hasActive) return undefined;
    const timer = window.setInterval(() => { void load(); }, 4_000);
    return () => window.clearInterval(timer);
  }, [hasActive, load]);

  const act = async (job: JobSummary, action: 'cancel' | 'resume') => {
    setBusyId(job.id);
    setStatus('');
    try {
      if (action === 'cancel') await cancelJob(job.id);
      else await resumeJob(job.id);
      setStatus(action === 'cancel'
        ? 'Cancel requested for ' + kindLabel(job.kind) + '. The server will report the final state.'
        : 'Resume requested for ' + kindLabel(job.kind) + '. It continues from its saved progress.');
      await load();
    } catch (caught) {
      setError('That job could not be ' + (action === 'cancel' ? 'cancelled' : 'resumed') + '. ' + errorLine(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="st-meta text-[var(--text-3)]">Scans, chart reads, backtests and market-data refreshes on this server.</p>
        <button type="button" onClick={() => void load(true)} className={panelButton}>
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
      </div>
      {status && <p role="status" className="st-meta text-[var(--text-3)]">{status}</p>}
      {error && <p role="alert" className="st-meta text-[#fca5a5]">{error}</p>}
      {loading && <p className="st-meta text-[var(--text-3)]">Loading jobs…</p>}
      {!loading && !jobs.length && <p className="st-meta text-[var(--text-3)]">No jobs yet.</p>}
      <ul className="space-y-2">
        {jobs.map(job => {
          const progress = jobProgress(job);
          const active = job.status === 'queued' || job.status === 'running';
          const resumable = job.status === 'interrupted' && job.resumable;
          return (
            <li key={job.id} data-testid="job-row" className="rounded-[var(--r-inner)] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[13px] leading-5 font-medium text-[var(--text-1)]">{kindLabel(job.kind)}</span>
                {job.universe && <span className="st-meta min-w-0 truncate text-[var(--text-3)]">{job.universe}</span>}
                <Badge tone={statusTone(job.status)}>{job.status}</Badge>
                <span className="st-meta ml-auto shrink-0 text-[var(--text-3)]">{formatRelative(job.createdAt ?? job.startedAt)}</span>
              </div>
              {(progress || job.error?.message) && (
                <p className="st-meta mt-1 min-w-0 [overflow-wrap:anywhere] text-[var(--text-2)]">
                  {progress && <span className="st-tnum">{progress}</span>}
                  {progress && job.error?.message && <span aria-hidden="true"> · </span>}
                  {job.error?.message && <span className="text-[#fca5a5]">{job.error.message}</span>}
                </p>
              )}
              {(active || resumable) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {active && (
                    <button
                      type="button"
                      disabled={busyId === job.id}
                      onClick={() => void act(job, 'cancel')}
                      className={panelButton}
                      aria-label={'Cancel ' + kindLabel(job.kind) + ' job'}
                      data-testid="job-cancel"
                    >
                      <Square size={12} aria-hidden="true" /> Cancel
                    </button>
                  )}
                  {resumable && (
                    <button
                      type="button"
                      disabled={busyId === job.id}
                      onClick={() => void act(job, 'resume')}
                      className={panelButton}
                      aria-label={'Resume ' + kindLabel(job.kind) + ' job'}
                      data-testid="job-resume"
                    >
                      <Play size={12} aria-hidden="true" /> Resume
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const ProvidersTab: React.FC<{ providers: ProviderStatus | null; loading: boolean; error: string; onRetry: () => void }> = ({ providers, loading, error, onRetry }) => {
  const chain = providers?.ai.modelChain?.length ? providers.ai.modelChain : providers?.ai.models ?? [];
  return (
    <div className="space-y-5">
      {loading && <p className="st-meta text-[var(--text-3)]">Reading provider status…</p>}
      {error && (
        <div role="alert" className="rounded-[var(--r-inner)] border border-[var(--danger)]/30 bg-[var(--danger)]/[0.06] px-3 py-2">
          <p className="st-meta text-[#fca5a5]">{error}</p>
          <button type="button" onClick={onRetry} className={panelButton + ' mt-2'}>Try again</button>
        </div>
      )}
      {providers && (
        <>
          <PanelSection title="AI engine" meta={providers.ai.ready ? 'Ready' : 'Not ready'}>
            <div className="flex items-center gap-2">
              <Badge tone={providers.ai.ready ? 'up' : 'down'}>{providers.ai.ready ? 'Ready' : 'Not ready'}</Badge>
              {providers.ai.model && <span className="st-meta min-w-0 truncate text-[var(--text-2)]">{providers.ai.model}</span>}
            </div>
            {chain.length > 0 ? (
              <div className="mt-2">
                <p className="st-label text-[var(--text-3)]">Model chain</p>
                <ol className="mt-1 space-y-1">
                  {chain.map((model, index) => (
                    <li key={model + '-' + index} className="st-meta flex min-w-0 items-center gap-2 text-[var(--text-2)]">
                      <span className="st-tnum w-4 shrink-0 text-[var(--text-3)]">{index + 1}</span>
                      <span className="min-w-0 truncate">{model}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <p className="st-meta mt-2 text-[var(--text-3)]">The engine did not list a model chain.</p>
            )}
          </PanelSection>

          <PanelSection title="Angel One market data">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={providers.market.configured ? 'up' : 'warn'}>{providers.market.configured ? 'Configured' : 'Not configured'}</Badge>
              <Badge tone={providers.market.connected ? 'up' : 'neutral'}>{providers.market.connected ? 'Connected' : 'Not connected'}</Badge>
            </div>
            <p className="st-meta mt-2 text-[var(--text-2)]">
              {providers.market.connected
                ? 'A live Angel One session is open.'
                : providers.market.configured
                  ? 'Credentials are saved; the app opens a session when it needs live data.'
                  : 'No Angel One credentials are saved, so live data is unavailable.'}
            </p>
            {providers.market.reason && <p className="st-meta mt-1 text-[var(--text-3)]">{providers.market.reason}</p>}
            {(() => {
              const rate = providers.market.rate;
              if (!rate) return null;
              const parts = [
                rate.candleRequests ? rate.candleRequests + (rate.candleRequests === 1 ? ' candle request' : ' candle requests') : '',
                rate.throttles ? rate.throttles + (rate.throttles === 1 ? ' throttle' : ' throttles') : '',
                rate.retrySleepMs ? (rate.retrySleepMs / 1_000).toFixed(1).replace(/\.0$/, '') + ' s retry wait' : '',
                rate.relogins ? rate.relogins + (rate.relogins === 1 ? ' relogin' : ' relogins') : '',
              ].filter(Boolean);
              return parts.length ? <p className="st-meta mt-1 text-[var(--text-3)] [overflow-wrap:anywhere]">This process: {parts.join(' · ')}</p> : null;
            })()}
            {!providers.market.configured && providers.market.credentials?.missing.length ? (
              <p className="st-meta mt-1 text-[var(--text-3)] [overflow-wrap:anywhere]">
                Missing: {providers.market.credentials.missing.join(', ')}
              </p>
            ) : null}
          </PanelSection>

          <PanelSection title="Voice">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={providers.voice.configured ? 'up' : 'warn'}>{providers.voice.configured ? 'Configured' : 'Not configured'}</Badge>
              {providers.voice.model && <span className="st-meta min-w-0 truncate text-[var(--text-2)]">{providers.voice.model}</span>}
            </div>
            <p className="st-meta mt-2 text-[var(--text-2)]">
              {providers.voice.configured
                ? 'Dictation and spoken answers are available in supported browsers.'
                : 'Voice is not configured on this server. Text chat still works.'}
            </p>
          </PanelSection>
        </>
      )}
    </div>
  );
};

export interface SystemPanelProps {
  open: boolean;
  onClose: () => void;
  activeSessionId: string | null;
  activeSession: EngineSessionSummary | null;
  initialTab?: SystemTab;
}

export const SystemPanel: React.FC<SystemPanelProps> = ({ open, onClose, activeSessionId, activeSession, initialTab = 'usage' }) => {
  const [tab, setTab] = useState<SystemTab>(initialTab);
  const [usage, setUsage] = useState<EngineUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState('');
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState('');

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      setUsage(await getEngineUsage());
      setUsageError('');
    } catch (caught) {
      setUsageError('Usage could not be read. ' + errorLine(caught));
    } finally {
      setUsageLoading(false);
    }
  }, []);

  const loadProviders = useCallback(async () => {
    setProvidersLoading(true);
    try {
      setProviders(await getProviderStatus());
      setProvidersError('');
    } catch (caught) {
      setProvidersError('Provider status could not be read. ' + errorLine(caught));
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    void loadUsage();
    void loadProviders();
  }, [open, initialTab, loadUsage, loadProviders]);

  const tabs: Array<{ id: SystemTab; label: string }> = [
    { id: 'usage', label: 'Usage' },
    { id: 'jobs', label: 'Jobs' },
    { id: 'providers', label: 'Providers' },
  ];

  return (
    <SlideOver open={open} title="System" subtitle="Usage, jobs and connections" onClose={onClose} testId="system-panel">
      <div role="tablist" aria-label="System sections" className="mb-4 flex gap-1 rounded-[var(--r-inner)] border border-[var(--line)] bg-[var(--surface-2)] p-1">
        {tabs.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={'system-tab-' + item.id}
            onClick={() => setTab(item.id)}
            className={'min-h-11 flex-1 rounded-[var(--r-btn)] px-2 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ' + (tab === item.id ? 'bg-[#2a2a30] text-[var(--text-1)]' : 'text-[var(--text-3)] hover:text-[var(--text-2)]')}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div id={'system-tab-' + tab} role="tabpanel" aria-label={tabs.find(item => item.id === tab)?.label} data-testid={tab === 'usage' ? 'usage-panel' : tab === 'jobs' ? 'jobs-panel' : 'provider-status'}>
        {tab === 'usage' && (
          <UsageTab
            usage={usage}
            loading={usageLoading}
            error={usageError}
            activeSessionId={activeSessionId}
            activeSession={activeSession}
            onRetry={() => void loadUsage()}
          />
        )}
        {tab === 'jobs' && <JobsTab />}
        {tab === 'providers' && (
          <ProvidersTab
            providers={providers}
            loading={providersLoading}
            error={providersError}
            onRetry={() => void loadProviders()}
          />
        )}
      </div>

      <p className="st-meta mt-5 border-t border-[var(--line)] pt-3 text-[var(--text-3)]">
        Nothing here changes a strategy or places a broker order.
      </p>
    </SlideOver>
  );
};
