import type { StrategyAST, SymbolMeta } from '../../shared/strategy/types';

/** A frozen, explicitly reviewed candidate. Preparing it never applies or runs anything. */
export interface BacktestReview {
  id: string;
  strategy: StrategyAST;
  symbol: SymbolMeta;
  asOf?: string;
  sourceLabel: string;
  sourceType: 'screen' | 'draft';
  assumptions: string[];
  originSnapshot: string;
  /** Canonical reviewed strategy content, frozen at review preparation. */
  strategySignature: string;
}
