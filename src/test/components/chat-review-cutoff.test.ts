// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isCurrentReviewResult, reviewDay } from '../../components/chat/AiCopilotDock';
import type { BacktestReview } from '../../components/chat/types';
import { canonicalStrategySignature } from '../../shared/strategy/backtestReview';
import { validStrategy } from '../../server/ai/testFixtures';
import type { BacktestResponse, StrategyAST } from '../../shared/strategy/types';

const strategy = validStrategy() as StrategyAST;
const symbol = { id: 1, ticker: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE' as const, sector: 'Energy', currentPrice: 2900, changePercent: 0.5 };

const review = (asOf?: string): BacktestReview => ({
  id: 'review-1',
  strategy,
  symbol,
  asOf,
  sourceLabel: 'Your workspace strategy',
  sourceType: 'workspace',
  assumptions: [],
  originSnapshot: '{}',
  strategySignature: canonicalStrategySignature(strategy) ?? '',
});

const resultThrough = (observedThrough: string): BacktestResponse => ({
  backtestId: 'run-1',
  strategy,
  symbol,
  metrics: { initialCapital: 100000, finalEquity: 101000, netPnl: 1000, totalReturnPercent: 1, cagr: 1, sharpeRatio: 1, maxDrawdownPercent: 1, totalTrades: 1, unavailableReasons: {} },
  equityCurve: [],
  trades: [],
  bars: [{ date: '2025-01-01' }, { date: observedThrough }],
  provenance: { mode: 'real', source: 'ANGEL_SMARTAPI', asOf: observedThrough, actualRange: { start: '2023-11-17', end: observedThrough } },
  warnings: [],
} as unknown as BacktestResponse);

describe('review cutoff', () => {
  it('accepts data that ends before the cutoff (a cutoff is not a promise of that day)', () => {
    expect(isCurrentReviewResult(resultThrough('2026-11-16'), review('2026-11-17'))).toBe(true);
  });

  it('accepts an exact match and no cutoff at all', () => {
    expect(isCurrentReviewResult(resultThrough('2026-11-17'), review('2026-11-17'))).toBe(true);
    expect(isCurrentReviewResult(resultThrough('2026-11-16'), review(undefined))).toBe(true);
  });

  it('rejects observations after the cutoff', () => {
    expect(isCurrentReviewResult(resultThrough('2026-11-18'), review('2026-11-17'))).toBe(false);
  });

  it('normalises timestamps to their calendar day', () => {
    expect(reviewDay('2026-11-17T09:15:00+05:30')).toBe('2026-11-17');
    expect(reviewDay('2026-11-17')).toBe('2026-11-17');
    expect(reviewDay('not a date')).toBeNull();
    expect(reviewDay(undefined)).toBeNull();
  });
});
