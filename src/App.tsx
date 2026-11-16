import React, { useState, useEffect, useRef } from 'react';
import { StrategyAST, SymbolMeta, BacktestResponse } from './shared/strategy/types';
import { STRATEGY_TEMPLATES } from './shared/strategy/templates';
import { loadWorkspaceState, saveWorkspaceWithLock, snapshotStrategy, RequestOwner, WORKSPACE_KEY, WorkspaceConflictError, type WorkspaceRevision } from './client/workspace';
import { readStrategyLibrary, commitStrategyLibrary } from './client/strategyLibrary';
import { scannerBacktestOptions } from './components/scanner/scannerRequestContext';
import { requestBacktest } from './client/api';
import type { RunRequestOptions } from './client/api';
import { rerunRequestOptions } from './client/rerun';
import { useLiveQuoteStatus } from './client/liveQuotes';
import { AppShell, type AppView } from './components/layout/AppShell';
import { AiCopilotDock } from './components/chat/AiCopilotDock';
import { StrategyBuilder } from './components/strategy/StrategyBuilder';
import { ResultsDashboard } from './components/results/ResultsDashboard';
import { MarketScannerView } from './components/scanner/MarketScannerView';
import { StrategyLibraryView } from './components/library/StrategyLibraryView';
import { ProviderSettings } from './components/settings/ProviderSettings';
import type { MarketUniverseType } from './components/scanner/MarketScannerView';
import { readPreferences, rememberPreference } from './client/preferences';
import { FEATURE_PREFILL_EVENT, parseFeaturePrefill, publishFeaturePrefill } from './client/featureHandoff';
import { buildChatDraft, type ScannerPrefill, type TesterPrefill, type UserPreferences } from './shared/contracts/featureRegistry';

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('chat');
  const [newConversationSignal, setNewConversationSignal] = useState(0);
  const [symbols, setSymbols] = useState<SymbolMeta[]>([]);
  const [dataMode, setDataMode] = useState<'real' | 'demo' | 'unknown'>('unknown');
  const liveQuoteStatus = useLiveQuoteStatus(dataMode === 'real');
  const [initialWorkspace] = useState(() => loadWorkspaceState(() => localStorage, STRATEGY_TEMPLATES[0].strategy, { deferLegacyCommit: true }));
  const [strategy, setStrategy] = useState<StrategyAST>(initialWorkspace.strategy);
  const initialStrategy = useRef(initialWorkspace.strategy);
  const hasEdited = useRef(false);
  const reloadedNotice = useRef(false);
  const savedRevision = useRef<WorkspaceRevision>(initialWorkspace.revision);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveGeneration = useRef(0);
  const [backtestResult, setBacktestResult] = useState<BacktestResponse | null>(null);
  const [runDraftSignature, setRunDraftSignature] = useState<string | null>(null);
  const [previousStrategy, setPreviousStrategy] = useState<StrategyAST | null>(null);
  const [comparisonResults, setComparisonResults] = useState<BacktestResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [runError, setRunError] = useState('');
  const [saveStatus, setSaveStatus] = useState('Saving');
  const [workspaceConflict, setWorkspaceConflict] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences>(() => readPreferences());
  const [testerPrefill, setTesterPrefill] = useState<TesterPrefill | null>(null);
  const [scannerPrefill, setScannerPrefill] = useState<ScannerPrefill | null>(null);
  const owner = useRef(new RequestOwner());
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    // Reloading or mounting the persisted workspace is not an edit: saving it
    // again would mint a new savedAt/revision and fabricate cross-tab conflicts.
    // Only the first effect for that loaded object may skip; later changes,
    // including an undo back to it, must still persist. The ref guard also keeps
    // React StrictMode's double-invoked mount effect from saving.
    if (!hasEdited.current && strategy === initialStrategy.current) {
      setSaveStatus(reloadedNotice.current
        ? 'Reloaded the workspace saved in this browser. Unsaved draft changes were discarded.'
        : savedRevision.current === null
          ? 'Workspace unchanged; no local save yet'
          : 'Workspace unchanged; saved locally');
      reloadedNotice.current = false;
      return;
    }
    hasEdited.current = true;
    const generation = ++saveGeneration.current;
    let mounted = true;
    setSaveStatus('Saving locally');
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      if (generation !== saveGeneration.current) return;
      const saved = await saveWorkspaceWithLock(localStorage, strategy, savedRevision.current);
      savedRevision.current = saved.revision;
      if (mounted && generation === saveGeneration.current) {
        setWorkspaceConflict(false);
        setSaveStatus(saved.recoveryRetained ? 'Saved locally; rejected workspace retained in a recovery backup' : 'Saved locally');
      }
    }).catch(error => {
      if (mounted && generation === saveGeneration.current) {
        setSaveStatus('Not saved: ' + (error as Error).message);
        setWorkspaceConflict(error instanceof WorkspaceConflictError);
      }
    });
    return () => { mounted = false; };
  }, [strategy]);

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === WORKSPACE_KEY && event.newValue !== savedRevision.current) {
        setWorkspaceConflict(true);
        setSaveStatus('Not saved: another browser tab changed this workspace. Your draft is retained; export it before replacing or reloading.');
      }
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

  useEffect(() => {
    const onPrefill = (event: Event) => {
      const prefill = parseFeaturePrefill((event as CustomEvent<unknown>).detail);
      if (!prefill) return;
      if (prefill.feature === 'strategy_tester' || prefill.feature === 'market_scanner') {
        try {
          changeStrategy(snapshotStrategy(prefill.strategy));
        } catch (error) {
          setRunError((error as Error).message);
          return;
        }
        setPreferences(rememberPreference({ symbolId: prefill.strategy.universe.symbolId, ticker: prefill.strategy.universe.ticker }));
        if (prefill.feature === 'strategy_tester') {
          setTesterPrefill(prefill);
          setActiveView('builder');
        } else {
          setScannerPrefill(prefill);
          setPreferences(rememberPreference({ universe: prefill.universe }));
          setActiveView('scanner');
        }
      }
      // chat_draft is owned by the copilot composer (chat/**); this side only publishes it.
    };
    window.addEventListener(FEATURE_PREFILL_EVENT, onPrefill);
    return () => window.removeEventListener(FEATURE_PREFILL_EVENT, onPrefill);
  }, [strategy]);

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
  const handleSymbolChange = (symbolId: number) => {
    changeStrategy(snapshotStrategy(strategy, symbolId));
    const symbol = symbols.find(item => item.id === symbolId);
    setPreferences(rememberPreference({ symbolId, ...(symbol ? { ticker: symbol.ticker } : {}) }));
  };

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

  const handleRunBacktest = async (options: RunRequestOptions = {}) => {
    setTesterPrefill(null);
    try { await runSnapshot(strategy, true, options); } catch { /* Visible error is owned above. */ }
  };

  /** "Describe in chat" publishes a validated ChatDraft for the copilot composer. */
  const handleDescribeInChat = () => {
    const ticker = symbols.find(item => item.id === strategy.universe.symbolId)?.ticker;
    const draft = buildChatDraft({
      prompt: `Refine “${strategy.name}”${ticker ? ' on ' + ticker : ''}. Keep the current entry, exit, risk and costs and suggest one concrete change.`,
      source: 'strategy_tester',
      // buildChatDraft validates through the schema; the clone drops interface-only fields.
      strategy: JSON.parse(JSON.stringify(strategy)),
      context: { symbolId: strategy.universe.symbolId, ...(ticker ? { ticker } : {}) },
    });
    publishFeaturePrefill(draft);
    setRunError('');
    setActiveView('chat');
  };

  /** Re-run the displayed immutable result and its stored request window, not the draft. */
  const handleReSimulate = async (result?: BacktestResponse) => {
    if (!result) {
      await handleRunBacktest();
      return;
    }
    try { await runSnapshot(result.strategy, true, rerunRequestOptions(result)); } catch { /* Visible error is owned above. */ }
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

  const handleResearchBacktest = async (input: StrategyAST, asOf?: string, runOptions?: RunRequestOptions) => {
    // The chat review freezes its exact tester inputs (start/end/asOf/capital/seed/
    // robustness). An additive third argument keeps the older asOf-only callers
    // working while the reviewed run finally uses the window it displayed.
    if (runOptions) return await runSnapshot(input, false, { ...runOptions, ...(asOf && !runOptions.asOf ? { asOf } : {}) });
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

  const reloadWorkspace = () => {
    saveGeneration.current++;
    invalidateRun();
    setWorkspaceConflict(false);
    reloadedNotice.current = true;
    // Wait for any in-flight save to settle before reading the stored bytes.
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => {
      const loaded = loadWorkspaceState(() => localStorage, STRATEGY_TEMPLATES[0].strategy);
      savedRevision.current = loaded.revision;
      initialStrategy.current = loaded.strategy;
      hasEdited.current = false;
      setPreviousStrategy(null);
      setStrategy(loaded.strategy);
    }).catch(error => {
      reloadedNotice.current = false;
      setSaveStatus('Not saved: ' + (error as Error).message);
    });
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
      {workspaceConflict && (
        <button
          type="button"
          onClick={reloadWorkspace}
          title="Discard unsaved draft changes and load the workspace saved in this browser"
          className="ml-3 underline decoration-neutral-600 underline-offset-2 hover:text-neutral-300"
        >
          Reload workspace
        </button>
      )}
      {saveStatus.startsWith('Not saved:') && <button type="button" onClick={exportDraft} className="ml-3 underline decoration-neutral-600 underline-offset-2 hover:text-neutral-300">Export unsaved draft</button>}
    </div>
  );

  return (
    <AppShell
      activeView={activeView}
      onNavigate={setActiveView}
      onNewChat={handleNewChat}
      dataMode={dataMode}
      liveQuotes={liveQuoteStatus}
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
          onOpenDetails={result => {
            invalidateRun();
            setBacktestResult(result);
            // The details view now shows the exact run retained by the chat,
            // not the current builder draft.
            setRunDraftSignature(null);
            setActiveView('results');
          }}
          onSaveStrategy={saveStrategyToLibrary}
          onCancelResearch={invalidateRun}
          newConversationSignal={newConversationSignal}
        />
      </div>

      {activeView === 'builder' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <StrategyBuilder
            strategy={strategy}
            onChange={changeStrategy}
            onRunBacktest={handleRunBacktest}
            isLoading={isLoading}
            symbols={symbols}
            onSymbolChange={handleSymbolChange}
            showReferencePrices={dataMode === 'demo'}
            onDescribeInChat={handleDescribeInChat}
            prefill={testerPrefill}
            onPrefillDismiss={() => setTesterPrefill(null)}
            initialWindow={preferences.dateRange === 'last-1y' ? '1y' : preferences.dateRange === 'last-5y' ? '5y' : preferences.dateRange === 'custom' ? 'max' : '3y'}
            onWindowChange={dateRange => setPreferences(rememberPreference({ dateRange }))}
          />
        </div>
      )}

      {activeView === 'results' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ResultsDashboard
            result={backtestResult}
            comparisonResults={comparisonResults}
            onReRun={handleReSimulate}
            onApplyStrategy={handleLoadStrategy}
            onUpdateComparisonList={setComparisonResults}
            onSelectActiveResult={result => {
              invalidateRun();
              setBacktestResult(result);
              setRunDraftSignature(null);
            }}
            isLoading={isLoading}
            draftName={strategy.name}
            onOpenTester={() => setActiveView('builder')}
          />
        </div>
      )}

      {activeView === 'scanner' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MarketScannerView
            strategy={strategy}
            prefill={scannerPrefill}
            onPrefillDismiss={() => setScannerPrefill(null)}
            initialUniverse={preferences.universe as MarketUniverseType}
            onUniverseChange={universe => setPreferences(rememberPreference({ universe }))}
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

      {activeView === 'settings' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ProviderSettings />
        </div>
      )}
    </AppShell>
  );
}
