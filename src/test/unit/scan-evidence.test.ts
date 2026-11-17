import { describe, expect, it } from 'vitest';
import type { IndicatorConfig } from '../../shared/strategy/types';
import {
  describeUnmatchedRule, formatIndicatorValue, getIndicatorLabel, humanFreshnessLabel, humanObservationFreshness,
  humanSourceLabel, renderRuleInPlainLanguage,
} from '../../shared/strategy/renderPlainLanguage';

const indicators: IndicatorConfig[] = [
  { id: 'rsi14', type: 'RSI', params: { period: 14 } },
  { id: 'rsi_sma', type: 'RSI_SMA', params: { rsiPeriod: 14, period: 14 } },
  { id: 'tl', type: 'RSI_TRENDLINE', params: { rsiPeriod: 14, minSpan: 30, maxSpan: 180, anchorMin: 60 } },
  { id: 'low250', type: 'PCT_ABOVE_LOW', params: { period: 250 } },
  { id: 'chg20', type: 'PCT_CHANGE', params: { period: 20 } },
  { id: 'chg250', type: 'PCT_CHANGE', params: { period: 250 } },
  { id: 'ema50', type: 'EMA', params: { period: 50 } },
  { id: 'vol_sma_20', type: 'VOLUME_SMA', params: { period: 20 } },
  { id: 'high20', type: 'HIGHEST', params: { period: 20 } },
  { id: 'low20', type: 'LOWEST', params: { period: 20 } },
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
    expect(getIndicatorLabel('high20', indicators)).toBe('20-day high');
    expect(getIndicatorLabel('low20', indicators)).toBe('20-day low');
    expect(getIndicatorLabel('low250', indicators)).toBe('% above its 52-week low');
    expect(getIndicatorLabel('rsi_sma', indicators)).toBe("RSI's 14-day average");
    expect(renderRuleInPlainLanguage({ leftIndicator: 'close', operator: 'gt', rightIndicator: 'ema50' }, indicators)).toBe('Close above 50-day EMA');
    expect(renderRuleInPlainLanguage({ leftIndicator: 'rsi14', operator: 'crossesAbove', rightIndicator: 'tl_line' }, indicators))
      .toBe('RSI crossed above its falling trendline');
    expect(renderRuleInPlainLanguage({
      leftIndicator: 'rsi14', operator: 'lt', rightIndicator: 'tl_line',
      lookback: { bars: 5, includeCurrent: false, match: 'any' },
    }, indicators)).toBe('RSI was below its falling trendline in the last 5 days');
    expect(renderRuleInPlainLanguage({ leftIndicator: 'rsi14', operator: 'gt', rightIndicator: 'rsi_sma' }, indicators))
      .toBe('RSI is above its 14-day average');
    expect(renderRuleInPlainLanguage({
      leftIndicator: 'rsi14', operator: 'lt', rightValue: 30,
      lookback: { bars: 5, includeCurrent: false, match: 'any' },
    }, indicators)).toBe('RSI was below 30 in the last 5 days');
    expect(renderRuleInPlainLanguage({ leftIndicator: 'low250', operator: 'lt', rightValue: 15 }, indicators))
      .toBe('Close is within 15% of its 52-week low');
    expect(renderRuleInPlainLanguage({ leftIndicator: 'close', operator: 'crossesAbove', rightIndicator: 'high20' }, indicators))
      .toBe('Close crossed above the 20-day high');
    expect(getIndicatorLabel('chg20', indicators)).toBe('20-day change');
    expect(getIndicatorLabel('chg250', indicators)).toBe('1-year change');
    expect(renderRuleInPlainLanguage({ leftIndicator: 'chg20', operator: 'lt', rightValue: 0 }, indicators))
      .toBe('20-day change is negative');
  });

  it('describes a near-low miss and a close-vs-average miss in plain language', () => {
    expect(describeUnmatchedRule({ leftIndicator: 'low250', operator: 'lt', rightValue: 5 }, indicators, 13.04))
      .toBe('Close is not within 5% of its 52-week low yet (now 13.04% above).');
    expect(describeUnmatchedRule({ leftIndicator: 'close', operator: 'gt', rightIndicator: 'ema50' }, indicators, 1344.8))
      .toBe('Close is not above 50-day EMA yet (now 1,344.8).');
    expect(describeUnmatchedRule({ leftIndicator: 'chg20', operator: 'lt', rightValue: 0 }, indicators, 2.49))
      .toBe('20-day change is +2.49% (needs below 0%).');
    expect(describeUnmatchedRule({ leftIndicator: 'chg250', operator: 'lt', rightValue: 0 }, indicators, -4.2))
      .toBe('1-year change is -4.2% (needs below 0%).');
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
