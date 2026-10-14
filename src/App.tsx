import React, { useState, useEffect, useRef } from 'react';
import { StrategyAST, SymbolMeta, BacktestResponse } from './shared/strategy/types';
import { STRATEGY_TEMPLATES } from './shared/strategy/templates';
import { loadWorkspaceState, saveWorkspaceWithLock, snapshotStrategy, RequestOwner, WORKSPACE_KEY, type WorkspaceRevision } from './client/workspace';
import { scannerBacktestOptions } from './components/scanner/scannerRequestContext';
import { requestBacktest } from './client/api';
import type { RunRequestOptions } from './client/api';
import { Navbar } from './components/layout/Navbar';
import { AiCopilotDock } from './components/chat/AiCopilotDock';
import { StrategyBuilder } from './components/strategy/StrategyBuilder';
import { ResultsDashboard } from './components/results/ResultsDashboard';
import { MarketScannerView } from './components/scanner/MarketScannerView';
import { StrategyLibraryView } from './components/library/StrategyLibraryView';
import { Bot, Sparkles, Layers, Radio, BookOpen, X } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'builder' | 'results' | 'scanner' | 'library'>('builder');
  const [symbols, setSymbols] = useState<SymbolMeta[]>([]);
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
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const owner = useRef(new RequestOwner());
  const controller = useRef<AbortController | null>(null);
  const toggleCopilot = () => setIsCopilotOpen(value => !value);
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
      if (event.key === WORKSPACE_KEY && event.newValue !== savedRevision.current) setSaveStatus('Not saved: another tab changed this workspace. Your draft is retained; export it before replacing or reloading.');
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/symbols', {signal:abort.signal}).then(r => {if (!r.ok) throw new Error('Symbol service unavailable'); return r.json();})
      .then(d => {if (!Array.isArray(d.symbols)) throw new Error('Invalid symbols response'); setSymbols(d.symbols);})
      .catch(e => {if (!abort.signal.aborted) setRunError(e.message);});
    return () => {abort.abort(); controller.current?.abort(); owner.current.invalidate();};
  }, []);
  const invalidateRun = () => {owner.current.invalidate(); controller.current?.abort(); setIsLoading(false);};
  const changeStrategy = (next: StrategyAST) => { invalidateRun(); setPreviousStrategy(strategy); setStrategy(next); };
  const undoDraftChange = () => { if (previousStrategy) { invalidateRun(); setStrategy(previousStrategy); setPreviousStrategy(null); } }; 
  const handleSymbolChange = (symbolId: number) => changeStrategy(snapshotStrategy(strategy, symbolId));
  const runSnapshot = async (input: StrategyAST, switchToResults = true, options: RunRequestOptions = {}) => {
    const inputSignature = JSON.stringify(input);
    let snapshot: StrategyAST;
    try { snapshot = snapshotStrategy(input); } catch (error) { setRunError((error as Error).message); throw error; }
    controller.current?.abort(); controller.current = new AbortController();
    const id = owner.current.begin(); setIsLoading(true); setRunError('');
    try {
      const result = await requestBacktest(snapshot, controller.current.signal, options);
      if (!owner.current.owns(id)) return;
      setBacktestResult(result); setRunDraftSignature(inputSignature); if (switchToResults) setActiveTab('results');
    } catch (error) { if (owner.current.owns(id)) {setRunError((error as Error).message); throw error;} }
    finally {if (owner.current.owns(id)) setIsLoading(false);}
  };
  const handleRunBacktest = async () => {try { await runSnapshot(strategy); } catch { /* Visible error is owned above tabs. */ }};
  const handleLoadStrategy = (input: StrategyAST) => { try {changeStrategy(snapshotStrategy(input)); setActiveTab('builder'); return true;} catch(e) {setRunError((e as Error).message); return false;} };
  const exportDraft = () => {
    const blob = new Blob([JSON.stringify(strategy, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'stragy-draft.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };


  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#0c0c0e] text-[#ececed] flex flex-col font-sans selection:bg-[#00ffa3] selection:text-[#0c0c0e]">
      {/* Top Fixed Institutional Navigation Header */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        symbols={symbols}
        currentSymbolId={currentSymbolId}
        onSymbolChange={handleSymbolChange}
        onRunBacktest={handleRunBacktest}
        isLoading={isLoading}
        strategy={strategy}
        isCopilotOpen={isCopilotOpen}
        onToggleCopilot={toggleCopilot}
      />

      <p className="px-4 pt-2 text-xs text-amber-200">Research only. Default bars and reference prices are generated or illustrative demo data, not live market observations. No broker orders.</p>
      <div role="status" aria-live="polite" className="px-4 py-2 text-xs">{saveStatus}{backtestResult && (runDraftSignature === null ? ' · Retained run selected; builder draft unchanged' : JSON.stringify(strategy) !== runDraftSignature ? ' · Draft changed since this run' : '')}{previousStrategy && <button type="button" onClick={undoDraftChange} className="ml-3 underline">Undo last draft change</button>}{saveStatus.startsWith('Not saved:') && <button type="button" onClick={exportDraft} className="ml-3 underline">Export unsaved draft</button>}</div>
      {runError && <div role="alert" className="px-4 py-2 text-red-400">{runError}</div>}
      {/* Main Workspace Layout */}
      <div className="flex-1 flex w-full max-w-full overflow-hidden bg-[#0c0c0e]">
        {/* Left AI Copilot Chatbot Section (Docked on left screen) */}
        {isCopilotOpen && (
          <aside className="fixed inset-0 lg:relative lg:inset-auto w-full lg:w-80 xl:w-[380px] shrink-0 border-r border-[rgba(236,236,237,0.08)] bg-[#0c0c0e] h-[calc(100vh-4rem)] overflow-hidden flex flex-col z-30">
            <AiCopilotDock
              strategy={strategy}
              onApplyVariation={handleLoadStrategy}
              onRunBacktest={handleRunBacktest}
              onRunScanner={() => setActiveTab('scanner')}
              onClose={() => setIsCopilotOpen(false)}
            />
          </aside>
        )}

        {/* Center/Right Dynamic Canvas */}
        <main className="flex-1 min-w-0 w-full overflow-y-auto overflow-x-hidden h-[calc(100vh-4rem)] relative pb-20 sm:pb-0 bg-dot-matrix">
          {activeTab === 'builder' && (
            <StrategyBuilder
              strategy={strategy}
              onChange={changeStrategy}
              onRunBacktest={handleRunBacktest}
              isLoading={isLoading}
            />
          )}

          {activeTab === 'results' && (
            <ResultsDashboard
              result={backtestResult}
              comparisonResults={comparisonResults}
              onReRun={handleRunBacktest}
              onApplyStrategy={handleLoadStrategy}
              onUpdateComparisonList={setComparisonResults}
              onSelectActiveResult={res => {
                invalidateRun(); setBacktestResult(res); setRunDraftSignature(null);
              }}
              isLoading={isLoading}
            />
          )}

          {activeTab === 'scanner' && (
            <MarketScannerView
              strategy={strategy}
              onSelectStockAndBacktest={(symId, asOf) => {
                const next = snapshotStrategy(strategy, symId); changeStrategy(next); void runSnapshot(next, true, scannerBacktestOptions(asOf)).catch(() => {});
              }}
            />
          )}

          {activeTab === 'library' && (
            <StrategyLibraryView onLoadStrategy={handleLoadStrategy} currentStrategy={strategy} />
          )}

          {/* Floating Mobile Copilot Trigger */}
          <button
            onClick={toggleCopilot}
            className="lg:hidden fixed bottom-20 sm:bottom-6 right-4 sm:right-6 p-3 sm:p-3.5 rounded-full bg-[#00ffa3] text-[#0c0c0e] font-bold shadow-2xl shadow-[#00ffa3]/30 flex items-center justify-center z-40 active:scale-95 transition-all hover:bg-[#00ffa3]/90"
            title="Open AI Strategy Copilot"
          >
            <Bot className="w-5 h-5" />
          </button>
        </main>
      </div>

      {/* Institutional Mobile Bottom Navigation Bar (Visible only on compact mobile screens < sm) */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0c0c0e]/95 backdrop-blur-md border-t border-[rgba(236,236,237,0.08)] px-2 py-1.5 flex items-center justify-around select-none shadow-2xl">
        <button
          id="mob-nav-builder"
          type="button"
          onClick={() => setActiveTab('builder')}
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all ${
            activeTab === 'builder'
              ? 'text-[#00ffa3] font-bold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <div className={`p-1 rounded-lg ${activeTab === 'builder' ? 'bg-[#00ffa3]/15 border border-[#00ffa3]/30' : ''}`}>
            <Sparkles className="w-4 h-4" />
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight font-medium">Builder</span>
        </button>

        <button
          id="mob-nav-results"
          type="button"
          onClick={() => setActiveTab('results')}
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all ${
            activeTab === 'results'
              ? 'text-[#00ffa3] font-bold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <div className={`p-1 rounded-lg ${activeTab === 'results' ? 'bg-[#00ffa3]/15 border border-[#00ffa3]/30' : ''}`}>
            <Layers className="w-4 h-4" />
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight font-medium">Analytics</span>
        </button>

        <button
          id="mob-nav-scanner"
          type="button"
          onClick={() => setActiveTab('scanner')}
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all ${
            activeTab === 'scanner'
              ? 'text-[#00ffa3] font-bold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <div className={`p-1 rounded-lg ${activeTab === 'scanner' ? 'bg-[#00ffa3]/15 border border-[#00ffa3]/30' : ''}`}>
            <Radio className="w-4 h-4" />
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight font-medium">Scanner</span>
        </button>

        <button
          id="mob-nav-library"
          type="button"
          onClick={() => setActiveTab('library')}
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all ${
            activeTab === 'library'
              ? 'text-[#00ffa3] font-bold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <div className={`p-1 rounded-lg ${activeTab === 'library' ? 'bg-[#00ffa3]/15 border border-[#00ffa3]/30' : ''}`}>
            <BookOpen className="w-4 h-4" />
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight font-medium">Templates</span>
        </button>
      </nav>
    </div>
  );
}
