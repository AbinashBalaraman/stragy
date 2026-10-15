import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  ChevronDown,
  X,
  TrendingUp,
  TrendingDown,
  Layers,
  Sparkles,
  Check,
  Building2,
  SlidersHorizontal,
  Command
} from 'lucide-react';
import { SymbolMeta } from '../../shared/strategy/types';

interface SymbolSearchSelectorProps {
  symbols: SymbolMeta[];
  currentSymbolId: number;
  onSymbolChange: (symbolId: number) => void;
  className?: string;
  variant?: 'compact' | 'full';
}

type SectorFilter =
  | 'ALL'
  | 'INDICES'
  | 'NIFTY50'
  | 'BANKING'
  | 'IT'
  | 'AUTO'
  | 'PHARMA'
  | 'ENERGY'
  | 'METALS'
  | 'FMCG'
  | 'BSE';

const POPULAR_TICKERS = [
  'NIFTY 50',
  'BANKNIFTY',
  'SENSEX',
  'RELIANCE',
  'HDFCBANK',
  'TCS',
  'INFY',
  'ICICIBANK',
  'TATAMOTORS',
  'BHARTIARTL',
  'SBIN',
  'ITC'
];

export const SymbolSearchSelector: React.FC<SymbolSearchSelectorProps> = ({
  symbols,
  currentSymbolId,
  onSymbolChange,
  className = '',
  variant = 'compact'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<SectorFilter>('ALL');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  // Active symbol object
  const currentSymbol = useMemo(() => {
    return symbols.find(s => s.id === currentSymbolId) || symbols[0] || {
      id: 1,
      ticker: 'NIFTY 50',
      name: 'NIFTY 50 Benchmark Index',
      exchange: 'NSE',
      sector: 'Benchmark Index',
      currentPrice: 24350.25,
      changePercent: 0.65
    };
  }, [symbols, currentSymbolId]);

  // Keyboard shortcut listener (Cmd+K or Ctrl+K or /)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if already typing in an input or textarea (unless this modal is open)
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      } else if (e.key === '/' && !isInput && !isOpen) {
        e.preventDefault();
        setIsOpen(true);
      } else if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Focus search input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 50);
      setHighlightedIndex(0);
    } else {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Filter symbols based on category & search query
  const filteredSymbols = useMemo(() => {
    let list = symbols;

    // Apply category filter
    if (selectedCategory === 'INDICES') {
      list = list.filter(
        s =>
          s.sector?.toLowerCase().includes('index') ||
          s.ticker.includes('NIFTY') ||
          s.ticker.includes('SENSEX') ||
          s.ticker.includes('BANKNIFTY')
      );
    } else if (selectedCategory === 'NIFTY50') {
      list = list.filter(s => s.indices?.includes('NIFTY_50') || s.id <= 50);
    } else if (selectedCategory === 'BANKING') {
      list = list.filter(
        s =>
          s.sector?.toLowerCase().includes('bank') ||
          s.sector?.toLowerCase().includes('financial') ||
          s.ticker.includes('BANK')
      );
    } else if (selectedCategory === 'IT') {
      list = list.filter(
        s =>
          s.sector?.toLowerCase().includes('information technology') ||
          s.sector?.toLowerCase().includes('it') ||
          s.sector?.toLowerCase().includes('software')
      );
    } else if (selectedCategory === 'AUTO') {
      list = list.filter(
        s =>
          s.sector?.toLowerCase().includes('automobile') ||
          s.sector?.toLowerCase().includes('auto')
      );
    } else if (selectedCategory === 'PHARMA') {
      list = list.filter(
        s =>
          s.sector?.toLowerCase().includes('pharma') ||
          s.sector?.toLowerCase().includes('health')
      );
    } else if (selectedCategory === 'ENERGY') {
      list = list.filter(
        s =>
          s.sector?.toLowerCase().includes('energy') ||
          s.sector?.toLowerCase().includes('oil') ||
          s.sector?.toLowerCase().includes('power')
      );
    } else if (selectedCategory === 'METALS') {
      list = list.filter(
        s =>
          s.sector?.toLowerCase().includes('metal') ||
          s.sector?.toLowerCase().includes('steel') ||
          s.sector?.toLowerCase().includes('mining')
      );
    } else if (selectedCategory === 'FMCG') {
      list = list.filter(
        s =>
          s.sector?.toLowerCase().includes('fmcg') ||
          s.sector?.toLowerCase().includes('consumer')
      );
    } else if (selectedCategory === 'BSE') {
      list = list.filter(s => s.exchange === 'BSE' || s.ticker.includes('SENSEX'));
    }

    // Apply search query
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;

    return list.filter(
      s =>
        s.ticker.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.sector?.toLowerCase().includes(q) ||
        s.exchange.toLowerCase().includes(q)
    );
  }, [symbols, selectedCategory, searchQuery]);

  // Handle keyboard navigation inside the list
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => Math.min(prev + 1, Math.min(filteredSymbols.length - 1, 99)));
      scrollHighlightedIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => Math.max(prev - 1, 0));
      scrollHighlightedIntoView();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredSymbols[highlightedIndex]) {
        selectSymbol(filteredSymbols[highlightedIndex].id);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  const scrollHighlightedIntoView = () => {
    setTimeout(() => {
      const activeEl = listContainerRef.current?.querySelector('[data-highlighted="true"]');
      activeEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 10);
  };

  const selectSymbol = (id: number) => {
    onSymbolChange(id);
    setIsOpen(false);
  };

  const isIndex =
    currentSymbol.sector?.toLowerCase().includes('index') ||
    currentSymbol.ticker.includes('NIFTY') ||
    currentSymbol.ticker.includes('SENSEX');

  return (
    <div ref={containerRef} className={`relative flex items-center gap-1.5 shrink-0 ${className}`}>
      {/* Active Symbol Display Badge & Search Launcher */}
      <button
        id="btn-symbol-pill-trigger"
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className="group flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 rounded-xl bg-[#141417] hover:bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] hover:border-[#00ffa3]/50 shadow-sm transition-all text-left focus:outline-none focus:border-[#00ffa3] select-none shrink-0"
        title="Search & select from 2,000+ stocks & indices (Click to open search)"
      >
        {/* Ticker & Exchange Badge */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="font-extrabold text-xs sm:text-sm text-[#ececed] tracking-tight group-hover:text-[#00ffa3] transition-colors font-mono">
            {currentSymbol.ticker}
          </span>
          <span
            className={`text-[8px] sm:text-[9px] uppercase font-mono font-bold px-1.5 py-0.2 rounded border shrink-0 ${
              isIndex
                ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                : currentSymbol.exchange === 'BSE'
                ? 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                : 'bg-[#00ffa3]/10 text-[#00ffa3] border-[#00ffa3]/30'
            }`}
          >
            {isIndex ? 'INDEX' : currentSymbol.exchange}
          </span>
        </div>

        {/* Live Price & Change Badge */}
        <div className="hidden md:flex items-center gap-1.5 shrink-0">
          <span className="text-xs font-mono font-semibold text-[#ececed]">
            ₹{currentSymbol.currentPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </span>

          <span
            className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 shrink-0 ${
              currentSymbol.changePercent >= 0
                ? 'bg-emerald-500/15 text-[#00ffa3] border border-[#00ffa3]/30'
                : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
            }`}
          >
            {currentSymbol.changePercent >= 0 ? (
              <TrendingUp className="w-2.5 h-2.5" />
            ) : (
              <TrendingDown className="w-2.5 h-2.5" />
            )}
            <span>{currentSymbol.changePercent >= 0 ? '+' : ''}{currentSymbol.changePercent}%</span>
          </span>
        </div>

        <Search className="w-3 h-3 text-neutral-400 group-hover:text-[#00ffa3] transition-colors shrink-0 ml-0.5" />
      </button>

      {/* Desktop Dedicated Quick Search Input Trigger */}
      <button
        id="btn-symbol-quicksearch-trigger"
        type="button"
        onClick={() => setIsOpen(true)}
        className="hidden 2xl:flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#141417] hover:bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] hover:border-neutral-700 text-neutral-400 hover:text-[#ececed] transition-all text-xs font-medium focus:outline-none group shrink-0 w-36"
        title="Search any stock, index, or sector (Press ⌘K or /)"
      >
        <Search className="w-3.5 h-3.5 text-neutral-400 group-hover:text-[#00ffa3] transition-colors shrink-0" />
        <span className="truncate text-neutral-400 group-hover:text-[#ececed]">Search stock...</span>
        <kbd className="ml-auto inline-flex items-center gap-0.5 text-[9px] font-mono px-1 py-0.2 rounded bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] text-neutral-400 group-hover:text-[#ececed] shrink-0">
          <Command className="w-2.5 h-2.5" />K
        </kbd>
      </button>

      {/* Popover / Combobox Dropdown */}
      {isOpen && (
        <div className="fixed sm:absolute top-16 sm:top-full left-2 sm:left-0 right-2 sm:right-auto mt-2 sm:w-[460px] md:w-[520px] bg-[#161619] border border-[rgba(236,236,237,0.12)] rounded-2xl shadow-2xl shadow-black/80 z-50 overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[580px] animate-in fade-in zoom-in-95 duration-150">
          {/* Search Header Input */}
          <div className="p-3 border-b border-[rgba(236,236,237,0.08)] bg-[#141417] flex items-center gap-2.5">
            <Search className="w-4 h-4 text-[#00ffa3] shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search 2,000+ stocks or indices (e.g. NIFTY, RELIANCE, TATA)..."
              className="w-full bg-transparent text-[#ececed] placeholder-neutral-500 text-xs sm:text-sm font-medium focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/[0.05]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/[0.05] sm:hidden"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Category Filter Chips */}
          <div className="p-2.5 sm:p-3 border-b border-[rgba(236,236,237,0.08)] bg-[#0c0c0e]/60 flex flex-wrap items-center gap-1.5 text-xs">
            {(
              [
                { id: 'ALL', label: `All (${symbols.length})` },
                { id: 'INDICES', label: 'Indices' },
                { id: 'NIFTY50', label: 'Nifty 50' },
                { id: 'BANKING', label: 'Banking' },
                { id: 'IT', label: 'IT' },
                { id: 'AUTO', label: 'Auto' },
                { id: 'PHARMA', label: 'Pharma' },
                { id: 'ENERGY', label: 'Energy' },
                { id: 'METALS', label: 'Metals' },
                { id: 'FMCG', label: 'FMCG' },
                { id: 'BSE', label: 'BSE' }
              ] as const
            ).map(cat => {
              const active = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setSelectedCategory(cat.id);
                    setHighlightedIndex(0);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center justify-center ${
                    active
                      ? 'bg-[#00ffa3] text-[#0c0c0e] font-bold shadow-sm'
                      : 'bg-[#1d1d21] text-neutral-300 hover:text-white hover:bg-[#25252a] border border-[rgba(236,236,237,0.08)]'
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>

          {/* Quick-Pick Popular Symbols (when no search query) */}
          {!searchQuery.trim() && selectedCategory === 'ALL' && (
            <div className="px-3 py-2 border-b border-[rgba(236,236,237,0.06)] bg-[#0c0c0e]/30">
              <div className="text-[10px] uppercase font-bold text-neutral-400 mb-1.5 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-[#00ffa3]" />
                <span>Popular & Benchmark Equities:</span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {POPULAR_TICKERS.map(ticker => {
                  const sym = symbols.find(s => s.ticker === ticker);
                  if (!sym) return null;
                  const isCurrent = sym.id === currentSymbolId;
                  return (
                    <button
                      key={`pop_${sym.id}`}
                      type="button"
                      onClick={() => selectSymbol(sym.id)}
                      className={`px-2 py-0.5 rounded-md text-[11px] font-mono transition-all flex items-center gap-1 ${
                        isCurrent
                          ? 'bg-[#00ffa3]/20 text-[#00ffa3] font-bold border border-[#00ffa3]/40'
                          : 'bg-[#1d1d21] text-neutral-300 hover:text-white hover:bg-[#25252a] border border-[rgba(236,236,237,0.08)]'
                      }`}
                    >
                      <span>{sym.ticker}</span>
                      <span
                        className={`text-[9px] ${
                          sym.changePercent >= 0 ? 'text-[#00ffa3]' : 'text-rose-400'
                        }`}
                      >
                        {sym.changePercent >= 0 ? '+' : ''}{sym.changePercent}%
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Symbol Results List */}
          <div
            ref={listContainerRef}
            className="overflow-y-auto p-2 space-y-1 flex-1 max-h-[360px] divide-y divide-[rgba(236,236,237,0.04)]"
          >
            {filteredSymbols.length === 0 ? (
              <div className="p-8 text-center text-neutral-400 space-y-2">
                <Building2 className="w-8 h-8 mx-auto text-neutral-600 opacity-60" />
                <p className="text-xs font-semibold text-neutral-300">
                  No stocks found matching &quot;{searchQuery}&quot;
                </p>
                <p className="text-[11px] text-neutral-500">
                  Try searching by company name, sector (e.g. Banking, IT), or standard symbol.
                </p>
              </div>
            ) : (
              filteredSymbols.slice(0, 100).map((sym, index) => {
                const isSelected = sym.id === currentSymbolId;
                const isHighlighted = index === highlightedIndex;
                const symIsIndex =
                  sym.sector?.toLowerCase().includes('index') ||
                  sym.ticker.includes('NIFTY') ||
                  sym.ticker.includes('SENSEX');

                return (
                  <div
                    key={`res_sym_${sym.id}_${sym.ticker}`}
                    data-highlighted={isHighlighted ? 'true' : 'false'}
                    onClick={() => selectSymbol(sym.id)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className={`p-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'bg-[#00ffa3]/15 border border-[#00ffa3]/30 text-white'
                        : isHighlighted
                        ? 'bg-[#1d1d21] text-white'
                        : 'hover:bg-[#1d1d21]/60 text-neutral-300'
                    }`}
                  >
                    {/* Left: Ticker & Name */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-xs sm:text-sm text-white font-mono">
                          {sym.ticker}
                        </span>
                        <span
                          className={`text-[9px] uppercase font-mono font-bold px-1.5 py-0.2 rounded border ${
                            symIsIndex
                              ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                              : sym.exchange === 'BSE'
                              ? 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                              : 'bg-[#00ffa3]/10 text-[#00ffa3] border-[#00ffa3]/30'
                          }`}
                        >
                          {symIsIndex ? 'INDEX' : sym.exchange}
                        </span>
                        <span className="text-[10px] text-neutral-400 font-medium truncate max-w-[130px] sm:max-w-[180px]">
                          {sym.sector}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-400 truncate mt-0.5">
                        {sym.name}
                      </p>
                    </div>

                    {/* Right: Live Price & Today's % Change */}
                    <div className="text-right shrink-0 flex items-center gap-2.5">
                      <div>
                        <div className="text-xs sm:text-sm font-bold font-mono text-white">
                          ₹{sym.currentPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </div>
                        <div
                          className={`text-[10px] font-mono font-bold ${
                            sym.changePercent >= 0 ? 'text-[#00ffa3]' : 'text-rose-400'
                          }`}
                        >
                          {sym.changePercent >= 0 ? '+' : ''}{sym.changePercent}%
                        </div>
                      </div>

                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-[#00ffa3] text-[#0c0c0e] flex items-center justify-center shrink-0">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {filteredSymbols.length > 100 && (
              <div className="p-2 text-center text-[10px] text-neutral-500 font-mono">
                Showing top 100 of {filteredSymbols.length} results. Type to refine search.
              </div>
            )}
          </div>

          {/* Footer Guide */}
          <div className="px-3 py-2 border-t border-[rgba(236,236,237,0.08)] bg-[#141417] flex items-center justify-between text-[10px] text-neutral-400">
            <div className="flex items-center gap-3">
              <span>Use <kbd className="px-1 py-0.5 rounded bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] font-mono text-neutral-300">↑</kbd> <kbd className="px-1 py-0.5 rounded bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] font-mono text-neutral-300">↓</kbd> to navigate</span>
              <span><kbd className="px-1 py-0.5 rounded bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] font-mono text-neutral-300">Enter</kbd> to select</span>
              <span><kbd className="px-1 py-0.5 rounded bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] font-mono text-neutral-300">Esc</kbd> to close</span>
            </div>
            <span className="text-[#00ffa3] font-mono font-bold">2,088 Assets Active</span>
          </div>
        </div>
      )}
    </div>
  );
};
