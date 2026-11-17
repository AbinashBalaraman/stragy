import { describe, expect, it } from 'vitest';
import { buildScreenTitle, cleanScreenSummary } from '../../shared/strategy/screenTitle';
import { validStrategy } from '../../server/ai/testFixtures';
import type { StrategyAST } from '../../shared/strategy/types';

function chartStrategy(): StrategyAST {
  const strategy = validStrategy();
  strategy.indicators = [
    { id: 'rsi14', type: 'RSI', params: { period: 14 } },
    { id: 'tl', type: 'RSI_TRENDLINE', params: { rsiPeriod: 14, minSpan: 30, maxSpan: 180, anchorMin: 60 } },
    { id: 'low250', type: 'PCT_ABOVE_LOW', params: { period: 250 } },
  ];
  strategy.rules.entry = [
    { leftIndicator: 'rsi14', operator: 'crossesAbove', rightIndicator: 'tl_line' },
    { leftIndicator: 'low250', operator: 'lt', rightValue: 15 },
  ];
  return strategy;
}

function emaBandStrategy(): StrategyAST {
  const strategy = validStrategy();
  strategy.indicators = [
    { id: 'ema50', type: 'EMA', params: { period: 50 } },
    { id: 'rsi14', type: 'RSI', params: { period: 14 } },
  ];
  strategy.rules.entry = [
    { leftIndicator: 'close', operator: 'gt', rightIndicator: 'ema50' },
    { leftIndicator: 'rsi14', operator: 'gte', rightValue: 62 },
    { leftIndicator: 'rsi14', operator: 'lte', rightValue: 82 },
  ];
  return strategy;
}

describe('deterministic screen titles', () => {
  it('builds the drawn-line and range title from rules', () => {
    expect(buildScreenTitle(chartStrategy())).toBe('RSI trendline breakout · near 52-week low');
  });

  it('builds the price-vs-average and RSI-band title from rules', () => {
    expect(buildScreenTitle(emaBandStrategy())).toBe('Above 50 EMA · RSI 62–82');
  });

  it('never returns a title longer than 70 characters and cuts at a word boundary', () => {
    const strategy = validStrategy();
    strategy.name = 'A very long model-written sentence that should never become the card title because conditions decide it';
    strategy.rules.entry = [{ leftIndicator: 'close', operator: 'gt', rightValue: 0 }];
    const title = buildScreenTitle(strategy);
    expect(title.length).toBeLessThanOrEqual(70);
    expect(title).not.toMatch(/\s…$/);
  });
});

describe('screen summary cleanup', () => {
  it('removes a trailing conditions list', () => {
    expect(cleanScreenSummary('Daily RSI recovery near the low. Conditions: RSI (14) is greater than RSI Signal SMA (14, 14); Close Price is greater than EMA (50).'))
      .toBe('Daily RSI recovery near the low');
  });

  it('keeps a clean summary and supplies a neutral fallback', () => {
    expect(cleanScreenSummary('Daily uptrend continuation above the 50-day EMA.')).toBe('Daily uptrend continuation above the 50-day EMA');
    expect(cleanScreenSummary('', 'Chart setup')).toBe('Chart setup');
  });
});
