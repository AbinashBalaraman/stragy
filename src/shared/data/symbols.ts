import { SymbolMeta } from '../strategy/types';
import { generateComprehensiveStockUniverse } from './nseSymbolsData';

/** Thrown for any symbol id outside the bundled catalog; API maps it to 422 UNKNOWN_SYMBOL. */
export class UnknownSymbolError extends Error {
  readonly code = 'UNKNOWN_SYMBOL';
  constructor(id: number) {
    super('Unknown symbol ID: ' + id);
    this.name = 'UnknownSymbolError';
  }
}

export const ALL_SYMBOLS: SymbolMeta[] = generateComprehensiveStockUniverse();
// Official NSE constituent CSV, observed 2026-10-16: INE155A01022.
// A new stable identity avoids silently changing old TATAMOTORS strategies after the demerger.
ALL_SYMBOLS.push({ id: 50001, ticker: 'TMPV', name: 'Tata Motors Passenger Vehicles Ltd.', exchange: 'NSE', sector: 'Automobile and Auto Components', currentPrice: 0, changePercent: 0, indices: ['NIFTY_50', 'NIFTY_AUTO'] });

// Backwards-compatible alias for existing references
export const NSE_SYMBOLS = ALL_SYMBOLS;

export function getSymbolById(id: number): SymbolMeta {
  const symbol=Number.isSafeInteger(id)?ALL_SYMBOLS.find(s=>s.id===id):undefined;
  if(!symbol)throw new UnknownSymbolError(id);
  return symbol;
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
  /** Maximum symbols a cold snapshot evaluates; the remainder is reported as not attempted. */
  evaluatedCap?: number;
  /** Where membership comes from when the official feed is not available. */
  membershipBasis?: 'official-feed' | 'configured-catalog';
}

export const UNIVERSE_OPTIONS: UniverseOption[] = [
  { id: 'ALL', label: 'Configured NSE + BSE (first 200)', category: 'All', description: 'Bounded 200-symbol screen from the configured NSE + BSE catalog, in catalog order', badge: 'All', evaluatedCap: 200, membershipBasis: 'configured-catalog' },
  { id: 'NSE', label: 'Configured NSE (first 200)', category: 'Exchange', description: 'Bounded 200-symbol screen from the configured National Stock Exchange catalog', badge: 'NSE', evaluatedCap: 200, membershipBasis: 'configured-catalog' },
  { id: 'BSE', label: 'Configured BSE (first 200)', category: 'Exchange', description: 'Bounded 200-symbol screen from the configured Bombay Stock Exchange catalog', badge: 'BSE', evaluatedCap: 200, membershipBasis: 'configured-catalog' },
  { id: 'NIFTY_50', label: 'NIFTY 50', category: 'Benchmark & Sector Indices', description: 'Official NSE constituent feed when reachable; otherwise the bundled NIFTY 50 pool with unverified membership', badge: 'NIFTY 50', membershipBasis: 'official-feed' },
  { id: 'BANK_NIFTY', label: 'Bank NIFTY', category: 'Benchmark & Sector Indices', description: 'Configured bank pool, first 50 by catalog order; membership unverified', badge: 'BANK', evaluatedCap: 50, membershipBasis: 'configured-catalog' },
  { id: 'NIFTY_IT', label: 'NIFTY IT', category: 'Benchmark & Sector Indices', description: 'Configured IT pool, first 50 by catalog order; membership unverified', badge: 'IT', evaluatedCap: 50, membershipBasis: 'configured-catalog' },
  { id: 'NIFTY_AUTO', label: 'NIFTY Auto', category: 'Benchmark & Sector Indices', description: 'Configured auto pool, first 50 by catalog order; membership unverified', badge: 'AUTO', evaluatedCap: 50, membershipBasis: 'configured-catalog' },
  { id: 'NIFTY_PHARMA', label: 'NIFTY Pharma', category: 'Benchmark & Sector Indices', description: 'Configured pharma pool, first 50 by catalog order; membership unverified', badge: 'PHARMA', evaluatedCap: 50, membershipBasis: 'configured-catalog' },
  { id: 'NIFTY_METAL', label: 'NIFTY Metal', category: 'Benchmark & Sector Indices', description: 'Configured metal pool, first 50 by catalog order; membership unverified', badge: 'METAL', evaluatedCap: 50, membershipBasis: 'configured-catalog' },
  { id: 'NIFTY_FMCG', label: 'NIFTY FMCG', category: 'Benchmark & Sector Indices', description: 'Configured FMCG pool, first 50 by catalog order; membership unverified', badge: 'FMCG', evaluatedCap: 50, membershipBasis: 'configured-catalog' },
  { id: 'BSE_SENSEX', label: 'BSE SENSEX 30', category: 'Benchmark & Sector Indices', description: 'Configured BSE-listed Sensex pool screened through verified BSE scrip codes', badge: 'SENSEX', evaluatedCap: 40, membershipBasis: 'configured-catalog' },
  { id: 'POPULAR_INDICES', label: 'Popular Indices', category: 'Benchmark & Sector Indices', description: 'Eight benchmark and sectoral indices resolved through the verified provider instrument master', badge: 'INDICES', evaluatedCap: 20, membershipBasis: 'configured-catalog' }
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
  if (universe === 'NIFTY_50') {
    // Only curated equities belong to the tradable universe; the benchmark index ticker
    // (^NSEI) is metadata and must never be scanned as a Nifty 50 constituent.
    return ALL_SYMBOLS.filter(s => s.indices?.includes(universe) && !s.ticker.startsWith('^'));
  }
  return ALL_SYMBOLS.filter(s => s.indices?.includes(universe));
}
