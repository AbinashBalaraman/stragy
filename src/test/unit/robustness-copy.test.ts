import { describe, expect, it } from 'vitest';
import { decaySentence, plainRobustnessReason, trainTestSentence } from '../../components/results/robustnessCopy';
import type { TrainTestSplitResult } from '../../shared/strategy/types';

const split = (overrides: Partial<TrainTestSplitResult> = {}): TrainTestSplitResult => ({
  status: 'available',
  reason: 'Fixed strategy holdout; no verified parameter-selection history, so overfitting risk is not classified.',
  method: 'independent-chronological-holdout',
  trainMetrics: { cagr: 10, sharpe: 1, maxDrawdown: 5, winRate: 50, profitFactor: 1.5, tradesCount: 10 },
  testMetrics: { cagr: 2, sharpe: 0.4, maxDrawdown: 8, winRate: 45, profitFactor: 1.2, tradesCount: 6 },
  cagrDecayRatio: 0.2,
  sharpeDecayRatio: 0.4,
  overfittingRisk: 'UNAVAILABLE',
  splitDate: '2025-06-01',
  ...overrides,
});

describe('robustness copy', () => {
  it('names a small test window plainly instead of a risk pill', () => {
    expect(trainTestSentence(split({ testMetrics: { ...split().testMetrics, tradesCount: 4 } })))
      .toBe('Not enough trades in one window to judge this. Each window needs at least 5 trades; run a longer window.');
  });

  it('uses sentence-case status words when a classification exists', () => {
    expect(trainTestSentence(split({ overfittingRisk: 'LOW' }))).toBe('The test window looks stable compared with the fitted window.');
    expect(trainTestSentence(split({ overfittingRisk: 'MODERATE' }))).toBe('The test window is mixed compared with the fitted window.');
    expect(trainTestSentence(split({ overfittingRisk: 'HIGH' }))).toBe('The test window is weaker than the fitted window.');
  });

  it('says why a fixed strategy is not scored', () => {
    expect(trainTestSentence(split())).toContain('no verified record of how its rules were chosen');
  });

  it('formats the decay as a percentage change, in both directions', () => {
    expect(decaySentence(0.1730725735113718)).toBe('Return was 83% lower in the test window.');
    expect(decaySentence(1.25)).toBe('Return was 25% higher in the test window.');
    expect(decaySentence(1)).toBe('Return was about the same in the test window.');
    expect(decaySentence(null)).toBe('The fitted window return was zero or negative, so a percentage change would not be meaningful.');
  });

  it('turns internal reason codes into plain sentences', () => {
    expect(plainRobustnessReason('NO_TRADES')).toBe('This run has no trades to reshuffle.');
    expect(plainRobustnessReason('SOME_NEW_CODE')).toBe('Some new code.');
    expect(plainRobustnessReason('')).toBe('This check is unavailable for this run.');
  });
});
