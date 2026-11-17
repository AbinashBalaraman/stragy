import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  ChevronDown,
  X,
  TrendingUp,
  TrendingDown,
  Layers,
  Check,
  Building2,
  SlidersHorizontal,
} from 'lucide-react';
import { SymbolMeta } from '../../shared/strategy/types';
import { useLiveQuotes, formatLivePrice, formatLiveChange, liveQuoteTimeTitle, type LiveQuote } from '../../client/liveQuotes';

interface SymbolSearchSelectorProps {
  showReferencePrices?: boolean;
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

const QuotePrice: React.FC<{ quote: LiveQuote; className?: string }> = ({ quote, className = '' }) => (
  <span className={'items-center gap-1 ' + className} title={liveQuoteTimeTitle(quote)}>
    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
    <span className="st-tnum font-semibold text-[#ececed]">{formatLivePrice(quote.ltp)}</span>
    <span className={`st-tnum text-[10px] font-bold ${quote.changePercent >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
      {formatLiveChange(quote.changePercent)}
    </span>
  </span>
);

export const SymbolSearchSelector: React.FC<SymbolSearchSelectorProps> = ({
  symbols,
  showReferencePrices = false,
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
      list = list.filter(s => s.indices?.includes('NIFTY_50'));
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

  // Selected symbol + the first visible dropdown rows, never more than 10.
  const quoteSymbolIds = useMemo(() => {
    const ids = [currentSymbolId];
    if (isOpen) {
      for (const symbol of filteredSymbols) {
        if (!ids.includes(symbol.id)) ids.push(symbol.id);
        if (ids.length >= 10) break;
      }
    }
    return ids;
  }, [currentSymbolId, isOpen, filteredSymbols]);
  const liveQuotes = useLiveQuotes(quoteSymbolIds, { enabled: !showReferencePrices });
  const quoteFor = (symbolId: number) => liveQuotes.quotes.find(quote => quote.symbolId === symbolId);

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
  const currentQuote = quoteFor(currentSymbolId);

  return (
    <div ref={containerRef} className={`relative flex items-center gap-1.5 shrink-0 ${className}`}>
      {/* Active Symbol Display Badge & Search Launcher */}
      <button
        id="btn-symbol-pill-trigger"
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        aria-label={`Instrument ${currentSymbol.ticker}. Open instrument search.`}
        className="group flex shrink-0 select-none items-center gap-2 rounded-lg border border-white/12 bg-[#171719] px-2.5 py-1.5 text-left transition-colors hover:border-[#a8c7fa]/40 hover:bg-white/[0.04] focus:border-[#a8c7fa]/60 focus:outline-none"
        title={showReferencePrices
          ? 'Search demo instruments. Reference prices are illustrative, not live.'
          : currentQuote
            ? 'Live Angel One LTP; daily research bars remain delayed, not live.'
            : 'Select an instrument. Live LTP appears when Angel One quotes are connected.'}
      >
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-xs font-semibold tracking-tight text-neutral-100 transition-colors group-hover:text-[#cfe0ff]">
            {currentSymbol.ticker}
          </span>
          <span className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-neutral-400">
            {isIndex ? 'INDEX' : currentSymbol.exchange}
          </span>
        </span>

        {/* Live Angel quotes in real mode; demo references are labelled as such. */}
        {showReferencePrices ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="st-tnum text-xs text-neutral-200">₹{currentSymbol.currentPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
            <span className={'st-tnum flex items-center gap-0.5 text-[10px] ' + (currentSymbol.changePercent >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
              {currentSymbol.changePercent >= 0 ? <TrendingUp className="h-2.5 w-2.5" aria-hidden="true" /> : <TrendingDown className="h-2.5 w-2.5" aria-hidden="true" />}
              {currentSymbol.changePercent >= 0 ? '+' : ''}{currentSymbol.changePercent}%
            </span>
          </span>
        ) : currentQuote ? (
          <QuotePrice quote={currentQuote} className="flex shrink-0 text-xs" />
        ) : (
          <span className="st-tnum shrink-0 text-[11px] text-neutral-500" title="Live Angel One LTP is loading. Daily research bars remain delayed.">LTP …</span>
        )}

        <Search className="h-3 w-3 shrink-0 text-neutral-500 transition-colors group-hover:text-neutral-300" aria-hidden="true" />
      </button>

      {/* Popover / Combobox Dropdown */}
      {isOpen && (
        <div className="fixed left-2 right-2 top-16 z-50 mt-2 flex max-h-[85vh] flex-col overflow-hidden rounded-xl border border-white/12 bg-[#171719] shadow-2xl shadow-black/70 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:max-h-[580px] sm:w-[460px] md:w-[500px]">
          {/* Search Header Input */}
          <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--surface-1)] px-3 py-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--r-btn)] border border-[var(--line)] bg-[#101012] px-2 py-1.5 focus-within:border-[#a8c7fa]/60">
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-3)]" aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setHighlightedIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Search instruments (e.g. RELIANCE, TCS)..."
                className="st-symbol-search w-full min-w-0 bg-transparent text-xs font-medium text-[var(--text-1)] placeholder:text-[var(--text-3)] sm:text-sm"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="rounded-[var(--r-btn)] p-1 text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-[var(--r-btn)] p-1 text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-1)] sm:hidden"
              aria-label="Close instrument search"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {!showReferencePrices && (
            <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-1.5 text-[11px]">
              {liveQuotes.connected ? (
                <span className="flex items-center gap-2 text-[var(--text-3)]">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Live · Angel One
                </span>
              ) : (
                <span className="text-[var(--text-3)]">
                  {liveQuotes.loading ? 'Checking live quotes…' : 'Live quotes unavailable · delayed EOD is not substituted'}
                </span>
              )}
            </div>
          )}

          {/* Category Filter Chips */}
          <div className="p-2.5 sm:p-3 border-b border-[rgba(236,236,237,0.08)] bg-[#101012]/60 flex flex-wrap items-center gap-1.5 text-xs">
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
                  className={'flex items-center justify-center whitespace-nowrap rounded-md border px-2 py-1 text-[11px] transition-colors ' + (active ? 'border-[#a8c7fa]/40 bg-white/[0.06] text-neutral-100' : 'border-white/10 text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200')}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>

          {/* Quick-Pick Popular Symbols (when no search query) */}
          {!searchQuery.trim() && selectedCategory === 'ALL' && (
            <div className="px-3 py-2 border-b border-[rgba(236,236,237,0.06)] bg-[#101012]/30">
              <div className="mb-1.5 text-[11px] text-[var(--text-3)]">Popular</div>
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
                      className={'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors ' + (isCurrent ? 'border-[#a8c7fa]/40 bg-white/[0.06] text-neutral-100' : 'border-white/10 text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200')}
                    >
                      <span>{sym.ticker}</span>
                      {showReferencePrices && <span className={'text-[9px] ' + (sym.changePercent >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                        {sym.changePercent >= 0 ? '+' : ''}{sym.changePercent}%
                      </span>}
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
                const rowQuote = quoteFor(sym.id);
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
                    className={'flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-2.5 py-2 transition-colors ' + (isSelected ? 'border-[#a8c7fa]/40 bg-white/[0.06] text-neutral-100' : isHighlighted ? 'border-transparent bg-white/[0.04] text-neutral-100' : 'border-transparent text-neutral-300 hover:bg-white/[0.03]')}
                  >
                    {/* Left: Ticker & Name */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-[var(--text-1)] sm:text-sm">
                          {sym.ticker}
                        </span>
                        <span className="rounded border border-[var(--line)] px-1.5 py-0.5 text-[9px] text-[var(--text-3)]">
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

                    {/* Live Angel LTP in real mode; catalog references are demo-only. */}
                    <div className="text-right shrink-0 flex items-center gap-2.5">
                      {showReferencePrices && <div>
                        <div className="st-tnum text-xs font-medium text-[var(--text-1)] sm:text-sm">
                          ₹{sym.currentPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </div>
                        <div className={'st-tnum text-[11px] ' + (sym.changePercent >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]')}>
                          {sym.changePercent >= 0 ? '+' : ''}{sym.changePercent}%
                        </div>
                      </div>}
                      {!showReferencePrices && liveQuotes.connected && (rowQuote ? (
                        <div className="text-right" title={liveQuoteTimeTitle(rowQuote)}>
                          <div className="st-tnum text-xs font-medium text-[var(--text-1)] sm:text-sm">
                            {formatLivePrice(rowQuote.ltp)}
                          </div>
                          <div className={'st-tnum text-[11px] ' + (rowQuote.changePercent >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]')}>
                            {formatLiveChange(rowQuote.changePercent)}
                          </div>
                        </div>
                      ) : (
                        <div className="text-right text-[10px] leading-4 text-neutral-500" title="No live Angel One quote for this instrument. A delayed close is not substituted.">
                          LTP<br />unavailable
                        </div>
                      ))}

                      {isSelected && (
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#a8c7fa]/40 text-[#cfe0ff]">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {filteredSymbols.length > 100 && (
              <div className="p-2 text-center text-[11px] text-[var(--text-3)]">
                Showing top 100 of {filteredSymbols.length} results. Type to refine search.
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
};
