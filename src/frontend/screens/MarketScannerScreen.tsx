import { useCallback, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, Ban, Database, Download, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import { requestScan, type ResearchJobProgress, type ScanResult } from '../../client/api';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import { plainRule } from '../../client/plainRules';
import { UNIVERSE_OPTIONS } from '../../shared/data/symbols';
import { useLang } from '../lang';
import { t } from '../i18n';
import type { CacheStats } from '../stragy/client';

type Props = { cache: CacheStats | null };
type SortKey = 'ticker' | 'lastClose' | 'changePercent' | 'score' | 'date';
type Match = ScanResult['matches'][number];

const money = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const day = (iso?: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'date unavailable');

/** Merge background batches into ONE honest result: no silent truncation. */
function mergeScans(parts: ScanResult[], requested: number): ScanResult {
  const first = parts[0];
  const matches: Match[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    for (const match of part.matches) {
      const key = match.ticker || String(match.symbolId);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(match);
    }
  }
  matches.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.ticker.localeCompare(b.ticker));
  const sum = (key: 'scanned' | 'attempted' | 'succeeded' | 'unavailable' | 'failed') =>
    parts.reduce((total, part) => total + (part[key] ?? 0), 0);
  const sourceCoverage: Record<string, number> = {};
  for (const part of parts) for (const [source, count] of Object.entries(part.sourceCoverage ?? {})) sourceCoverage[source] = (sourceCoverage[source] ?? 0) + count;
  return {
    ...first,
    matches,
    matched: matches.length,
    requested,
    scanned: sum('scanned'), attempted: sum('attempted'), succeeded: sum('succeeded'),
    unavailable: sum('unavailable'), failed: sum('failed'),
    sourceCoverage,
    warnings: [...new Set(parts.flatMap(part => part.warnings ?? []))].slice(0, 20),
    errors: parts.flatMap(part => part.errors ?? []).slice(0, 100),
  };
}

/** TradingView-style sorting: one click sorts, the next reverses. */
function sortMatches(matches: Match[], key: SortKey, dir: 'asc' | 'desc'): Match[] {
  const value = (m: Match): string | number => {
    switch (key) {
      case 'ticker': return m.ticker;
      case 'lastClose': return m.lastClose;
      case 'changePercent': return m.changePercent;
      case 'score': return m.score ?? 0;
      case 'date': return m.lastDate;
    }
  };
  return [...matches].sort((a, b) => {
    const av = value(a), bv = value(b);
    const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return dir === 'asc' ? cmp : -cmp;
  });
}

function exportCsv(matches: Match[]): void {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ['Ticker', 'Name', 'Sector', 'Date', 'Close (INR)', 'Change %', 'Score', 'Matched rules'].join(','),
    ...matches.map(m => [m.ticker, m.name, m.sector, m.lastDate, m.lastClose, m.changePercent, m.score ?? '', (m.matchedRules ?? []).map(r => r.rule).join(' | ')].map(esc).join(',')),
  ];
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `stragy-scan-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * A quiet, data-first scanner: bounded universe selection, background batches
 * for large requests, sortable results, honest coverage and CSV export.
 */
export function MarketScannerScreen({ cache }: Props) {
  const lang = useLang().lang;
  const [universe, setUniverse] = useState('NIFTY_50');
  const [limit, setLimit] = useState(20);
  const [templateIndex, setTemplateIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ResearchJobProgress | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'score', dir: 'desc' });
  const controller = useRef<AbortController | null>(null);
  const template = STRATEGY_TEMPLATES[templateIndex] ?? STRATEGY_TEMPLATES[0];

  const run = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setError('');
    setResult(null);
    setProgress(null);
    try {
      const total = Math.min(2000, Math.max(1, limit));
      const parts: ScanResult[] = [];
      for (let offset = 0; offset < total; offset += 200) {
        if (abort.signal.aborted) return;
        const batchSize = Math.min(200, total - offset);
        const batchNo = Math.floor(offset / 200) + 1;
        const batches = Math.ceil(total / 200);
        parts.push(await requestScan(
          { universe, strategy: template.strategy, maxSymbols: batchSize, symbolOffset: offset, limit: 100 },
          abort.signal,
          undefined,
          (p) => { if (!abort.signal.aborted) setProgress({ ...p, stage: (batches > 1 ? `batch ${batchNo}/${batches} · ` : '') + (p.stage || 'running') }); },
        ));
      }
      if (!abort.signal.aborted) setResult(mergeScans(parts, total));
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'The scan did not complete.');
    } finally {
      if (!abort.signal.aborted) setRunning(false);
    }
  }, [universe, limit, template]);

  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setError('Scan cancelled by you.');
  };

  const rows = useMemo(() => result ? sortMatches(result.matches, sort.key, sort.dir) : [], [result, sort]);
  const toggleSort = (key: SortKey) => setSort(current => ({ key, dir: current.key === key && current.dir === 'desc' ? 'asc' : 'desc' }));
  const sortIcon = (key: SortKey) => sort.key === key ? (sort.dir === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />) : null;
  const progressText = progress
    ? `${progress.stage || 'running'}${progress.progress ? ` · ${progress.progress.processed} / ${progress.progress.total}` : ''}${progress.queuedBehind ? ` · ${progress.queuedBehind} ahead` : ''}`
    : '';

  return (
    <div className="screen active scroll-screen" data-testid="scanner-screen">
      <div className="wrap">
        <div className="scanner-head">
          <div>
            <h1 className="h-sec">{t(lang, 'scannerTitle')}</h1>
            <p className="h-sub">{t(lang, 'scannerLede')}</p>
          </div>
          <span className="chip ready" data-testid="scanner-cache-chip"><span className="cdot" />{t(lang, 'cacheStatus')}: {cache?.symbols ?? '—'} symbols · EOD {cache?.lastDate || '—'}</span>
        </div>

        <section className="panel scanner-controls" data-testid="scanner-controls">
          <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
            <div className="scanner-grid">
              <label className="field">
                <span>{t(lang, 'universe')}</span>
                <select className="sel" data-testid="scanner-universe" value={universe} onChange={(e) => setUniverse(e.target.value)} disabled={running}>
                  {UNIVERSE_OPTIONS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>{t(lang, 'maxSymbols')}</span>
                <input className="sel" type="number" min={1} max={2000} value={limit} data-testid="scanner-limit" onChange={(e) => setLimit(Number(e.target.value))} disabled={running} />
              </label>
              <label className="field">
                <span>{t(lang, 'strategy')}</span>
                <select className="sel" data-testid="scanner-strategy" value={templateIndex} onChange={(e) => setTemplateIndex(Number(e.target.value))} disabled={running}>
                  {STRATEGY_TEMPLATES.map((s, i) => <option key={s.id} value={i}>{s.name}</option>)}
                </select>
              </label>
            </div>
            <div className="scanner-rule" data-testid="scanner-rule">
              <b>{template.name}</b>
              <span className="muted"> · {template.strategy.rules.entry.map((r) => plainRule(r, template.strategy.indicators)).join(' AND ')}</span>
            </div>
            <div className="scanner-actions">
              {running ? (
                <button type="button" className="btn" data-testid="scanner-cancel" onClick={cancel}><Ban size={14} /> {t(lang, 'cancelScan')}</button>
              ) : (
                <button type="button" className="btn primary" data-testid="scanner-run" onClick={() => void run()}><Search size={14} /> {t(lang, 'runScan')}</button>
              )}
              <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{Math.min(2000, Math.max(1, limit))} symbols · {universe}{limit > 200 ? ' · runs in background batches of 200' : ''}</span>
            </div>
            {running && (
              <div className="scanner-progress" role="status" data-testid="scanner-progress">
                <LoaderCircle size={14} className="spinner" />
                <span>{t(lang, 'scanProgress')}: {progressText || 'queued…'}</span>
              </div>
            )}
            {error && <div className="scanner-error" role="alert" data-testid="scanner-error">{error} <button type="button" className="btn" onClick={() => void run()}><RefreshCw size={12} /> {t(lang, 'retry')}</button></div>}
          </div>
        </section>

        {result && (
          <section className="panel scanner-results" data-testid="scanner-results">
            <div className="panel-head">
              <div style={{ fontWeight: 600 }}>{t(lang, 'scanResults')}</div>
              <div className="chiprow" style={{ margin: 0, marginLeft: 'auto' }}>
                <span className="chip ready" data-testid="scan-matched"><span className="cdot" />{result.matched} matched</span>
                <span className="chip" data-testid="scan-coverage"><span className="cdot" />{t(lang, 'coverage')}: {result.succeeded}/{result.requested}</span>
                <span className={`chip ${result.mode === 'real' ? 'ready' : 'caveat'}`} data-testid="scan-mode"><span className="cdot" />{result.mode === 'real' ? t(lang, 'sourceObserved') : t(lang, 'sourceDemo')}</span>
                {result.matches.length > 0 && <button type="button" className="btn ghost" data-testid="scan-export" onClick={() => exportCsv(rows)}><Download size={13} /> CSV</button>}
              </div>
            </div>
            <div className="panel-body">
              <p className="disclaimer" style={{ marginTop: 0 }} data-testid="scan-summary">
                Evaluated {result.attempted} of {result.requested} requested symbols · {result.succeeded} succeeded · {result.unavailable} unavailable · {result.failed} failed · showing all {result.matches.length} matches · EOD {result.asOf ? day(result.asOf) : (result.observationDates?.latest ? day(result.observationDates.latest) : 'not reported')}.
                {Object.keys(result.sourceCoverage || {}).length > 0 && ` Sources: ${Object.entries(result.sourceCoverage).filter(([, n]) => n > 0).map(([k, v]) => `${k} (${v})`).join(', ')}.`}
                {result.warnings?.length ? ` ${result.warnings.slice(0, 2).join(' ')}` : ''}
              </p>
              {result.errors?.length > 0 && (
                <p className="disclaimer" style={{ color: 'var(--warn)' }} data-testid="scan-failures">
                  Failures: {result.errors.slice(0, 4).map((e) => `${e.ticker || `symbol ${e.symbolId}`} (${e.code})`).join(', ')}{result.errors.length > 4 ? ` +${result.errors.length - 4} more` : ''}.
                </p>
              )}
              {result.matches.length === 0 ? (
                <div className="empty" style={{ padding: 30 }} data-testid="scan-no-matches">{t(lang, 'noMatches')}</div>
              ) : (
                <div className="scan-table-wrap" role="region" aria-label="Scan results" tabIndex={0}>
                  <table className="scan-table" data-testid="scan-table">
                    <caption className="sr-only">Market scan results — click a header to sort</caption>
                    <thead><tr>
                      <th scope="col"><button type="button" className="sort-btn" onClick={() => toggleSort('ticker')}>{t(lang, 'ticker')}{sortIcon('ticker')}</button></th>
                      <th scope="col"><button type="button" className="sort-btn" onClick={() => toggleSort('score')}>Score{sortIcon('score')}</button></th>
                      <th scope="col"><button type="button" className="sort-btn" onClick={() => toggleSort('lastClose')}>{t(lang, 'lastClose')}{sortIcon('lastClose')}</button></th>
                      <th scope="col"><button type="button" className="sort-btn" onClick={() => toggleSort('changePercent')}>{t(lang, 'dayChange')}{sortIcon('changePercent')}</button></th>
                      <th scope="col"><button type="button" className="sort-btn" onClick={() => toggleSort('date')}>Date{sortIcon('date')}</button></th>
                      <th scope="col">{t(lang, 'rule')}</th>
                    </tr></thead>
                    <tbody>
                      {rows.map((m) => (
                        <tr key={`${m.symbolId}-${m.lastDate}`} data-testid="scan-row">
                          <td><b>{m.ticker}</b><div className="muted mono" style={{ fontSize: 'var(--fs-xs)' }}>{m.name || m.sector || '—'}</div></td>
                          <td className="tnum">{m.score ?? '—'}</td>
                          <td className="tnum">{money(m.lastClose)}</td>
                          <td className={`tnum ${m.changePercent >= 0 ? 'up' : 'down'}`}>{pct(m.changePercent)}</td>
                          <td className="tnum" style={{ fontSize: 'var(--fs-xs)' }}>{day(m.lastDate)}</td>
                          <td className="scan-rule-cell">{(m.matchedRules ?? []).map(r => r.rule).slice(0, 2).join(' · ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {!result && !running && !error && (
          <div className="empty panel" style={{ padding: 40 }} data-testid="scanner-empty">
            <div><Activity size={24} color="var(--accent)" style={{ margin: '0 auto 12px' }} /><p>Choose a universe and strategy, then run a scan.</p><p className="muted" style={{ fontSize: 'var(--fs-xs)' }}><Database size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> Cache {cache?.symbols ?? '—'} symbols · EOD {cache?.lastDate || '—'}</p></div>
          </div>
        )}
      </div>
    </div>
  );
}
