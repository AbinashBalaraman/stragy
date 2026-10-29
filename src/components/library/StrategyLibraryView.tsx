import React, { useEffect, useRef, useState } from 'react';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import { StrategyAST } from '../../shared/strategy/types';
import { BookOpen, ArrowRight } from 'lucide-react';
import { renderStrategyInPlainLanguage } from '../../shared/strategy/renderPlainLanguage';

import { parseStrategy } from '../../client/workspace';
import { commitStrategyLibrary, exportSavedStrategy, getSavedStrategy, readStrategyLibrary, STRATEGY_LIBRARY_KEY, StrategyLibraryConflictError } from '../../client/strategyLibrary';
import type { LibraryOperation, SavedStrategy, StrategyLibraryState } from '../../client/strategyLibrary';

export interface StrategyLibraryViewProps {
  onLoadStrategy: (strategy: StrategyAST) => void;
  currentStrategy?: StrategyAST;
}

const controlClass = 'rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200 disabled:opacity-40';
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
    } catch (e) { setError('Cannot access My Strategies: ' + errorMessage(e)); }
  };
  useEffect(() => {
    reload();
    const changed = (event: StorageEvent) => {
      if (event.key === STRATEGY_LIBRARY_KEY || event.key === null) {
        setStale(true); setNotice('');
        setError('My Strategies changed in another tab. Reload the library before saving. Your builder draft is unchanged.');
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  const commit = async (operation: LibraryOperation, success: string) => {
    if (!library || stale || committing.current) return;
    committing.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const next = await commitStrategyLibrary(window.localStorage, library.revision, operation);
      setLibrary(next); setRevisions({}); setRenameId(null);
      setNotice(success + (library.corrupt ? ' Original corrupt bytes were retained in a recovery backup.' : ''));
    } catch (e) {
      if (e instanceof StrategyLibraryConflictError) setStale(true);
      setError('Not saved: ' + errorMessage(e));
    } finally { committing.current = false; setBusy(false); }
  };
  const exportEntry = (entry: SavedStrategy, revision: number) => {
    let url: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    try {
      const json = exportSavedStrategy(entry, revision);
      url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      anchor = document.createElement('a'); anchor.href = url;
      anchor.download = getSavedStrategy(entry, revision).name.replace(/[^a-z0-9_-]/gi, '_') + '-r' + revision + '.json';
      document.body.appendChild(anchor); anchor.click();
      setError(''); setNotice('Validated JSON download requested.');
    } catch (e) { setNotice(''); setError('Export failed: ' + errorMessage(e)); }
    finally { anchor?.remove(); if (url) URL.revokeObjectURL(url); }
  };
  const disabled = busy || stale || !library;
  const entries = library?.entries.filter(entry => Boolean(entry.deletedAt) === trash) ?? [];
  return (
    <section aria-labelledby="my-strategies-title" className="bg-[#171719]/90 border border-neutral-800 rounded-2xl p-5 space-y-4">
      <h2 id="my-strategies-title" className="text-lg font-bold text-white">My Strategies</h2>
      <p className="text-xs text-neutral-400">Saved only in this browser. Save is explicit, not automatic. Up to 50 strategies including trash, 20 immutable revisions each, 200 revisions total and 1 MiB. Nothing is automatically removed.</p>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
      {library?.corrupt && <p role="alert" className="text-sm text-amber-300">Stored library is invalid and has not been overwritten. An explicit save starts a fresh library only after preserving the original bytes. Existing recovery backup conflicts will block the save.</p>}
      <form className="flex flex-wrap gap-2" onSubmit={event => {
        event.preventDefault();
        if (currentStrategy) void commit({ type: 'saveAs', strategy: currentStrategy, name: name.trim() || currentStrategy.name }, 'Strategy saved as a new copy.');
      }}>
        <input aria-label="Save as name" maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder={currentStrategy?.name ?? 'Open a strategy in the builder first'} className={controlClass + ' bg-neutral-950'} disabled={disabled || !currentStrategy} />
        <button type="submit" className={controlClass} disabled={disabled || !currentStrategy}>Save current strategy as new</button>
        <button type="button" onClick={reload} disabled={busy} className={controlClass}>Reload library</button>
      </form>
      {!currentStrategy && <p className="text-xs text-neutral-400">No current builder strategy is available to save.</p>}
      <div className="flex gap-2">
        <button type="button" aria-pressed={!trash} onClick={() => setTrash(false)} className={controlClass}>Saved strategies</button>
        <button type="button" aria-pressed={trash} onClick={() => setTrash(true)} className={controlClass}>Trash ({library?.entries.filter(e => e.deletedAt).length ?? 0})</button>
      </div>
      {library && entries.length === 0 && <p className="text-xs text-neutral-400">{trash ? 'Trash is empty.' : 'No saved strategies yet.'}</p>}
      {entries.map(entry => {
        const latest = entry.revisions[entry.revisions.length - 1];
        const selected = revisions[entry.id] ?? latest.revision;
        return <article key={entry.id} aria-label={latest.strategy.name} className="rounded-xl border border-neutral-800 p-3 space-y-2">
          <h3 className="text-sm font-semibold text-white">{latest.strategy.name}</h3>
          <label className="text-xs text-neutral-400">Saved revision <select aria-label={'Revision for ' + latest.strategy.name} value={selected} onChange={e => setRevisions(prev => ({ ...prev, [entry.id]: Number(e.target.value) }))} className={controlClass + ' bg-neutral-950 ml-2'}>
            {entry.revisions.map(rev => <option key={rev.revision} value={rev.revision}>r{rev.revision}: {rev.strategy.name} ({rev.savedAt})</option>)}
          </select></label>
          {renameId === entry.id && <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void commit({ type: 'rename', id: entry.id, name: renameName }, 'Strategy renamed; previous revision retained.'); }}>
            <input aria-label="New strategy name" required maxLength={80} value={renameName} onChange={e => setRenameName(e.target.value)} className={controlClass + ' bg-neutral-950'} />
            <button type="submit" disabled={disabled || !renameName.trim()} className={controlClass}>Confirm rename</button>
            <button type="button" onClick={() => setRenameId(null)} className={controlClass}>Cancel rename</button>
          </form>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { try { onLoadStrategy(getSavedStrategy(entry, selected)); } catch (e) { setError(errorMessage(e)); } }} className={controlClass}>Load saved revision</button>
            <button type="button" onClick={() => exportEntry(entry, selected)} className={controlClass}>Export JSON</button>
            {trash ? <button type="button" disabled={disabled} onClick={() => void commit({ type: 'restore', id: entry.id }, 'Strategy restored.')} className={controlClass}>Restore</button> : <>
              <button type="button" disabled={disabled} onClick={() => { setRenameId(entry.id); setRenameName(latest.strategy.name); }} className={controlClass}>Rename</button>
              <button type="button" disabled={disabled} onClick={() => void commit({ type: 'duplicate', id: entry.id, revision: selected }, 'Strategy duplicated with a new identity.')} className={controlClass}>Duplicate</button>
              <button type="button" disabled={disabled || !currentStrategy} onClick={() => { if (currentStrategy) void commit({ type: 'revise', id: entry.id, strategy: currentStrategy }, 'Current strategy saved as a new immutable revision.'); }} className={controlClass}>Save current as new revision</button>
              <button type="button" disabled={disabled} onClick={() => void commit({ type: 'delete', id: entry.id }, 'Strategy moved to trash. All revisions retained.')} className={controlClass}>Move to trash</button>
            </>}
          </div>
        </article>;
      })}
    </section>
  );
}

export const StrategyLibraryView: React.FC<StrategyLibraryViewProps> = ({ onLoadStrategy, currentStrategy }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  const categories = ['ALL', 'Trend Following', 'Mean Reversion', 'Volatility', 'Momentum', 'Breakout', 'Institutional'];

  const filteredTemplates = STRATEGY_TEMPLATES.filter(
    t => selectedCategory === 'ALL' || t.category === selectedCategory
  );

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5 pb-20">
      <MyStrategies onLoadStrategy={onLoadStrategy} currentStrategy={currentStrategy} />
      {/* Header */}
      <div className="bg-[#171719]/90 border border-[rgba(236,236,237,0.08)] rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
            <BookOpen className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">Research Strategy Examples ({STRATEGY_TEMPLATES.length} Templates)</h2>
            <p className="text-xs text-neutral-400">
              Validated strategy examples with illustrative, unverified cash-fee assumptions. Performance is not pre-certified.
            </p>
          </div>
        </div>

        {/* Category Filters */}
        <div className="flex flex-wrap gap-1.5 pt-2 border-t border-[rgba(236,236,237,0.08)]/80">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                selectedCategory === cat
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                  : 'bg-[#101012] text-neutral-400 hover:text-white border border-[rgba(236,236,237,0.08)]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Templates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredTemplates.map(tmpl => {
          const plainLang = renderStrategyInPlainLanguage(tmpl.strategy);

          return (
            <div
              key={tmpl.id}
              className="p-5 bg-[#171719]/90 border border-[rgba(236,236,237,0.08)] rounded-2xl hover:border-purple-500/50 transition-all flex flex-col justify-between space-y-4 shadow-sm"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                    {tmpl.category}
                  </span>
                  <span className="text-[11px] font-mono text-emerald-400 font-semibold">
                    {tmpl.expectedWinRate}
                  </span>
                </div>

                <div>
                  <h3 className="font-bold text-base text-white">{tmpl.name}</h3>
                  <p className="text-xs text-neutral-300 mt-1 leading-relaxed">{tmpl.description}</p>
                </div>

                <div className="p-3 bg-[#101012]/80 border border-[rgba(236,236,237,0.08)]/80 rounded-xl text-xs space-y-1.5 text-neutral-400">
                  <div>
                    <strong className="text-neutral-300">Suitability: </strong>
                    <span>{tmpl.suitability}</span>
                  </div>
                  <div>
                    <strong className="text-neutral-300">Entry Logic: </strong>
                    <span className="font-mono text-[11px] text-cyan-300">{plainLang.entrySummary.join(' & ')}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => onLoadStrategy(parseStrategy(JSON.parse(JSON.stringify(tmpl.strategy))))}
                className="w-full py-2.5 rounded-xl bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white font-bold text-xs border border-purple-500/30 flex items-center justify-center gap-2 transition-all shadow-sm group"
              >
                <span>Load Template into Builder</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
