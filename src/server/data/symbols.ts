import { SymbolMeta } from '../../shared/strategy/types';
import { generateComprehensiveStockUniverse } from './nseSymbolsData';

export const ALL_SYMBOLS: SymbolMeta[] = generateComprehensiveStockUniverse();

// Backwards-compatible alias for existing references
export const NSE_SYMBOLS = ALL_SYMBOLS;

export function getSymbolById(id: number): SymbolMeta {
  return ALL_SYMBOLS.find(s => s.id === id) || ALL_SYMBOLS[0];
}

export function getSymbolByTicker(ticker: string): SymbolMeta | undefined {
  return ALL_SYMBOLS.find(s => s.ticker === ticker);
}

export function updateSymbolPriceAndChange(id: number, price: number, changePercent: number) {
  const sym = ALL_SYMBOLS.find(s => s.id === id);
  if (sym) {
    sym.currentPrice = price;
    sym.changePercent = changePercent;
  }
}

export type MarketUniverseType =
  | 'ALL'
  | 'NSE'
  | 'BSE'
  | 'NIFTY_50'
  | 'BANK_NIFTY'
  | 'NIFTY_IT'
  | 'NIFTY_AUTO'
  | 'NIFTY_PHARMA'
  | 'NIFTY_METAL'
  | 'NIFTY_FMCG'
  | 'BSE_SENSEX'
  | 'POPULAR_INDICES';

export interface UniverseOption {
  id: MarketUniverseType;
  label: string;
  category: 'Exchange' | 'Benchmark & Sector Indices' | 'All';
  description: string;
  badge: string;
}

export const UNIVERSE_OPTIONS: UniverseOption[] = [
  { id: 'ALL', label: 'All Markets (NSE + BSE)', category: 'All', description: 'Complete universe across all 2,000+ NSE & BSE equities and indices', badge: 'All' },
  { id: 'NSE', label: 'All NSE Stocks (2000+)', category: 'Exchange', description: 'National Stock Exchange of India (NSE) listed equities (~2,000+ stocks)', badge: 'NSE' },
  { id: 'BSE', label: 'All BSE Stocks', category: 'Exchange', description: 'Bombay Stock Exchange (BSE) listed equities', badge: 'BSE' },
  { id: 'NIFTY_50', label: 'NIFTY 50', category: 'Benchmark & Sector Indices', description: 'Top 50 large-cap bluechip stocks of India', badge: 'NIFTY 50' },
  { id: 'BANK_NIFTY', label: 'Bank NIFTY', category: 'Benchmark & Sector Indices', description: 'Leading private and PSU banking giants', badge: 'BANK' },
  { id: 'NIFTY_IT', label: 'NIFTY IT', category: 'Benchmark & Sector Indices', description: 'Top technology & software exporters', badge: 'IT' },
  { id: 'NIFTY_AUTO', label: 'NIFTY Auto', category: 'Benchmark & Sector Indices', description: 'Leading automotive, 2-wheeler, EV & commercial vehicle OEMs', badge: 'AUTO' },
  { id: 'NIFTY_PHARMA', label: 'NIFTY Pharma', category: 'Benchmark & Sector Indices', description: 'Top pharmaceutical & healthcare leaders', badge: 'PHARMA' },
  { id: 'NIFTY_METAL', label: 'NIFTY Metal', category: 'Benchmark & Sector Indices', description: 'Steel, aluminium, mining & base metal companies', badge: 'METAL' },
  { id: 'NIFTY_FMCG', label: 'NIFTY FMCG', category: 'Benchmark & Sector Indices', description: 'Fast-moving consumer goods & household staples', badge: 'FMCG' },
  { id: 'BSE_SENSEX', label: 'BSE SENSEX 30', category: 'Benchmark & Sector Indices', description: 'BSE flagship 30 well-established companies', badge: 'SENSEX' },
  { id: 'POPULAR_INDICES', label: 'Popular Indices', category: 'Benchmark & Sector Indices', description: 'All major benchmark & sectoral market indices', badge: 'INDICES' }
];

export function filterSymbolsByUniverse(universe: MarketUniverseType = 'ALL'): SymbolMeta[] {
  if (universe === 'ALL') {
    return ALL_SYMBOLS;
  }
  if (universe === 'NSE') {
    return ALL_SYMBOLS.filter(s => s.exchange === 'NSE' && !s.ticker.startsWith('^'));
  }
  if (universe === 'BSE') {
    return ALL_SYMBOLS.filter(s => s.exchange === 'BSE' && !s.ticker.startsWith('^'));
  }
  if (universe === 'POPULAR_INDICES') {
    return ALL_SYMBOLS.filter(s => s.indices?.includes('POPULAR_INDICES') || s.ticker.startsWith('^'));
  }
  return ALL_SYMBOLS.filter(s => s.indices?.includes(universe));
}
