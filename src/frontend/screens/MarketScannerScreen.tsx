import { useCallback, useRef, useState } from 'react';
import { Activity, Ban, Database, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import { requestScan, type ResearchJobProgress, type ScanResult } from '../../client/api';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import { plainRule } from '../../client/plainRules';
import { UNIVERSE_OPTIONS } from '../../shared/data/symbols';
import { useLang } from '../lang';
import { t } from '../i18n';
import type { CacheStats } from '../stragy/client';

type Props = { cache: CacheStats | null };

const money = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const day = (iso?: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'date unavailable');

/**
 * A single, quiet scanner page. All numbers come from /api/v2/scans via the
 * same requestScan/resume logic as the original app — no mock values here.
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
      const data = await requestScan(
        { universe, strategy: template.strategy, maxSymbols: Math.min(100, Math.max(1, limit)), limit: 100 },
        abort.signal,
        undefined,
        (p) => { if (!abort.signal.aborted) setProgress(p); },
      );
      if (!abort.signal.aborted) setResult(data);
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
                <input className="sel" type="number" min={1} max={100} value={limit} data-testid="scanner-limit" onChange={(e) => setLimit(Number(e.target.value))} disabled={running} />
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
              <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>Bounded to {Math.min(100, Math.max(1, limit))} symbols · {universe}</span>
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
              </div>
            </div>
            <div className="panel-body">
              <p className="disclaimer" style={{ marginTop: 0 }} data-testid="scan-summary">
                {result.scanned} scanned · {result.attempted} attempted · {result.succeeded} succeeded · {result.unavailable} unavailable · {result.failed} failed · EOD {result.asOf ? day(result.asOf) : (result.observationDates?.latest ? day(result.observationDates.latest) : 'not reported')}.
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
                    <caption className="sr-only">Market scan results</caption>
                    <thead><tr><th scope="col">{t(lang, 'ticker')}</th><th scope="col">{t(lang, 'lastClose')}</th><th scope="col">{t(lang, 'dayChange')}</th><th scope="col">{t(lang, 'rule')}</th></tr></thead>
                    <tbody>
                      {result.matches.map((m) => (
                        <tr key={`${m.symbolId}-${m.lastDate}`} data-testid="scan-row">
                          <td><b>{m.ticker}</b><div className="muted mono" style={{ fontSize: 'var(--fs-xs)' }}>{day(m.lastDate)}</div></td>
                          <td className="tnum">{money(m.lastClose)}</td>
                          <td className={`tnum ${m.changePercent >= 0 ? 'up' : 'down'}`}>{pct(m.changePercent)}</td>
                          <td className="scan-rule-cell">{m.matchedRules[0]?.rule || '—'}</td>
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
