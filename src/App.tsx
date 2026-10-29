import React, { useState, useEffect, useRef } from 'react';
import { StrategyAST, SymbolMeta, BacktestResponse } from './shared/strategy/types';
import { STRATEGY_TEMPLATES } from './shared/strategy/templates';
import { loadWorkspaceState, saveWorkspaceWithLock, snapshotStrategy, RequestOwner, WORKSPACE_KEY, type WorkspaceRevision } from './client/workspace';
import { readStrategyLibrary, commitStrategyLibrary } from './client/strategyLibrary';
import { scannerBacktestOptions } from './components/scanner/scannerRequestContext';
import { requestBacktest } from './client/api';
import type { RunRequestOptions } from './client/api';
import { AppShell, type AppView } from './components/layout/AppShell';
import { AiCopilotDock } from './components/chat/AiCopilotDock';
import { StrategyBuilder } from './components/strategy/StrategyBuilder';
import { ResultsDashboard } from './components/results/ResultsDashboard';
import { MarketScannerView } from './components/scanner/MarketScannerView';
import { StrategyLibraryView } from './components/library/StrategyLibraryView';
import { SymbolSearchSelector } from './components/layout/SymbolSearchSelector';

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('chat');
  const [newConversationSignal, setNewConversationSignal] = useState(0);
  const [symbols, setSymbols] = useState<SymbolMeta[]>([]);
  const [dataMode, setDataMode] = useState<'real' | 'demo' | 'unknown'>('unknown');
  const [initialWorkspace] = useState(() => loadWorkspaceState(() => localStorage, STRATEGY_TEMPLATES[0].strategy, { deferLegacyCommit: true }));
  const [strategy, setStrategy] = useState<StrategyAST>(initialWorkspace.strategy);
  const savedRevision = useRef<WorkspaceRevision>(initialWorkspace.revision);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveGeneration = useRef(0);
  const currentSymbolId = strategy.universe.symbolId;
  const [backtestResult, setBacktestResult] = useState<BacktestResponse | null>(null);
  const [runDraftSignature, setRunDraftSignature] = useState<string | null>(null);
  const [previousStrategy, setPreviousStrategy] = useState<StrategyAST | null>(null);
  const [comparisonResults, setComparisonResults] = useState<BacktestResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [runError, setRunError] = useState('');
  const [saveStatus, setSaveStatus] = useState('Saving');
  const owner = useRef(new RequestOwner());
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const generation = ++saveGeneration.current;
    let mounted = true;
    setSaveStatus('Saving locally');
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      if (generation !== saveGeneration.current) return;
      const saved = await saveWorkspaceWithLock(localStorage, strategy, savedRevision.current);
      savedRevision.current = saved.revision;
      if (mounted && generation === saveGeneration.current) setSaveStatus(saved.recoveryRetained ? 'Saved locally; rejected workspace retained in a recovery backup' : 'Saved locally');
    }).catch(error => {
      if (mounted && generation === saveGeneration.current) setSaveStatus('Not saved: ' + (error as Error).message);
    });
    return () => { mounted = false; };
  }, [strategy]);

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === WORKSPACE_KEY && event.newValue !== savedRevision.current) setSaveStatus('Not saved: another browser tab changed this workspace. Your draft is retained; export it before replacing or reloading.');
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/symbols', { signal: abort.signal }).then(response => {
      if (!response.ok) throw new Error('Symbol service unavailable');
      return response.json();
    }).then(data => {
      if (!Array.isArray(data.symbols)) throw new Error('Invalid symbols response');
      setSymbols(data.symbols);
      setDataMode(data.mode === 'real' ? 'real' : data.mode === 'demo' ? 'demo' : 'unknown');
    }).catch(error => {
      if (!abort.signal.aborted) setRunError((error as Error).message);
    });
    return () => {
      abort.abort();
      controller.current?.abort();
      owner.current.invalidate();
    };
  }, []);

  const invalidateRun = () => {
    owner.current.invalidate();
    controller.current?.abort();
    setIsLoading(false);
  };
  const changeStrategy = (next: StrategyAST) => {
    invalidateRun();
    setPreviousStrategy(strategy);
    setStrategy(next);
  };
  const undoDraftChange = () => {
    if (previousStrategy) {
      invalidateRun();
      setStrategy(previousStrategy);
      setPreviousStrategy(null);
    }
  };
  const handleSymbolChange = (symbolId: number) => changeStrategy(snapshotStrategy(strategy, symbolId));

  const runSnapshot = async (input: StrategyAST, switchToResults = true, options: RunRequestOptions = {}): Promise<BacktestResponse | null> => {
    const inputSignature = JSON.stringify(input);
    let snapshot: StrategyAST;
    try {
      snapshot = snapshotStrategy(input);
    } catch (error) {
      setRunError((error as Error).message);
      throw error;
    }
    controller.current?.abort();
    controller.current = new AbortController();
    const id = owner.current.begin();
    setIsLoading(true);
    setRunError('');
    try {
      const result = await requestBacktest(snapshot, controller.current.signal, options);
      if (!owner.current.owns(id)) return null;
      setBacktestResult(result);
      setRunDraftSignature(inputSignature);
      if (switchToResults) setActiveView('results');
      return result;
    } catch (error) {
      if (owner.current.owns(id)) {
        setRunError((error as Error).message);
        throw error;
      }
      return null;
    } finally {
      if (owner.current.owns(id)) setIsLoading(false);
    }
  };

  const handleRunBacktest = async () => {
    try { await runSnapshot(strategy); } catch { /* Visible error is owned above. */ }
  };

  /** Library/template loads intentionally open the advanced builder. */
  const handleLoadStrategy = (input: StrategyAST) => {
    try {
      changeStrategy(snapshotStrategy(input));
      setActiveView('builder');
      return true;
    } catch (error) {
      setRunError((error as Error).message);
      return false;
    }
  };

  /** Chat apply updates the workspace draft only; it must not force the builder. */
  const handleApplyVariation = (input: StrategyAST) => {
    try {
      changeStrategy(snapshotStrategy(input));
      return true;
    } catch (error) {
      setRunError((error as Error).message);
      return false;
    }
  };

  const handleResearchBacktest = async (input: StrategyAST, asOf?: string) => {
    return await runSnapshot(input, false, asOf ? scannerBacktestOptions(asOf) : {});
  };

  const saveStrategyToLibrary = async (input: StrategyAST) => {
    const draft = snapshotStrategy(input);
    const library = readStrategyLibrary(localStorage);
    const next = await commitStrategyLibrary(localStorage, library.revision, { type: 'saveAs', strategy: draft, name: draft.name });
    const saved = next.entries.at(-1);
    return { name: saved?.revisions.at(-1)?.strategy.name ?? draft.name };
  };

  const handleNewChat = () => {
    setNewConversationSignal(signal => signal + 1);
    setActiveView('chat');
    setRunError('');
  };

  const exportDraft = () => {
    const blob = new Blob([JSON.stringify(strategy, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'stragy-draft.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const footer = (
    <div className="space-y-1.5">
      <p role="status" aria-live="polite">
        {saveStatus}
        {backtestResult && (runDraftSignature === null
          ? ' · Retained run selected; builder draft unchanged'
          : JSON.stringify(strategy) !== runDraftSignature
            ? ' · Draft changed since this run'
            : '')}
      </p>
      {previousStrategy && <button type="button" onClick={undoDraftChange} className="underline decoration-neutral-600 underline-offset-2 hover:text-neutral-300">Undo last draft change</button>}
      {saveStatus.startsWith('Not saved:') && <button type="button" onClick={exportDraft} className="ml-3 underline decoration-neutral-600 underline-offset-2 hover:text-neutral-300">Export unsaved draft</button>}
    </div>
  );

  return (
    <AppShell
      activeView={activeView}
      onNavigate={setActiveView}
      onNewChat={handleNewChat}
      dataMode={dataMode}
      footer={footer}
    >
      {runError && (
        <div role="alert" className="shrink-0 border-b border-red-400/20 bg-red-400/5 px-4 py-2 text-xs text-red-200 sm:px-6">
          {runError}
        </div>
      )}

      <div
        hidden={activeView !== 'chat'}
        style={activeView === 'chat' ? undefined : { display: 'none' }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <AiCopilotDock
          variant="full"
          strategy={strategy}
          symbols={symbols}
          onApplyVariation={handleApplyVariation}
          onResearchBacktest={handleResearchBacktest}
          onOpenDetails={() => setActiveView('results')}
          onSaveStrategy={saveStrategyToLibrary}
          onCancelResearch={invalidateRun}
          newConversationSignal={newConversationSignal}
        />
      </div>

      {activeView === 'builder' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 pt-4 text-xs text-neutral-400 sm:px-6">
            <span>Instrument</span>
            <SymbolSearchSelector
              symbols={symbols}
              showReferencePrices={dataMode === 'demo'}
              currentSymbolId={currentSymbolId}
              onSymbolChange={handleSymbolChange}
            />
          </div>
          <StrategyBuilder
            strategy={strategy}
            onChange={changeStrategy}
            onRunBacktest={handleRunBacktest}
            isLoading={isLoading}
          />
        </div>
      )}

      {activeView === 'results' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ResultsDashboard
            result={backtestResult}
            comparisonResults={comparisonResults}
            onReRun={handleRunBacktest}
            onApplyStrategy={handleLoadStrategy}
            onUpdateComparisonList={setComparisonResults}
            onSelectActiveResult={result => {
              invalidateRun();
              setBacktestResult(result);
              setRunDraftSignature(null);
            }}
            isLoading={isLoading}
          />
        </div>
      )}

      {activeView === 'scanner' && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <MarketScannerView
            strategy={strategy}
            onSelectStockAndBacktest={(symbolId, asOf) => {
              const next = snapshotStrategy(strategy, symbolId);
              changeStrategy(next);
              setActiveView('results');
              void runSnapshot(next, true, scannerBacktestOptions(asOf)).catch(() => {});
            }}
          />
        </div>
      )}

      {activeView === 'library' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <StrategyLibraryView onLoadStrategy={handleLoadStrategy} currentStrategy={strategy} />
        </div>
      )}
    </AppShell>
  );
}
