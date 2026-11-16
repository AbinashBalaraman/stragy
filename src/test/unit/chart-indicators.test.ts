import { describe, expect, it } from 'vitest';
import { calculateAllIndicators, calcPctAboveLow, calcPctChange, calcRSI, calcRSISMA, calcRSITrendline } from '../../server/backtest/indicators';
import { evaluateCondition, evaluateRuleSet } from '../../server/backtest/rules';
import { simulate } from '../../server/backtest/engine';
import { scanUniverse } from '../../server/backtest/scanner';
import { validateStrategy } from '../../shared/strategy/schema';
import { IndicatorV2Schema } from '../../shared/strategy/registry';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import { renderStrategyInPlainLanguage } from '../../shared/strategy/renderPlainLanguage';
import { detectPatternFromPrompt } from '../../server/ai/patterns';
import type { OHLCVBar } from '../../shared/strategy/types';

/** Deterministic weekday bars built from a return path; low/high are tight so "% above low" is meaningful. */
function seriesFromReturns(returns: number[], start = 1000): OHLCVBar[] {
  let close = start;
  return returns.map((r, i) => {
    const open = close;
    close = Math.max(1, open * (1 + r));
    const timestamp = Date.UTC(2024, 0, 1) + i * 86_400_000;
    return { date: new Date(timestamp).toISOString().slice(0, 10), timestamp, open, high: Math.max(open, close) * 1.004, low: Math.min(open, close) * 0.996, close, volume: 100_000 + i };
  });
}

/** Owner reference setup: a long decline, a lower RSI high, a fresh low, then a breakout bar. */
function referenceSetupSeries(): OHLCVBar[] {
  const returns: number[] = [];
  for (let i = 0; i < 180; i++) returns.push(0.0003);
  for (let i = 0; i < 30; i++) returns.push(0.012);
  for (let i = 0; i < 60; i++) returns.push(-0.01);
  for (let i = 0; i < 5; i++) returns.push(0.025);
  for (let i = 0; i < 24; i++) returns.push(-0.01);
  returns.push(0.09);
  return seriesFromReturns(returns);
}

const referenceTemplate = () => {
  const template = STRATEGY_TEMPLATES.find(t => t.id === 'rsi_trendline_breakout_near_lows');
  if (!template) throw new Error('Reference template missing');
  return template;
};

describe('causal chart indicators', () => {
  it('RSI_SMA is the simple moving average of Wilder RSI', () => {
    const bars = seriesFromReturns(Array.from({ length: 60 }, (_, i) => Math.sin(i / 3) * 0.01));
    const rsi = calcRSI(bars, 14);
    const expected = new Array(bars.length).fill(null) as (number | null)[];
    for (let i = 27; i < bars.length; i++) {
      let sum = 0;
      for (let j = i - 13; j <= i; j++) sum += rsi[j]!;
      expected[i] = sum / 14;
    }
    const actual = calcRSISMA(bars, 14, 14);
    expect(actual.map(v => v === null ? null : +v.toFixed(10))).toEqual(expected.map(v => v === null ? null : +v.toFixed(10)));
    expect(actual.slice(0, 27).every(v => v === null)).toBe(true);
  });

  it('RSI_TRENDLINE is prefix-invariant and uses only completed bars', () => {
    const rsi: (number | null)[] = Array.from({ length: 140 }, (_, i) => 40 + Math.sin(i / 5) * 20);
    rsi[40] = 72;
    const full = calcRSITrendline(rsi, { minSpan: 30, maxSpan: 180, anchorMin: 60 });
    const prefix = calcRSITrendline(rsi.slice(0, 110), { minSpan: 30, maxSpan: 180, anchorMin: 60 });
    expect(prefix).toEqual(full.slice(0, 110));
    // Appending later observations must not rewrite an already-computed value.
    const appended = calcRSITrendline([...rsi, 90, 10, 80], { minSpan: 30, maxSpan: 180, anchorMin: 60 });
    expect(appended.slice(0, full.length)).toEqual(full);
  });

  it('produces a falling line on a hand-built RSI lower-high sequence and crosses above it', () => {
    const rsi: (number | null)[] = new Array(113).fill(50);
    rsi[40] = 70;
    for (let i = 41; i <= 60; i++) rsi[i] = 70 - ((i - 40) / 20) * 10;
    for (let i = 61; i <= 80; i++) rsi[i] = 60 - ((i - 60) / 20) * 10;
    for (let i = 81; i <= 100; i++) rsi[i] = 50 - ((i - 80) / 20) * 10;
    for (let i = 101; i <= 110; i++) rsi[i] = 40 - ((i - 100) / 10) * 10;
    rsi[111] = 25;
    rsi[112] = 35;
    const line = calcRSITrendline(rsi, { minSpan: 30, maxSpan: 180, anchorMin: 60 });
    expect(line[111]).not.toBeNull();
    expect(line[112]).toBeLessThan(rsi[112]!);
    expect(line[111]).toBeGreaterThan(rsi[111]!);
    const series = { rsi, line };
    expect(evaluateCondition({ leftIndicator: 'rsi', operator: 'crossesAbove', rightIndicator: 'line' }, 112, series)).toBe(true);
    expect(evaluateCondition({ leftIndicator: 'rsi', operator: 'crossesAbove', rightIndicator: 'line' }, 111, series)).toBe(false);
  });

  it('returns null when there is no qualifying anchor or the slope is not falling', () => {
    const rising = Array.from({ length: 120 }, (_, i) => 40 + i * 0.2);
    const line = calcRSITrendline(rising, { minSpan: 30, maxSpan: 180, anchorMin: 60 });
    expect(line.every(v => v === null)).toBe(true);
    const lowAnchor = Array.from({ length: 120 }, () => 45);
    expect(calcRSITrendline(lowAnchor, { minSpan: 30, maxSpan: 180, anchorMin: 60 }).every(v => v === null)).toBe(true);
  });

  it('PCT_ABOVE_LOW and PCT_CHANGE use only close/low history within their windows', () => {
    const bars = seriesFromReturns([0, 0.1, -0.181818]);
    bars[0].low = 90; bars[1].low = 100; bars[2].low = 80;
    bars[0].close = 100; bars[1].close = 110; bars[2].close = 90;
    const above = calcPctAboveLow(bars, 3);
    expect(above.slice(0, 2)).toEqual([null, null]);
    expect(above[2]).toBeCloseTo(12.5, 10);
    const change = calcPctChange(bars, 2);
    expect(change.slice(0, 2)).toEqual([null, null]);
    expect(change[2]).toBeCloseTo(-10, 10);
  });

  it('applies registry defaults and rejects mixing percent series with oscillators', () => {
    expect(IndicatorV2Schema.parse({ id: 'rs', type: 'RSI_SMA', params: {} })).toMatchObject({ params: { rsiPeriod: 14, period: 14 } });
    expect(IndicatorV2Schema.parse({ id: 'pct', type: 'PCT_ABOVE_LOW', params: {} })).toMatchObject({ params: { period: 250 } });
    const template = referenceTemplate();
    const mixed = JSON.parse(JSON.stringify(template.strategy));
    mixed.rules.entry = [{ leftIndicator: 'low250', operator: 'gt', rightIndicator: 'rsi14' }];
    const result = validateStrategy(mixed);
    expect(result.success).toBe(false);
    expect(result.errors!.join(' ')).toMatch(/Incompatible operand units: percent and oscillator/);
  });
});

describe('reference chart template', () => {
  it('validates and renders using the shared executable gate', () => {
    const template = referenceTemplate();
    const validated = validateStrategy(template.strategy);
    expect(validated.success).toBe(true);
    expect(validated.data!.rules.entry).toHaveLength(6);
    const plain = renderStrategyInPlainLanguage(template.strategy);
    expect(plain.entrySummary.join(' ')).toContain('RSI Falling Trendline');
    expect(plain.entrySummary.join(' ')).toContain('250-Bar Low');
    expect(plain.entrySummary.join(' ')).toContain('126-Bar Change');
  });

  it('matches the synthetic reference setup and does not match a control series', () => {
    const template = referenceTemplate();
    const bars = referenceSetupSeries();
    const series = calculateAllIndicators(bars, template.strategy.indicators);
    expect(evaluateRuleSet(template.strategy.rules.entry, bars.length - 1, series)).toBe(true);
    const last = bars.length - 1;
    expect(series.rsi14[last]).toBeGreaterThan(series.rsi_tl[last]!);
    expect(series.rsi14[last - 1]).toBeLessThanOrEqual(series.rsi_tl[last - 1]!);
    expect(series.rsi14[last]).toBeGreaterThan(series.rsi_sma14[last]!);
    expect(series.low250[last]!).toBeLessThan(15);
    expect(series.chg126[last]!).toBeLessThan(5);

    const control = seriesFromReturns(Array.from({ length: 300 }, (_, i) => 0.002 + Math.sin(i / 4) * 0.001));
    const controlSeries = calculateAllIndicators(control, template.strategy.indicators);
    expect(evaluateRuleSet(template.strategy.rules.entry, control.length - 1, controlSeries)).toBe(false);
  });

  it('runs through the next-open engine without look-ahead errors', () => {
    const template = referenceTemplate();
    const bars = referenceSetupSeries();
    const result = simulate(template.strategy, bars, { robustness: false });
    expect(result.bars).toHaveLength(bars.length);
    expect(result.reconciliation?.difference ?? 0).toBeCloseTo(0, 8);
  });

  it('runs in the scanner over the demo universe without evaluation failures', () => {
    const template = referenceTemplate();
    const result = scanUniverse(template.strategy, 'nifty50', 5, { mode: 'demo' });
    expect(result.attempted).toBeGreaterThan(0);
    expect(result.failed).toBe(0);
    expect(result.succeeded).toBeGreaterThan(0);
    expect(Array.isArray(result.nearMatches)).toBe(true);
  });

  it('is discoverable through the pattern library without hijacking generic RSI prompts', () => {
    expect(detectPatternFromPrompt('find an RSI trendline breakout near lows')?.key).toBe('rsi_trendline_breakout');
    expect(detectPatternFromPrompt('chart image: lower highs on RSI')?.key).toBe('rsi_trendline_breakout');
    expect(detectPatternFromPrompt('rsi oversold mean reversion bounce')?.key).toBe('rsi_oversold');
    expect(detectPatternFromPrompt('golden cross 50 200')?.key).toBe('golden_cross');
  });
});
