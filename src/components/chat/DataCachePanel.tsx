import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Database, RefreshCw } from 'lucide-react';
import {
  getJobStatus, getMarketCache, listJobs, refreshMarketCache,
  type MarketCacheStats,
} from '../../client/engine';
import { formatBytes, formatCount, formatRelative, panelPrimaryButton, PanelSection, SlideOver, Stat } from './chatUi';

/**
 * Market data cache proof for the owner: what is stored, what it cost to get,
 * and a bounded refresh. Progress is the job's own status/counts; no estimate
 * is ever invented.
 */

const errorLine = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'The server did not answer.';
  const status = (error as { status?: number }).status;
  return status ? message + ' (' + status + ')' : message;
};

export interface DataCachePanelProps {
  open: boolean;
  onClose: () => void;
  universe: string;
}

export const DataCachePanel: React.FC<DataCachePanelProps> = ({ open, onClose, universe }) => {
  const [stats, setStats] = useState<MarketCacheStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshStatus, setRefreshStatus] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobDetail, setJobDetail] = useState('');
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStats(await getMarketCache());
      setError('');
    } catch (caught) {
      setError('Market cache could not be read. ' + errorLine(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (open) void load();
    return () => { mounted.current = false; };
  }, [open, load]);

  // A refresh job is polled by its own id; the same job record powers the Jobs
  // tab. When it settles, reload the cache summary once.
  useEffect(() => {
    if (!open || !jobId) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const [job, jobs] = await Promise.all([getJobStatus(jobId), listJobs(20)]);
        if (cancelled) return;
        const summary = jobs.find(item => item.id === jobId);
        const status = summary?.status ?? job.status;
        const progress = summary?.progress ? summary.progress.processed + ' of ' + summary.progress.total : '';
        setJobDetail([status, progress].filter(Boolean).join(' · '));
        if (status === 'queued' || status === 'running') {
          setRefreshStatus('Refresh ' + status + ' on the server…');
          timer = window.setTimeout(() => { void tick(); }, 3_000);
          return;
        }
        setRefreshing(false);
        setJobId(null);
        setRefreshStatus(status === 'succeeded'
          ? 'Refresh finished. Cached candles are up to date for ' + universe + (summary?.universe ? ' (' + summary.universe + ')' : '') + '.'
          : status === 'interrupted'
            ? 'The server restarted during the refresh. The job is saved; resume it from Jobs.'
            : status === 'cancelled'
              ? 'Refresh was cancelled. Cached candles were not changed beyond completed work.'
              : 'Refresh failed. ' + (summary?.error?.message ?? 'No candles were confirmed refreshed.'));
        await load();
      } catch (caught) {
        if (cancelled) return;
        setRefreshing(false);
        setJobId(null);
        setRefreshStatus('');
        setRefreshError('Refresh progress could not be read. ' + errorLine(caught));
        await load();
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [open, jobId, load, universe]);

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError('');
    setRefreshStatus('Asking the server to refresh ' + universe + '…');
    try {
      const result = await refreshMarketCache(universe);
      if (result.jobId) {
        setJobId(result.jobId);
        setRefreshStatus('Refresh queued on the server…');
        return;
      }
      setRefreshing(false);
      setJobDetail(result.status);
      setRefreshStatus(result.status === 'done' || result.status === 'succeeded'
        ? 'Refresh finished' + (result.refreshed !== undefined ? ': ' + result.refreshed + ' symbols updated' : '') + (result.failed ? ', ' + result.failed + ' failed' : '') + '.'
        : result.status === 'failed'
          ? 'Refresh failed. ' + (result.message ?? 'No candles were confirmed refreshed.')
          : 'The server reported “' + result.status + '”. ' + (result.message ?? 'Reload to see the latest summary.'));
      await load();
    } catch (caught) {
      setRefreshing(false);
      setRefreshStatus('');
      setRefreshError('Refresh could not start. ' + errorLine(caught));
    }
  };

  return (
    <SlideOver open={open} title="Market data" subtitle={'Cached candles · ' + universe} onClose={onClose} testId="data-cache-panel">
      <p className="st-meta mb-4 rounded-[var(--r-inner)] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text-2)]">
        Cached candles are reused; only the missing tail is downloaded.
      </p>

      {loading && <p className="st-meta text-[var(--text-3)]">Reading the cache…</p>}
      {error && (
        <div role="alert" className="mb-3 rounded-[var(--r-inner)] border border-[var(--danger)]/30 bg-[var(--danger)]/[0.06] px-3 py-2">
          <p className="st-meta text-[#fca5a5]">{error}</p>
          <button type="button" onClick={() => void load()} className={panelPrimaryButton + ' mt-2'}>Try again</button>
        </div>
      )}

      {stats && (
        <>
          <PanelSection title="Stored" meta={stats.lastFetchAt ? 'Last fetch ' + formatRelative(stats.lastFetchAt) : 'No fetch recorded'}>
            <dl className="grid grid-cols-2 gap-x-4">
              <Stat label="Symbols cached" value={formatCount(stats.symbols)} />
              <Stat label="Daily bars" value={formatCount(stats.bars)} />
              <Stat
                wide
                label="Date range"
                value={stats.firstDate && stats.lastDate ? stats.firstDate + ' → ' + stats.lastDate : 'No bars yet'}
              />
              <Stat label="Database size" value={formatBytes(stats.dbBytes)} />
            </dl>
          </PanelSection>

          <PanelSection title="Efficiency">
            <dl className="grid grid-cols-2 gap-x-4">
              <Stat label="Cache hits" value={formatCount(stats.hits)} hint="Served without a download" />
              <Stat label="Misses" value={formatCount(stats.misses)} />
              <Stat label="Incremental fetches" value={formatCount(stats.incrementalFetches)} hint="Tail-only downloads" />
              <Stat label="Last fetch" value={stats.lastFetchAt ? formatRelative(stats.lastFetchAt) : 'Not yet'} />
            </dl>
          </PanelSection>
        </>
      )}

      <PanelSection title="Refresh">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void refresh()}
            data-testid="cache-refresh"
            className={panelPrimaryButton}
          >
            <RefreshCw size={14} aria-hidden="true" className={refreshing ? 'animate-spin' : undefined} />
            {refreshing ? 'Refreshing…' : 'Refresh data'}
          </button>
          <span className="st-meta inline-flex items-center gap-1.5 text-[var(--text-3)]">
            <Database size={13} aria-hidden="true" /> {universe}
          </span>
        </div>
        {refreshStatus && <p role="status" className="st-meta mt-2 text-[var(--text-2)]">{refreshStatus}</p>}
        {jobDetail && refreshing && <p className="st-meta mt-1 text-[var(--text-3)]">Job {jobId?.slice(0, 12)} · {jobDetail}</p>}
        {refreshError && <p role="alert" className="st-meta mt-2 text-[#fca5a5]">{refreshError}</p>}
        <p className="st-meta mt-2 text-[var(--text-3)]">A refresh downloads only dates missing after the cached tail. Covered bars are never fetched twice.</p>
      </PanelSection>
    </SlideOver>
  );
};
