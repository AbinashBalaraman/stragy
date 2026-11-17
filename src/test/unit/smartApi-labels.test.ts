import { describe, expect, it } from 'vitest';
import { MARKET_REGIME_LABELS, SIGNAL_LABELS, TREND_LABELS } from '../../server/data/smartApi';

const labels = [
  ...Object.values(TREND_LABELS),
  ...Object.values(SIGNAL_LABELS),
  ...Object.values(MARKET_REGIME_LABELS),
];

describe('technical regime labels', () => {
  it('uses plain sentence-case wording without marketing terms', () => {
    for (const label of labels) {
      expect(label).not.toMatch(/institutional|velocity/i);
      const words = label.split(/\s+/).slice(1);
      for (const word of words) {
        const cleaned = word.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
        // Acronyms (RSI, EMA, SMA) stay uppercase; ordinary Title Case words do not.
        if (!/^[A-Z][a-z]/.test(cleaned)) continue;
        throw new Error(`Title-case word "${word}" in label "${label}"`);
      }
    }
  });

  it('keeps the intended plain labels and stable concept order', () => {
    expect(TREND_LABELS.STRONG_BULLISH).toBe('Strong uptrend (above 20, 50 and 200-day EMAs)');
    expect(SIGNAL_LABELS.BREAKOUT).toBe('Breakout with rising momentum');
    expect(SIGNAL_LABELS.GOLDEN_CROSS).toBe('Recent golden cross');
    expect(TREND_LABELS.OVERSOLD_REVERSAL).toBe('Oversold dip (RSI below 35)');
    expect(TREND_LABELS.BULLISH).toBe('Uptrend (above 50-day SMA)');
    expect(SIGNAL_LABELS.PULLBACK).toBe('Pullback to 20-day EMA');
    expect(MARKET_REGIME_LABELS.ABOVE_VALUE_AREA).toBe('Breakout above the value-area high');
  });
});
