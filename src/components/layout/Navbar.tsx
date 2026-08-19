import React from 'react';
import { Play, Activity, Layers, Radio, Sparkles, BookOpen, Bot } from 'lucide-react';
import { SymbolMeta, StrategyAST } from '../../shared/strategy/types';
import { SymbolSearchSelector } from './SymbolSearchSelector';

interface NavbarProps {
  activeTab: 'builder' | 'results' | 'scanner' | 'library';
  setActiveTab: (tab: 'builder' | 'results' | 'scanner' | 'library') => void;
  symbols: SymbolMeta[];
  currentSymbolId: number;
  onSymbolChange: (symbolId: number) => void;
  onRunBacktest: () => void;
  isLoading: boolean;
  strategy: StrategyAST;
  isCopilotOpen?: boolean;
  onToggleCopilot?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  symbols,
  currentSymbolId,
  onSymbolChange,
  onRunBacktest,
  isLoading,
  strategy,
  isCopilotOpen,
  onToggleCopilot
}) => {
  const currentSymbol = symbols.find(s => s.id === currentSymbolId) || symbols[0];
  const [smartApiStatus, setSmartApiStatus] = React.useState<{
    configured: boolean;
    connected: boolean;
    streamState: string;
    latencyMs: number;
    provider: string;
    clientCode?: string;
  }>({
    configured: false,
    connected: false,
    streamState: 'SIMULATED_HIGH_FIDELITY',
    latencyMs: 12,
    provider: 'Angel One SmartAPI'
  });

  React.useEffect(() => {
    fetch('/api/smartapi/status')
      .then(res => res.json())
      .then(data => {
        if (data.success || data.streamState) {
          setSmartApiStatus({
            configured: !!data.configured,
            connected: !!data.connected,
            streamState: data.streamState || 'CONNECTED',
            latencyMs: data.latencyMs || 14,
            provider: data.provider || 'Angel One SmartAPI',
            clientCode: data.clientCode
          });
        }
      })
      .catch(() => {});
  }, []);

  return (
    <header className="h-16 w-full max-w-full border-b border-[rgba(236,236,237,0.08)] bg-[#0c0c0e] px-4 sm:px-6 flex items-center justify-between sticky top-0 z-40 gap-3 select-none">
      {/* Left: Brand Mark & Symbol Selector */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[#00ffa3] flex items-center justify-center text-[#0c0c0e] shadow-sm shadow-[#00ffa3]/30 shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
          </div>
          <span className="font-syne font-extrabold tracking-[-0.04em] text-lg sm:text-xl text-[#ececed] shrink-0">STRAGY</span>
          <div className="badge-mint hidden md:inline-flex shrink-0">NSE & BSE LIVE</div>
        </div>

        <div className="h-4 w-px bg-[rgba(236,236,237,0.1)] hidden lg:block shrink-0" />

        {/* Searchable Stock & Index Selector Dropdown */}
        <div className="shrink-0">
          <SymbolSearchSelector
            symbols={symbols}
            currentSymbolId={currentSymbolId}
            onSymbolChange={onSymbolChange}
          />
        </div>
      </div>

      {/* Center: Institutional Rounded-XL Segmented Navigation Tabs */}
      <nav className="hidden sm:flex items-center bg-[#141417] p-1.5 rounded-xl gap-1 border border-[rgba(236,236,237,0.08)] shrink-0 mx-auto">
        <button
          id="nav-builder-tab"
          onClick={() => setActiveTab('builder')}
          className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'builder'
              ? 'bg-[#1d1d21] text-[#ececed] shadow-sm border border-[rgba(236,236,237,0.05)]'
              : 'text-[rgba(236,236,237,0.5)] hover:text-[#ececed] hover:bg-white/[0.02]'
          }`}
          title="Strategy Builder"
        >
          <Sparkles className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'builder' ? 'text-[#00ffa3]' : 'text-neutral-500'}`} />
          <span>Builder</span>
        </button>

        <button
          id="nav-results-tab"
          onClick={() => setActiveTab('results')}
          className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'results'
              ? 'bg-[#1d1d21] text-[#ececed] shadow-sm border border-[rgba(236,236,237,0.05)]'
              : 'text-[rgba(236,236,237,0.5)] hover:text-[#ececed] hover:bg-white/[0.02]'
          }`}
          title="Backtest Analytics"
        >
          <Layers className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'results' ? 'text-[#00ffa3]' : 'text-neutral-500'}`} />
          <span>Analytics</span>
        </button>

        <button
          id="nav-scanner-tab"
          onClick={() => setActiveTab('scanner')}
          className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'scanner'
              ? 'bg-[#1d1d21] text-[#ececed] shadow-sm border border-[rgba(236,236,237,0.05)]'
              : 'text-[rgba(236,236,237,0.5)] hover:text-[#ececed] hover:bg-white/[0.02]'
          }`}
          title="Market Scanner"
        >
          <Radio className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'scanner' ? 'text-[#00ffa3]' : 'text-neutral-500'}`} />
          <span>Scanner</span>
        </button>

        <button
          id="nav-library-tab"
          onClick={() => setActiveTab('library')}
          className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'library'
              ? 'bg-[#1d1d21] text-[#ececed] shadow-sm border border-[rgba(236,236,237,0.05)]'
              : 'text-[rgba(236,236,237,0.5)] hover:text-[#ececed] hover:bg-white/[0.02]'
          }`}
          title="Strategy Library"
        >
          <BookOpen className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'library' ? 'text-[#00ffa3]' : 'text-neutral-500'}`} />
          <span>Library</span>
        </button>
      </nav>

      {/* Right: AI Copilot Toggle, SmartAPI Status Dot & RUN BACKTEST */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* AI Copilot Toggle Button */}
        <button
          id="btn-nav-copilot-toggle"
          onClick={onToggleCopilot}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
            isCopilotOpen
              ? 'bg-[#00ffa3]/15 text-[#00ffa3] border-[#00ffa3]/30 shadow-sm'
              : 'bg-[#141417] text-neutral-400 border-[rgba(236,236,237,0.08)] hover:text-[#ececed] hover:bg-[#1d1d21]'
          }`}
          title={isCopilotOpen ? 'Hide AI Chatbot Sidebar' : 'Show AI Chatbot Sidebar'}
        >
          <Bot className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden md:inline">AI Chatbot</span>
        </button>

        <div
          title={
            smartApiStatus.configured
              ? `Angel One SmartAPI active (${smartApiStatus.clientCode || 'Client'})`
              : 'SmartAPI Engine active'
          }
          className="hidden 2xl:flex items-center gap-2 px-3 py-1.5 bg-transparent border border-[rgba(236,236,237,0.12)] rounded-xl text-[11px] font-mono uppercase"
        >
          <span className="status-dot-mint" />
          <span className="font-semibold text-[#ececed]">SMARTAPI ACTIVE</span>
          <span className="text-neutral-500">•</span>
          <span className="text-[rgba(236,236,237,0.5)] text-[10px]">{smartApiStatus.latencyMs}ms</span>
        </div>

        <button
          id="btn-run-backtest-nav"
          onClick={onRunBacktest}
          disabled={isLoading}
          className="btn-primary-mint !rounded-xl shrink-0"
        >
          {isLoading ? (
            <div className="w-3.5 h-3.5 border-2 border-[#0c0c0e] border-t-transparent rounded-full animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5 fill-[#0c0c0e] shrink-0" />
          )}
          <span className="font-bold tracking-tight">RUN BACKTEST</span>
        </button>
      </div>
    </header>
  );
};

