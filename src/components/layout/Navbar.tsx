import React from 'react';
import { Play, Activity, Layers, Radio, Sparkles, BookOpen, Bot } from 'lucide-react';
import { SymbolMeta, StrategyAST } from '../../shared/strategy/types';
import { SymbolSearchSelector } from './SymbolSearchSelector';

interface NavbarProps {
  dataMode?: 'real' | 'demo' | 'unknown';
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
  dataMode = 'unknown',
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

  return (
    <header className="h-16 w-full max-w-full border-b border-[rgba(236,236,237,0.08)] bg-[#101012] px-4 sm:px-6 flex items-center justify-between sticky top-0 z-40 gap-3 select-none">
      {/* Left: Brand Mark & Symbol Selector */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[#a8c7fa] flex items-center justify-center text-[#101012] shadow-sm shadow-[#a8c7fa]/30 shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
          </div>
          <span className="font-syne font-extrabold tracking-[-0.04em] text-lg sm:text-xl text-[#ececed] shrink-0">STRAGY</span>
          <div className="badge-mint hidden md:inline-flex shrink-0">{dataMode === 'real' ? 'MARKET RESEARCH' : dataMode === 'demo' ? 'DEMO RESEARCH' : 'RESEARCH'}</div>
        </div>

        <div className="h-4 w-px bg-[rgba(236,236,237,0.1)] hidden lg:block shrink-0" />

        {/* Searchable Stock & Index Selector Dropdown */}
        <div className="shrink-0">
          <SymbolSearchSelector
            symbols={symbols}
            showReferencePrices={dataMode === 'demo'}
            currentSymbolId={currentSymbolId}
            onSymbolChange={onSymbolChange}
          />
        </div>
      </div>

      {/* Center: Institutional Rounded-XL Segmented Navigation Tabs */}
      <nav className="hidden sm:flex items-center bg-[#151517] p-1.5 rounded-xl gap-1 border border-[rgba(236,236,237,0.08)] shrink-0 mx-auto">
        <button
          id="nav-builder-tab"
          onClick={() => setActiveTab('builder')}
          className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'builder'
              ? 'bg-[#1e1e21] text-[#ececed] shadow-sm border border-[rgba(236,236,237,0.05)]'
              : 'text-[rgba(236,236,237,0.5)] hover:text-[#ececed] hover:bg-white/[0.02]'
          }`}
          title="Strategy Builder"
        >
          <Sparkles className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'builder' ? 'text-[#a8c7fa]' : 'text-neutral-500'}`} />
          <span>Builder</span>
        </button>

        <button
          id="nav-results-tab"
          onClick={() => setActiveTab('results')}
          className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'results'
              ? 'bg-[#1e1e21] text-[#ececed] shadow-sm border border-[rgba(236,236,237,0.05)]'
              : 'text-[rgba(236,236,237,0.5)] hover:text-[#ececed] hover:bg-white/[0.02]'
          }`}
          title="Backtest Analytics"
        >
          <Layers className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'results' ? 'text-[#a8c7fa]' : 'text-neutral-500'}`} />
          <span>Analytics</span>
        </button>

        <button
          id="nav-scanner-tab"
          onClick={() => setActiveTab('scanner')}
          className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'scanner'
              ? 'bg-[#1e1e21] text-[#ececed] shadow-sm border border-[rgba(236,236,237,0.05)]'
              : 'text-[rgba(236,236,237,0.5)] hover:text-[#ececed] hover:bg-white/[0.02]'
          }`}
          title="Market Scanner"
        >
          <Radio className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'scanner' ? 'text-[#a8c7fa]' : 'text-neutral-500'}`} />
          <span>Scanner</span>
        </button>

        <button
          id="nav-library-tab"
          onClick={() => setActiveTab('library')}
          className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'library'
              ? 'bg-[#1e1e21] text-[#ececed] shadow-sm border border-[rgba(236,236,237,0.05)]'
              : 'text-[rgba(236,236,237,0.5)] hover:text-[#ececed] hover:bg-white/[0.02]'
          }`}
          title="Strategy Library"
        >
          <BookOpen className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'library' ? 'text-[#a8c7fa]' : 'text-neutral-500'}`} />
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
              ? 'bg-[#a8c7fa]/15 text-[#a8c7fa] border-[#a8c7fa]/30 shadow-sm'
              : 'bg-[#151517] text-neutral-400 border-[rgba(236,236,237,0.08)] hover:text-[#ececed] hover:bg-[#1e1e21]'
          }`}
          title={isCopilotOpen ? 'Hide AI Chatbot Sidebar' : 'Show AI Chatbot Sidebar'}
        >
          <Bot className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden md:inline">AI Chatbot</span>
        </button>

        <div title="No broker connection or order execution is available" className="hidden 2xl:flex items-center px-3 py-1.5 border border-neutral-700 rounded-xl text-[11px] text-neutral-400">NO BROKER CONNECTED</div>

        <button
          id="btn-run-backtest-nav"
          onClick={onRunBacktest}
          disabled={isLoading}
          className="btn-primary-mint !rounded-xl shrink-0"
        >
          {isLoading ? (
            <div className="w-3.5 h-3.5 border-2 border-[#101012] border-t-transparent rounded-full animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5 fill-[#101012] shrink-0" />
          )}
          <span className="font-bold tracking-tight">RUN BACKTEST</span>
        </button>
      </div>
    </header>
  );
};

