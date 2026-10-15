import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StrategyAST, SymbolMeta, BacktestResponse } from './shared/strategy/types';
import { STRATEGY_TEMPLATES } from './shared/strategy/templates';
import { repairStrategyAST } from './shared/strategy/schema';
import { NSE_SYMBOLS } from './server/data/symbols';
import { runBacktest } from './server/backtest/engine';
import { Navbar } from './components/layout/Navbar';
import { AiCopilotDock } from './components/chat/AiCopilotDock';
import { StrategyBuilder } from './components/strategy/StrategyBuilder';
import { ResultsDashboard } from './components/results/ResultsDashboard';
import { MarketScannerView } from './components/scanner/MarketScannerView';
import { StrategyLibraryView } from './components/library/StrategyLibraryView';
import { Bot, Sparkles, Layers, Radio, BookOpen, X } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'builder' | 'results' | 'scanner' | 'library'>('builder');
  const [symbols, setSymbols] = useState<SymbolMeta[]>(NSE_SYMBOLS);
  const [currentSymbolId, setCurrentSymbolId] = useState<number>(() => {
    try {
      const savedSym = localStorage.getItem('stragy_active_symbol_id');
      if (savedSym) {
        const num = parseInt(savedSym, 10);
        if (!isNaN(num) && num > 0) return num;
      }
    } catch {}
    return 1;
  });
  const [strategy, setStrategy] = useState<StrategyAST>(() => {
    try {
      const savedStrat = localStorage.getItem('stragy_active_strategy');
      if (savedStrat) {
        const parsed = JSON.parse(savedStrat);
        if (parsed && typeof parsed === 'object') {
          return repairStrategyAST(parsed);
        }
      }
    } catch (e) {
      console.warn('Could not restore strategy from localStorage:', e);
    }
    return repairStrategyAST(STRATEGY_TEMPLATES[0].strategy);
  });
  const [backtestResult, setBacktestResult] = useState<BacktestResponse | null>(() => {
    try {
      return runBacktest(strategy || STRATEGY_TEMPLATES[0].strategy);
    } catch {
      return null;
    }
  });
  const [comparisonResults, setComparisonResults] = useState<BacktestResponse[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isCopilotOpen, setIsCopilotOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('stragy_copilot_open');
      if (saved !== null) return saved === 'true';
    } catch {}
    return true;
  });
  const [isCopilotOpenMobile, setIsCopilotOpenMobile] = useState<boolean>(false);

  const toggleCopilot = () => {
    setIsCopilotOpen(prev => {
      const next = !prev;
      try {
        localStorage.setItem('stragy_copilot_open', String(next));
      } catch {}
      return next;
    });
  };

  // Fetch symbols on boot with auto-retry and static fallback
  useEffect(() => {
    let isMounted = true;
    const fetchSymbolsWithRetry = async (retries = 3, delay = 1000) => {
      try {
        const res = await fetch('/api/symbols');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (isMounted && data.symbols && data.symbols.length > 0) {
          setSymbols(data.symbols);
        }
      } catch (err) {
        if (retries > 0 && isMounted) {
          setTimeout(() => fetchSymbolsWithRetry(retries - 1, delay * 1.5), delay);
        } else if (isMounted) {
          // Fall back gracefully to bundled NSE symbols
          setSymbols(NSE_SYMBOLS);
        }
      }
    };

    fetchSymbolsWithRetry();
    return () => {
      isMounted = false;
    };
  }, []);

  // Sync universe symbolId when currentSymbolId changes
  const handleSymbolChange = (symbolId: number) => {
    setCurrentSymbolId(symbolId);
    try {
      localStorage.setItem('stragy_active_symbol_id', symbolId.toString());
    } catch {}
    setStrategy(prev => ({
      ...prev,
      universe: {
        ...prev.universe,
        symbolId
      }
    }));
  };

  // Run backtest simulation with server API + instant local engine fallback
  const handleRunBacktest = useCallback(async (switchToResults: boolean = true) => {
    setIsLoading(true);
    const activeStrategy = {
      ...strategy,
      universe: {
        ...strategy.universe,
        symbolId: currentSymbolId
      }
    };

    try {
      const res = await fetch('/api/backtests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: activeStrategy })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.result) {
          setBacktestResult(data.result);
          if (switchToResults) {
            setActiveTab('results');
          }
          setIsLoading(false);
          return;
        }
      }
      throw new Error('Server backtest response was not successful');
    } catch {
      // Isomorphic local engine fallback ensures zero downtime
      try {
        const localResult = runBacktest(activeStrategy);
        setBacktestResult(localResult);
        if (switchToResults) {
          setActiveTab('results');
        }
      } catch (localErr) {
        console.warn('Local backtest fallback warning:', localErr);
      }
    } finally {
      setIsLoading(false);
    }
  }, [strategy, currentSymbolId]);

  // Automatically execute initial simulation on boot in the background without stealing active tab
  const hasRunInitialBacktest = useRef(false);
  useEffect(() => {
    if (!hasRunInitialBacktest.current) {
      hasRunInitialBacktest.current = true;
      handleRunBacktest(false);
    }
  }, [handleRunBacktest]);

  // Handle template or AI variation selection
  const handleLoadStrategy = (newStrat: StrategyAST) => {
    const repaired = repairStrategyAST({
      ...newStrat,
      universe: {
        ...newStrat.universe,
        symbolId: currentSymbolId
      }
    });
    setStrategy(repaired);
    setActiveTab('builder');
    setIsCopilotOpenMobile(false);
  };

  // Handle instant strategy loading, automatic backtest execution, and multi-variation comparison
  const handleLoadAndRunBacktest = async (newStrat: StrategyAST, allVariations?: StrategyAST[]) => {
    const repaired = repairStrategyAST({
      ...newStrat,
      universe: {
        ...newStrat.universe,
        symbolId: currentSymbolId
      }
    });
    setStrategy(repaired);
    setIsLoading(true);

    try {
      // 1. Run main/winning backtest
      let primaryResult: BacktestResponse | null = null;
      try {
        const res = await fetch('/api/backtests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ strategy: repaired })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.result) {
            primaryResult = data.result;
          }
        }
      } catch {}

      if (!primaryResult) {
        primaryResult = runBacktest(repaired);
      }

      setBacktestResult(primaryResult);

      // 2. If multiple variations are provided, simulate all of them in parallel to populate comparison matrix
      if (allVariations && allVariations.length > 0) {
        const batchResults: BacktestResponse[] = [primaryResult];
        for (const v of allVariations) {
          if (v.id === repaired.id) continue;
          try {
            const repairedVar = repairStrategyAST({
              ...v,
              universe: {
                ...v.universe,
                symbolId: currentSymbolId
              }
            });
            const varResult = runBacktest(repairedVar);
            batchResults.push(varResult);
          } catch (varErr) {
            console.warn('Variation backtest error:', varErr);
          }
        }
        setComparisonResults(batchResults);
      }

      setActiveTab('results');
    } catch (err) {
      console.warn('Backtest execution error:', err);
    } finally {
      setIsLoading(false);
      setIsCopilotOpenMobile(false);
    }
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

      {/* Main Workspace Layout */}
      <div className="flex-1 flex w-full max-w-full overflow-hidden bg-[#0c0c0e]">
        {/* Left AI Copilot Chatbot Section (Docked on left screen) */}
        {isCopilotOpen && (
          <aside className="w-80 md:w-84 xl:w-[380px] shrink-0 border-r border-[rgba(236,236,237,0.08)] bg-[#0c0c0e] h-[calc(100vh-4rem)] overflow-hidden flex flex-col z-30">
            <AiCopilotDock
              strategy={strategy}
              onApplyVariation={handleLoadStrategy}
              onApplyAndRunBacktest={handleLoadAndRunBacktest}
              onApplyStrategyEdit={async (instruction: string) => {
                // Apply edit via Copilot
              }}
              onRunBacktest={handleRunBacktest}
              onRunScanner={() => setActiveTab('scanner')}
            />
          </aside>
        )}

        {/* Mobile AI Copilot Drawer Overlay */}
        {isCopilotOpenMobile && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div
              className="fixed inset-0 bg-[#0c0c0e]/80 backdrop-blur-md"
              onClick={() => setIsCopilotOpenMobile(false)}
            />
            <div className="relative w-4/5 max-w-sm h-full bg-[#0c0c0e] border-r border-[rgba(236,236,237,0.08)] shadow-2xl z-50 flex flex-col">
              <div className="flex items-center justify-between p-3 border-b border-[rgba(236,236,237,0.08)] bg-[#0c0c0e]">
                <span className="font-bold text-xs text-[#ececed]">AI Strategy Copilot</span>
                <button
                  onClick={() => setIsCopilotOpenMobile(false)}
                  className="p-1 rounded-lg text-neutral-400 hover:text-[#ececed]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden bg-[#0c0c0e]">
                <AiCopilotDock
                  strategy={strategy}
                  onApplyVariation={handleLoadStrategy}
                  onApplyAndRunBacktest={handleLoadAndRunBacktest}
                  onApplyStrategyEdit={async () => {}}
                  onRunBacktest={handleRunBacktest}
                  onRunScanner={() => {
                    setActiveTab('scanner');
                    setIsCopilotOpenMobile(false);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Center/Right Dynamic Canvas */}
        <main className="flex-1 min-w-0 w-full overflow-y-auto overflow-x-hidden h-[calc(100vh-4rem)] relative pb-20 sm:pb-0 bg-dot-matrix">
          {activeTab === 'builder' && (
            <StrategyBuilder
              strategy={strategy}
              onChange={setStrategy}
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
                setBacktestResult(res);
                setStrategy(res.strategy);
              }}
              isLoading={isLoading}
            />
          )}

          {activeTab === 'scanner' && (
            <MarketScannerView
              strategy={strategy}
              onSelectStockAndBacktest={symId => {
                handleSymbolChange(symId);
                handleRunBacktest();
              }}
            />
          )}

          {activeTab === 'library' && (
            <StrategyLibraryView onLoadStrategy={handleLoadStrategy} />
          )}

          {/* Floating Mobile Copilot Trigger */}
          <button
            onClick={() => setIsCopilotOpenMobile(true)}
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
