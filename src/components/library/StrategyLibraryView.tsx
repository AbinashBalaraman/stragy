import React, { useEffect, useRef, useState } from 'react';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import { StrategyAST } from '../../shared/strategy/types';
import { formatDateTime } from '../../shared/format';

import { parseStrategy } from '../../client/workspace';
import { plainRule } from '../../client/plainRules';
import { commitStrategyLibrary, exportSavedStrategy, getSavedStrategy, readStrategyLibrary, STRATEGY_LIBRARY_KEY, StrategyLibraryConflictError } from '../../client/strategyLibrary';
import type { LibraryOperation, SavedStrategy, StrategyLibraryState } from '../../client/strategyLibrary';
import { CardShell } from '../common/CardShell';
import { Disclosure } from '../common/Disclosure';

export interface StrategyLibraryViewProps {
  onLoadStrategy: (strategy: StrategyAST) => void;
  currentStrategy?: StrategyAST;
}

const inputClass = 'min-w-0 w-full rounded-[var(--r-btn)] border border-[var(--line-strong)] bg-[#101012] px-3 py-2 text-xs text-[var(--text-1)] placeholder:text-[var(--text-3)] focus:border-[#a8c7fa]/60 focus:outline-none';
const secondaryClass = 'inline-flex min-h-9 items-center rounded-[var(--r-btn)] border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--text-2)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:text-[var(--text-disabled)]';
const textButtonClass = 'rounded-[var(--r-btn)] px-1.5 py-1 text-xs text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:text-[var(--text-disabled)]';
const errorMessage = (error: unknown) => {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Local library operation failed.';
};

const PLAIN_DESCRIPTIONS: Record<string, string> = {
  reliance_supertrend_ema_volume: 'Buys while price is above Supertrend and the 200-day average with volume above normal; exits below Supertrend.',
  supertrend_trend_following: 'Follows Supertrend while price stays above the 50-day average, with an ATR trailing stop.',
  golden_cross_sma: 'Buys when the 50-day average crosses above the 200-day average with volume expansion.',
  rsi_mean_reversion: 'Buys oversold pullbacks (RSI below 32) while price is above the 100-day average; exits when RSI is above 68.',
  bollinger_squeeze_breakout: 'Buys when price closes above the upper Bollinger band with an expanding candle body.',
  macd_momentum_crossover: 'Buys when the MACD line crosses above its signal line; an ATR stop trails the move.',
  atr_volatility_breakout: 'Buys when price breaks above the 20-day average plus two ATRs, with a trailing stop.',
  nr7_volatility_compression: 'Buys a narrow-range (NR7) breakout after a Bollinger squeeze.',
  rsi_trendline_breakout_near_lows: 'Buys when RSI recovers from below 36, breaks its falling trendline, and price sits near a 250-day low.',
};

const categoryLabel = (category: string) => {
  if (category === 'Institutional') return 'Systematic';
  return category.toLowerCase().replace(/^./, letter => letter.toUpperCase());
};

function MyStrategies({ currentStrategy, onLoadStrategy }: StrategyLibraryViewProps) {
  const [library, setLibrary] = useState<StrategyLibraryState | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const committing = useRef(false);
  const staleRef = useRef(false);
  const [name, setName] = useState('');
  const [trash, setTrash] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const [menuId, setMenuId] = useState<string | null>(null);

  const reload = () => {
    try {
      staleRef.current = false;
      setLibrary(readStrategyLibrary(window.localStorage));
      setStale(false); setError(''); setNotice(''); setRevisions({}); setRenameId(null);
    } catch (error) { setError('Cannot access My Strategies: ' + errorMessage(error)); }
  };

  useEffect(() => {
    reload();
    const changed = (event: StorageEvent) => {
      if (event.key === STRATEGY_LIBRARY_KEY || event.key === null) {
        staleRef.current = true;
        setStale(true);
        setNotice('');
        setError('My Strategies changed in another tab. It reloads automatically when you return to this tab.');
      }
    };
    // Cross-tab sync without a developer-facing reload button.
    const onActive = () => { if (staleRef.current) reload(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') onActive(); };
    window.addEventListener('storage', changed);
    window.addEventListener('focus', onActive);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('storage', changed);
      window.removeEventListener('focus', onActive);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const commit = async (operation: LibraryOperation, success: string) => {
    if (!library || stale || committing.current) return;
    committing.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await commitStrategyLibrary(window.localStorage, library.revision, operation);
      setLibrary(next);
      setRevisions({});
      setRenameId(null);
      setNotice(success + (library.corrupt ? ' Original corrupt bytes were retained in a recovery backup.' : ''));
    } catch (error) {
      if (error instanceof StrategyLibraryConflictError) { staleRef.current = true; setStale(true); }
      setError('Not saved: ' + errorMessage(error));
    } finally {
      committing.current = false;
      setBusy(false);
    }
  };

  const exportEntry = (entry: SavedStrategy, revision: number) => {
    let url: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    try {
      const json = exportSavedStrategy(entry, revision);
      url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = getSavedStrategy(entry, revision).name.replace(/[^a-z0-9_-]/gi, '_') + '-r' + revision + '.json';
      document.body.appendChild(anchor);
      anchor.click();
      setError('');
      setNotice('Download started.');
    } catch (error) {
      setNotice('');
      setError('Export failed: ' + errorMessage(error));
    } finally {
      anchor?.remove();
      if (url) URL.revokeObjectURL(url);
    }
  };

  const disabled = busy || stale || !library;
  const entries = library?.entries.filter(entry => Boolean(entry.deletedAt) === trash) ?? [];

  return (
    <CardShell
      title="My strategies"
      meta="Saved in this browser only. Saving is explicit; nothing is removed automatically."
    >
      <Disclosure summary="Storage limits">
        <p>Up to 50 strategies including trash, 20 immutable revisions each, 200 revisions in total, 1 MiB.</p>
      </Disclosure>

      {error && <p role="alert" className="text-xs text-[var(--down)]">{error}</p>}
      {notice && <p role="status" className="text-xs text-[var(--up)]">{notice}</p>}
      {library?.corrupt && <p role="alert" className="text-xs text-[#f5d383]">Stored library is invalid and has not been overwritten. An explicit save starts a fresh library only after preserving the original bytes.</p>}

      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={event => {
        event.preventDefault();
        if (currentStrategy) void commit({ type: 'saveAs', strategy: currentStrategy, name: name.trim() || currentStrategy.name }, 'Strategy saved as a new copy.');
      }}>
        <input
          aria-label="Save as name"
          maxLength={80}
          value={name}
          onChange={event => setName(event.target.value)}
          placeholder={currentStrategy?.name ?? 'Open a strategy in the tester first'}
          className={inputClass + ' sm:flex-1'}
          disabled={disabled || !currentStrategy}
        />
        <button type="submit" disabled={disabled || !currentStrategy} className="inline-flex min-h-9 items-center justify-center rounded-[var(--r-btn)] bg-[#a8c7fa] px-3 py-1.5 text-xs font-semibold text-[#101012] transition-colors hover:bg-[#c7dbff] disabled:cursor-not-allowed disabled:opacity-40">
          Save as new strategy
        </button>
      </form>
      {!currentStrategy && <p className="st-meta text-[var(--text-3)]">No current tester strategy is available to save.</p>}

      <div className="inline-flex w-fit items-center gap-1 rounded-[var(--r-btn)] bg-[var(--surface-2)] p-0.5" role="group" aria-label="Library filter">
        <button type="button" aria-pressed={!trash} onClick={() => setTrash(false)} className={'rounded-[var(--r-btn)] px-2.5 py-1 text-xs transition-colors ' + (!trash ? 'bg-white/[0.08] font-medium text-[var(--text-1)]' : 'text-[var(--text-3)] hover:text-[var(--text-2)]')}>Saved strategies</button>
        <button type="button" aria-pressed={trash} onClick={() => setTrash(true)} className={'rounded-[var(--r-btn)] px-2.5 py-1 text-xs transition-colors ' + (trash ? 'bg-white/[0.08] font-medium text-[var(--text-1)]' : 'text-[var(--text-3)] hover:text-[var(--text-2)]')}>Trash ({library?.entries.filter(entry => entry.deletedAt).length ?? 0})</button>
      </div>

      {library && entries.length === 0 && (
        <p className="st-meta text-[var(--text-3)]">
          {trash ? 'Trash is empty.' : 'No saved strategies yet. Run a backtest, then save it from the tester or ask in chat.'}
        </p>
      )}

      {entries.map(entry => {
        const latest = entry.revisions[entry.revisions.length - 1];
        const selected = revisions[entry.id] ?? latest.revision;
        const selectedRevision = entry.revisions.find(revision => revision.revision === selected) ?? latest;
        const menuOpen = menuId === entry.id;
        const menuItem = (label: string, onClick: () => void, disabled = false) => (
          <button
            key={label}
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => { setMenuId(null); onClick(); }}
            className="rounded-[var(--r-btn)] px-2.5 py-1 text-left text-xs text-[var(--text-2)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:text-[var(--text-disabled)]"
          >
            {label}
          </button>
        );
        return (
          <article key={entry.id} aria-label={latest.strategy.name} className="min-w-0 space-y-2 border-t border-[var(--line)] pt-3">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-[var(--text-1)]">{latest.strategy.name}</h3>
                <p className="st-meta mt-0.5 text-[var(--text-3)]">
                  Version {selected} of {entry.revisions.length} · saved {formatDateTime(selectedRevision.savedAt)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => { try { onLoadStrategy(getSavedStrategy(entry, selected)); } catch (error) { setError(errorMessage(error)); } }}
                  className="inline-flex min-h-9 items-center rounded-[var(--r-btn)] border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--text-1)] transition-colors hover:border-[var(--line-strong)]"
                >
                  Open in tester
                </button>
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label={'More actions for ' + latest.strategy.name}
                  onClick={() => setMenuId(current => current === entry.id ? null : entry.id)}
                  className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-[var(--r-btn)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]"
                >
                  <span aria-hidden="true">⋯</span>
                </button>
              </div>
            </div>

            {entry.revisions.length > 1 && (
              <label className="block min-w-0 text-xs text-[var(--text-3)]">
                Version
                <select
                  aria-label={'Revision for ' + latest.strategy.name}
                  value={selected}
                  onChange={event => setRevisions(previous => ({ ...previous, [entry.id]: Number(event.target.value) }))}
                  className={inputClass + ' mt-1 block max-w-full truncate sm:max-w-[30rem]'}
                >
                  {entry.revisions.map(revision => (
                    <option key={revision.revision} value={revision.revision} title={`${formatDateTime(revision.savedAt)} — ${revision.strategy.name}`}>
                      Version {revision.revision} · saved {formatDateTime(revision.savedAt)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {menuOpen && (
              <div role="menu" aria-label={'Actions for ' + latest.strategy.name} className="flex w-fit flex-col rounded-[var(--r-inner)] bg-[var(--surface-2)] p-1">
                {menuItem('Rename', () => { setRenameId(entry.id); setRenameName(latest.strategy.name); }, disabled)}
                {menuItem('Duplicate', () => void commit({ type: 'duplicate', id: entry.id, revision: selected }, 'Strategy duplicated with a new identity.'), disabled)}
                {menuItem('Export JSON', () => exportEntry(entry, selected))}
                {menuItem('Save current as new revision', () => { if (currentStrategy) void commit({ type: 'revise', id: entry.id, strategy: currentStrategy }, 'Current strategy saved as a new immutable revision.'); }, disabled || !currentStrategy)}
                {trash
                  ? menuItem('Restore', () => void commit({ type: 'restore', id: entry.id }, 'Strategy restored.'), disabled)
                  : menuItem('Move to trash', () => void commit({ type: 'delete', id: entry.id }, 'Strategy moved to trash. All revisions retained.'), disabled)}
              </div>
            )}

            {renameId === entry.id && (
              <form className="flex flex-col gap-2 sm:flex-row sm:flex-wrap" onSubmit={event => { event.preventDefault(); void commit({ type: 'rename', id: entry.id, name: renameName }, 'Strategy renamed; previous revision retained.'); }}>
                <input aria-label="New strategy name" required maxLength={80} value={renameName} onChange={event => setRenameName(event.target.value)} className={inputClass + ' sm:flex-1'} />
                <button type="submit" disabled={disabled || !renameName.trim()} className={secondaryClass}>Confirm rename</button>
                <button type="button" onClick={() => setRenameId(null)} className={secondaryClass}>Cancel rename</button>
              </form>
            )}
          </article>
        );
      })}
    </CardShell>
  );
}

export const StrategyLibraryView: React.FC<StrategyLibraryViewProps> = ({ onLoadStrategy, currentStrategy }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  const categories = [
    { id: 'ALL', label: 'All' },
    { id: 'Trend Following', label: 'Trend following' },
    { id: 'Mean Reversion', label: 'Mean reversion' },
    { id: 'Volatility', label: 'Volatility' },
    { id: 'Momentum', label: 'Momentum' },
    { id: 'Breakout', label: 'Breakout' },
    { id: 'Institutional', label: 'Systematic' },
  ];
  const filteredTemplates = STRATEGY_TEMPLATES.filter(template => selectedCategory === 'ALL' || template.category === selectedCategory);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 pb-20 sm:p-6">
      <MyStrategies onLoadStrategy={onLoadStrategy} currentStrategy={currentStrategy} />

      <header className="space-y-3">
        <div>
          <h2 className="st-title text-xl font-semibold text-[var(--text-1)]">Template strategies ({STRATEGY_TEMPLATES.length})</h2>
          <p className="st-meta mt-1 max-w-3xl text-[var(--text-3)]">
            Starting points. Costs are illustrative; results come from your own run.
          </p>
        </div>
        <div className="inline-flex flex-wrap items-center gap-1 rounded-[var(--r-btn)] bg-[var(--surface-2)] p-0.5" role="group" aria-label="Template category">
          {categories.map(category => (
            <button
              key={category.id}
              type="button"
              aria-pressed={selectedCategory === category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={'rounded-[var(--r-btn)] px-2.5 py-1 text-xs transition-colors ' + (selectedCategory === category.id ? 'bg-white/[0.08] font-medium text-[var(--text-1)]' : 'text-[var(--text-3)] hover:text-[var(--text-2)]')}
            >
              {category.label}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {filteredTemplates.map(template => {
          const entryRules = template.strategy.rules.entry;
          return (
            <CardShell
              key={template.id}
              title={template.name}
              meta={`${categoryLabel(template.category)} · illustrative costs`}
              footer={(
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => onLoadStrategy(parseStrategy(JSON.parse(JSON.stringify(template.strategy))))}
                    className="inline-flex min-h-9 items-center rounded-[var(--r-btn)] border border-[var(--line)] px-3 py-1 text-xs text-[var(--text-2)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--text-1)]"
                  >
                    Open in tester
                  </button>
                </div>
              )}
            >
              <p className="text-xs leading-5 text-[var(--text-2)]">{PLAIN_DESCRIPTIONS[template.id] ?? template.description}</p>
              <div>
                <p className="text-xs text-[var(--text-3)]">Entry</p>
                <ul className="mt-1 space-y-1 text-xs leading-5 text-[var(--text-2)]">
                  {entryRules.slice(0, 3).map((rule, index) => (
                    <li key={index}>{plainRule(rule, template.strategy.indicators)}</li>
                  ))}
                  {entryRules.length > 3 && <li className="text-[var(--text-3)]">and {entryRules.length - 3} more</li>}
                </ul>
              </div>
              <p className="st-meta leading-5 text-[var(--text-3)]">Suitable for: {template.suitability.replace(/\s*\([A-Z0-9.^]+\)/g, '')}</p>
            </CardShell>
          );
        })}
      </div>
    </div>
  );
};
