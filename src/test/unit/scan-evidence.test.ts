import { describe, expect, it } from 'vitest';
import type { IndicatorConfig } from '../../shared/strategy/types';
import {
  describeUnmatchedRule, formatIndicatorValue, getIndicatorLabel, humanFreshnessLabel, humanObservationFreshness, humanSourceLabel,
} from '../../shared/strategy/renderPlainLanguage';

const indicators: IndicatorConfig[] = [
  { id: 'rsi14', type: 'RSI', params: { period: 14 } },
  { id: 'vol_sma_20', type: 'VOLUME_SMA', params: { period: 20 } },
  { id: 'high20', type: 'HIGHEST', params: { period: 20 } },
];

describe('screen evidence presentation', () => {
  it('uses human source and freshness labels instead of provider codes', () => {
    expect(humanSourceLabel('ANGEL_SMARTAPI')).toBe('Angel One');
    expect(humanSourceLabel('YAHOO_PUBLIC_CHART')).toBe('Yahoo public daily');
    expect(humanSourceLabel('DETERMINISTIC_DEMO_V1')).toBe('Stragy demo');
    expect(humanFreshnessLabel('last-completed-session')).toBe('last completed session');
    expect(humanFreshnessLabel('fixed-demo')).toBe('fixed demo');
  });

  it('rounds oscillator values and compacts volume values', () => {
    expect(formatIndicatorValue('RSI (14)', 34.234)).toBe('34.23');
    expect(formatIndicatorValue('Volume avg 20d', 9_789_303.8)).toBe('97.9 L');
    expect(formatIndicatorValue('Volume avg 20d', 12_500_000)).toBe('1.3 Cr');
    expect(getIndicatorLabel('vol_sma_20', indicators)).toBe('Volume avg 20d');
    expect(getIndicatorLabel('high20', indicators)).toBe('Highest high of previous 20 bars');
  });

  it('describes the missing screen condition in plain words with its current value', () => {
    const text = describeUnmatchedRule(
      { leftIndicator: 'rsi14', operator: 'lt', rightValue: 30, lookback: { bars: 20, includeCurrent: false, match: 'any' } },
      indicators, 34.2,
    );
    expect(text).toContain('RSI (14)');
    expect(text).toContain('has not dropped below 30');
    expect(text).toContain('preceding 20 completed bars');
    expect(text).toContain('now 34.2');
  });

  it('never abbreviates a raw provider code in the visible label', () => {
    const text = describeUnmatchedRule({ leftIndicator: 'rsi14', operator: 'gt', rightValue: 70 }, indicators, 34.2);
    expect(text).toContain('has not risen above 70');
    expect(text).not.toContain('last-completed-session');
    expect(text).not.toContain('ANGEL_SMARTAPI');
  });

  it('never calls a row stale when its date is the scan’s latest observed session', () => {
    expect(humanObservationFreshness('stale-observation', '2026-11-16', '2026-11-16')).toBe('last completed session');
    expect(humanObservationFreshness('stale-observation', '2026-11-13', '2026-11-16')).toBe('last bar 1 session old');
    expect(humanObservationFreshness('stale-observation', '2026-11-12', '2026-11-16')).toBe('last bar 2 sessions old');
    expect(humanObservationFreshness('public delayed end of day', '2026-11-16', '2026-11-16')).toBe('public delayed end of day');
  });
});
