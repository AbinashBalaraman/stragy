import type { IndicatorConfig, RuleNode, StrategyAST } from './types';
import { truncateAtWord } from '../format';

const conditionText = (value: number | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? String(Number(value.toFixed(2))) : '';

function indicator(indicators: IndicatorConfig[], id: string | undefined): IndicatorConfig | undefined {
  return id ? indicators.find(item => item.id === id) : undefined;
}

function isType(indicators: IndicatorConfig[], id: string | undefined, type: IndicatorConfig['type']): boolean {
  return indicator(indicators, id)?.type === type;
}

function periodOf(item: IndicatorConfig | undefined, fallback: number): number {
  const value = Number((item?.params as Record<string, unknown> | undefined)?.period);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * A screen title is derived from the rules, never from the model's prose. The
 * two most distinctive parts are kept in a stable display order: drawn-line
 * trigger, range, price-vs-MA, RSI band/trigger, then background.
 */
export function buildScreenTitle(strategy: StrategyAST, max = 70): string {
  const indicators = strategy.indicators;
  const entry = strategy.rules.entry;
  const parts: string[] = [];
  const push = (part: string) => { if (part && !parts.includes(part)) parts.push(part); };

  const rsiTrendline = entry.find(rule => rule.operator === 'crossesAbove'
    && isType(indicators, rule.leftIndicator, 'RSI')
    && isType(indicators, rule.rightIndicator?.replace(/_line$/, ''), 'RSI_TRENDLINE'));
  if (rsiTrendline) push('RSI trendline breakout');

  const highBreakout = entry.find(rule => rule.leftIndicator === 'close'
    && rule.operator === 'crossesAbove'
    && isType(indicators, rule.rightIndicator, 'HIGHEST'));
  if (highBreakout) {
    const high = indicator(indicators, highBreakout.rightIndicator);
    push(`${periodOf(high, 60)}-day high breakout`);
  }

  const nearLow = entry.find(rule => isType(indicators, rule.leftIndicator, 'PCT_ABOVE_LOW'));
  if (nearLow) {
    const low = indicator(indicators, nearLow.leftIndicator);
    const period = periodOf(low, 250);
    push(period >= 250 ? 'near 52-week low' : `near ${period}-bar low`);
  }

  for (const rule of entry) {
    if (rule.leftIndicator !== 'close' || !rule.rightIndicator) continue;
    const average = indicator(indicators, rule.rightIndicator);
    if (!average || (average.type !== 'SMA' && average.type !== 'EMA')) continue;
    if (rule.operator !== 'gt' && rule.operator !== 'lt') continue;
    push(`${rule.operator === 'gt' ? 'Above' : 'Below'} ${periodOf(average, 200)} ${average.type}`);
  }

  const rsiBands = entry.filter(rule => isType(indicators, rule.leftIndicator, 'RSI')
    && (rule.operator === 'gte' || rule.operator === 'lte')
    && typeof rule.rightValue === 'number');
  const bandLow = rsiBands.find(rule => rule.operator === 'gte');
  const bandHigh = rsiBands.find(rule => rule.operator === 'lte');
  if (bandLow && bandHigh && bandLow.leftIndicator === bandHigh.leftIndicator) {
    push(`RSI ${conditionText(bandLow.rightValue)}–${conditionText(bandHigh.rightValue)}`);
  }

  const rsiAboveSignal = entry.find(rule => isType(indicators, rule.leftIndicator, 'RSI')
    && isType(indicators, rule.rightIndicator, 'RSI_SMA')
    && rule.operator === 'gt');
  if (rsiAboveSignal) push('RSI above its average');

  const rsiBelow = entry.find(rule => isType(indicators, rule.leftIndicator, 'RSI') && rule.operator === 'lt' && typeof rule.rightValue === 'number');
  if (rsiBelow) push(`RSI below ${conditionText(rsiBelow.rightValue)}`);

  const macd = entry.find(rule => isType(indicators, rule.leftIndicator.replace(/_line$/, ''), 'MACD') && /_signal$/.test(rule.rightIndicator ?? ''));
  if (macd) push('MACD above signal');

  const volume = entry.find(rule => rule.leftIndicator === 'volume' && isType(indicators, rule.rightIndicator, 'VOLUME_SMA'));
  if (volume) push('Volume above average');

  const negative = entry.find(rule => isType(indicators, rule.leftIndicator, 'PCT_CHANGE') && typeof rule.rightValue === 'number' && rule.rightValue <= 0);
  if (negative) {
    const change = indicator(indicators, negative.leftIndicator);
    push(`${periodOf(change, 126)}-bar decline`);
  }

  const title = parts.slice(0, 2).join(' · ');
  return truncateAtWord(title || strategy.name, max);
}

/**
 * The model summary is prose, not a second condition list. Remove a trailing
 * "Conditions: ..." block and fall back to a neutral description.
 */
export function cleanScreenSummary(value: string | null | undefined, fallback = 'Chart setup'): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  const match = /\bConditions?\s*:/i.exec(text);
  const clean = (match ? text.slice(0, match.index) : text)
    .trim()
    .replace(/[\s.;,:–—-]+$/u, '');
  return clean || fallback;
}
