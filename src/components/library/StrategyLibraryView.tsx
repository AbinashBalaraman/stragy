import React, { useEffect, useRef, useState } from 'react';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import { StrategyAST } from '../../shared/strategy/types';
import { formatDateTime } from '../../shared/format';
import { BookOpen, ArrowRight } from 'lucide-react';
import { renderStrategyInPlainLanguage } from '../../shared/strategy/renderPlainLanguage';

import { parseStrategy } from '../../client/workspace';
import { commitStrategyLibrary, exportSavedStrategy, getSavedStrategy, readStrategyLibrary, STRATEGY_LIBRARY_KEY, StrategyLibraryConflictError } from '../../client/strategyLibrary';
import type { LibraryOperation, SavedStrategy, StrategyLibraryState } from '../../client/strategyLibrary';

export interface StrategyLibraryViewProps {
  onLoadStrategy: (strategy: StrategyAST) => void;
  currentStrategy?: StrategyAST;
}

const controlClass = 'min-w-0 max-w-full rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200 transition-colors hover:border-[#a8c7fa]/40 disabled:opacity-40';
const errorMessage = (error: unknown) => {
  // DOMException can belong to a different realm than Error (including quota/denial).
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Local library operation failed.';
};

function MyStrategies({ currentStrategy, onLoadStrategy }: StrategyLibraryViewProps) {
  const [library, setLibrary] = useState<StrategyLibraryState | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const committing = useRef(false);
  const [name, setName] = useState('');
  const [trash, setTrash] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [revisions, setRevisions] = useState<Record<string, number>>({});

  const reload = () => {
    try {
      setLibrary(readStrategyLibrary(window.localStorage));
      setStale(false); setError(''); setNotice(''); setRevisions({}); setRenameId(null);
    } catch (error) { setError('Cannot access My Strategies: ' + errorMessage(error)); }
  };

  useEffect(() => {
    reload();
    const changed = (event: StorageEvent) => {
      if (event.key === STRATEGY_LIBRARY_KEY || event.key === null) {
        setStale(true);
        setNotice('');
        setError('My Strategies changed in another tab. Reload the library before saving. Your builder draft is unchanged.');
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
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
      if (error instanceof StrategyLibraryConflictError) setStale(true);
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
      setNotice('Validated JSON download requested.');
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
    <section aria-labelledby="my-strategies-title" className="min-w-0 space-y-4 rounded-2xl border border-neutral-800 bg-[#171719]/90 p-4 sm:p-5">
      <h2 id="my-strategies-title" className="text-lg font-semibold text-white">My strategies</h2>
      <p className="text-xs leading-relaxed text-neutral-400">
        Saved only in this browser. Save is explicit, not automatic. Up to 50 strategies including trash, 20 immutable revisions each, 200 revisions total and 1 MiB. Nothing is automatically removed.
      </p>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
      {library?.corrupt && <p role="alert" className="text-sm text-amber-300">Stored library is invalid and has not been overwritten. An explicit save starts a fresh library only after preserving the original bytes. Existing recovery backup conflicts will block the save.</p>}

      <form className="flex flex-wrap gap-2" onSubmit={event => {
        event.preventDefault();
        if (currentStrategy) void commit({ type: 'saveAs', strategy: currentStrategy, name: name.trim() || currentStrategy.name }, 'Strategy saved as a new copy.');
      }}>
        <input
          aria-label="Save as name"
          maxLength={80}
          value={name}
          onChange={event => setName(event.target.value)}
          placeholder={currentStrategy?.name ?? 'Open a strategy in the builder first'}
          className={controlClass + ' min-w-0 flex-1 bg-neutral-950'}
          disabled={disabled || !currentStrategy}
        />
        <button type="submit" className={controlClass} disabled={disabled || !currentStrategy}>Save current strategy as new</button>
        <button type="button" onClick={reload} disabled={busy} className={controlClass}>Reload library</button>
      </form>
      {!currentStrategy && <p className="text-xs text-neutral-400">No current builder strategy is available to save.</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={!trash} onClick={() => setTrash(false)} className={`${controlClass} ${!trash ? 'border-[#a8c7fa]/50 text-[#a8c7fa]' : ''}`}>Saved strategies</button>
        <button type="button" aria-pressed={trash} onClick={() => setTrash(true)} className={`${controlClass} ${trash ? 'border-[#a8c7fa]/50 text-[#a8c7fa]' : ''}`}>Trash ({library?.entries.filter(entry => entry.deletedAt).length ?? 0})</button>
      </div>

      {library && entries.length === 0 && <p className="text-xs text-neutral-400">{trash ? 'Trash is empty.' : 'No saved strategies yet.'}</p>}

      {entries.map(entry => {
        const latest = entry.revisions[entry.revisions.length - 1];
        const selected = revisions[entry.id] ?? latest.revision;
        return (
          <article key={entry.id} aria-label={latest.strategy.name} className="min-w-0 space-y-2 rounded-xl border border-neutral-800 p-3">
            <h3 className="text-sm font-semibold text-white">{latest.strategy.name}</h3>
            <label className="block min-w-0 text-xs text-neutral-400">
              Saved revision
              <select
                aria-label={'Revision for ' + latest.strategy.name}
                value={selected}
                onChange={event => setRevisions(previous => ({ ...previous, [entry.id]: Number(event.target.value) }))}
                className={controlClass + ' mt-1 block w-full max-w-full truncate bg-neutral-950 sm:max-w-[30rem]'}
              >
                {entry.revisions.map(revision => (
                  <option key={revision.revision} value={revision.revision} title={`${formatDateTime(revision.savedAt)} — ${revision.strategy.name}`}>
                    {formatDateTime(revision.savedAt)} · r{revision.revision} · {revision.strategy.name}
                  </option>
                ))}
              </select>
            </label>

            {renameId === entry.id && (
              <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void commit({ type: 'rename', id: entry.id, name: renameName }, 'Strategy renamed; previous revision retained.'); }}>
                <input aria-label="New strategy name" required maxLength={80} value={renameName} onChange={event => setRenameName(event.target.value)} className={controlClass + ' min-w-0 flex-1 bg-neutral-950'} />
                <button type="submit" disabled={disabled || !renameName.trim()} className={controlClass}>Confirm rename</button>
                <button type="button" onClick={() => setRenameId(null)} className={controlClass}>Cancel rename</button>
              </form>
            )}

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { try { onLoadStrategy(getSavedStrategy(entry, selected)); } catch (error) { setError(errorMessage(error)); } }} className={controlClass}>Load saved revision</button>
              <button type="button" onClick={() => exportEntry(entry, selected)} className={controlClass}>Export JSON</button>
              {trash ? (
                <button type="button" disabled={disabled} onClick={() => void commit({ type: 'restore', id: entry.id }, 'Strategy restored.')} className={controlClass}>Restore</button>
              ) : (
                <>
                  <button type="button" disabled={disabled} onClick={() => { setRenameId(entry.id); setRenameName(latest.strategy.name); }} className={controlClass}>Rename</button>
                  <button type="button" disabled={disabled} onClick={() => void commit({ type: 'duplicate', id: entry.id, revision: selected }, 'Strategy duplicated with a new identity.')} className={controlClass}>Duplicate</button>
                  <button type="button" disabled={disabled || !currentStrategy} onClick={() => { if (currentStrategy) void commit({ type: 'revise', id: entry.id, strategy: currentStrategy }, 'Current strategy saved as a new immutable revision.'); }} className={controlClass}>Save current as new revision</button>
                  <button type="button" disabled={disabled} onClick={() => void commit({ type: 'delete', id: entry.id }, 'Strategy moved to trash. All revisions retained.')} className={controlClass}>Move to trash</button>
                </>
              )}
            </div>
          </article>
        );
      })}
    </section>
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

      <section className="space-y-3 rounded-2xl border border-[rgba(236,236,237,0.08)] bg-[#171719]/90 p-4 sm:p-5">
        <div className="flex items-start gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#a8c7fa]/30 bg-[#a8c7fa]/10 text-[#a8c7fa]">
            <BookOpen className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-white">Template strategies ({STRATEGY_TEMPLATES.length})</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-neutral-400">
              Validated examples with illustrative, unverified cash-fee assumptions. Performance is not pre-certified.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 border-t border-[rgba(236,236,237,0.08)] pt-3">
          {categories.map(category => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                selectedCategory === category.id
                  ? 'bg-[#a8c7fa] font-semibold text-[#101012]'
                  : 'border border-[rgba(236,236,237,0.08)] bg-[#101012] text-neutral-400 hover:text-white'
              }`}
            >
              {category.label}
            </button>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {filteredTemplates.map(template => {
          const plainLanguage = renderStrategyInPlainLanguage(template.strategy);
          return (
            <div key={template.id} className="flex flex-col justify-between space-y-4 rounded-2xl border border-[rgba(236,236,237,0.08)] bg-[#171719]/90 p-4 transition-colors hover:border-[#a8c7fa]/40 sm:p-5">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded border border-[#a8c7fa]/25 bg-[#a8c7fa]/10 px-2 py-0.5 text-[11px] font-medium text-[#a8c7fa]">
                    {template.category}
                  </span>
                  <span className="font-mono text-[11px] font-semibold text-[#a8c7fa]">{template.expectedWinRate}</span>
                </div>

                <div>
                  <h3 className="text-base font-semibold text-white">{template.name}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-300">{template.description}</p>
                </div>

                <div className="space-y-1.5 rounded-xl border border-[rgba(236,236,237,0.08)] bg-[#101012]/80 p-3 text-xs text-neutral-400">
                  <div>
                    <strong className="text-neutral-300">Suitability: </strong>
                    <span>{template.suitability}</span>
                  </div>
                  <div>
                    <strong className="text-neutral-300">Entry logic: </strong>
                    <span className="font-mono text-[11px] text-[#a8c7fa]">{plainLanguage.entrySummary.join(' & ')}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => onLoadStrategy(parseStrategy(JSON.parse(JSON.stringify(template.strategy))))}
                className="group flex w-full items-center justify-center gap-2 rounded-xl border border-[#a8c7fa]/35 bg-[#a8c7fa]/10 py-2.5 text-xs font-medium text-[#a8c7fa] transition-colors hover:bg-[#a8c7fa] hover:text-[#101012]"
              >
                <span>Load Template into Builder</span>
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
