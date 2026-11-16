import { StrategyAST, IndicatorConfig, RuleNode } from './types';

export function getIndicatorLabel(indId: string, indicators: IndicatorConfig[]): string {
  // Check price fields
  if (indId === 'close') return 'Close Price';
  if (indId === 'open') return 'Open Price';
  if (indId === 'high') return 'High Price';
  if (indId === 'low') return 'Low Price';
  if (indId === 'volume') return 'Volume';
  if (indId === 'candleBody') return 'Candle Body Height';
  if (indId === 'upperWick') return 'Upper Shadow / Wick';
  if (indId === 'lowerWick') return 'Lower Shadow / Wick';

  // Sub-indicators (e.g. bb1_upper, macd1_line)
  if (indId.endsWith('_upper')) {
    const parentId = indId.replace('_upper', '');
    const parent = indicators.find(i => i.id === parentId);
    return `${parent ? parent.type : 'BB'} Upper Band (${parent?.params?.period || 20}, ${parent?.params?.stdDev || 2}σ)`;
  }
  if (indId.endsWith('_lower')) {
    const parentId = indId.replace('_lower', '');
    const parent = indicators.find(i => i.id === parentId);
    return `${parent ? parent.type : 'BB'} Lower Band (${parent?.params?.period || 20}, ${parent?.params?.stdDev || 2}σ)`;
  }
  if (indId.endsWith('_middle')) {
    const parentId = indId.replace('_middle', '');
    const parent = indicators.find(i => i.id === parentId);
    return `${parent ? parent.type : 'BB'} Middle Band (${parent?.params?.period || 20})`;
  }
  if (indId.endsWith('_line')) {
    const parentId = indId.replace(/_line$/, '');
    const parent = indicators.find(i => i.id === parentId);
    if (parent?.type === 'RSI_TRENDLINE') return `RSI Falling Trendline (${(parent.params as any).rsiPeriod ?? 14}, ${(parent.params as any).minSpan ?? 30}-${(parent.params as any).maxSpan ?? 180} bars)`;
    if (parent?.type === 'SUPERTREND') return `Supertrend Line (${(parent.params as any).period ?? 10}, ${(parent.params as any).multiplier ?? 3}x)`;
    return `MACD Line (${(parent?.params as any)?.fastPeriod || 12}, ${(parent?.params as any)?.slowPeriod || 26})`;
  }
  if (indId.endsWith('_signal')) {
    const parentId = indId.replace('_signal', '');
    const parent = indicators.find(i => i.id === parentId);
    return `MACD Signal Line (${parent?.params?.signalPeriod || 9})`;
  }
  if (indId.endsWith('_hist')) {
    const parentId = indId.replace('_hist', '');
    return `MACD Histogram`;
  }

  const ind = indicators.find(i => i.id === indId);
  if (!ind) return indId;

  switch (ind.type) {
    case 'SMA':
      return `SMA (${ind.params.period || 20})`;
    case 'EMA':
      return `EMA (${ind.params.period || 20})`;
    case 'RSI':
      return `RSI (${ind.params.period || 14})`;
    case 'RSI_SMA':
      return `RSI Signal SMA (${(ind.params as any).rsiPeriod ?? 14}, ${(ind.params as any).period ?? 14})`;
    case 'RSI_TRENDLINE':
      return `RSI Falling Trendline (${(ind.params as any).rsiPeriod ?? 14}, ${(ind.params as any).minSpan ?? 30}-${(ind.params as any).maxSpan ?? 180} bars, anchor RSI ≥ ${(ind.params as any).anchorMin ?? 60})`;
    case 'PCT_ABOVE_LOW':
      return `Distance Above ${(ind.params as any).period ?? 250}-Bar Low (%)`;
    case 'PCT_CHANGE':
      return `${(ind.params as any).period ?? 126}-Bar Change (%)`;
    case 'SUPERTREND':
      return `Supertrend (${ind.params.period || 10}, ${ind.params.multiplier || 3}x)`;
    case 'ATR':
      return `ATR (${ind.params.period || 14})`;
    case 'BBANDS':
      return `Bollinger Bands (${ind.params.period || 20}, ${ind.params.stdDev || 2}σ)`;
    case 'MACD':
      return `MACD (${ind.params.fastPeriod || 12}, ${ind.params.slowPeriod || 26}, ${ind.params.signalPeriod || 9})`;
    case 'VOLUME_SMA':
      return `Volume avg ${ind.params.period || 20}d`;
    default:
      return `${ind.type} (${ind.id})`;
  }
}

const ruleValue = (value: number): string => Number(value.toFixed(2)).toLocaleString('en-IN', { maximumFractionDigits: 2 });
/** Human value formatting for scan evidence: volumes compact, prices/oscillators to 2dp. */
export function formatIndicatorValue(label: string, value: number): string {
  if (!Number.isFinite(value)) return 'N/A';
  if (/volume/i.test(label)) {
    const absolute = Math.abs(value);
    if (absolute >= 1e7) return (value / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 1 }) + ' Cr';
    if (absolute >= 1e5) return (value / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 1 }) + ' L';
  }
  return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const SOURCE_LABELS: Record<string, string> = {
  ANGEL_SMARTAPI: 'Angel One',
  YAHOO_PUBLIC_CHART: 'Yahoo public daily',
  DETERMINISTIC_DEMO_V1: 'Stragy demo',
  DEMO_MODEL: 'Stragy demo',
  PROVENANCE_PER_SYMBOL: 'Per-symbol provenance',
};
const FRESHNESS_LABELS: Record<string, string> = {
  'last-completed-session': 'last completed session',
  'fixed-demo': 'fixed demo',
  'end-of-day': 'end of day',
  'stale-observation': 'stale observed data',
  'cached-observation': 'cached observed data',
};
export function humanSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/_/g, ' ').toLowerCase().replace(/^./, character => character.toUpperCase());
}
export function humanFreshnessLabel(freshness: string): string {
  return FRESHNESS_LABELS[freshness] ?? freshness.replace(/[-_]/g, ' ');
}
function businessSessionsBetween(from: string, to: string): number {
  const start = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) return 0;
  let sessions = 0;
  for (let day = new Date(start); day < end;) {
    day.setUTCDate(day.getUTCDate() + 1);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) sessions++;
  }
  return sessions;
}
/**
 * The visible freshness must agree with the date beside it. A data row older than
 * the scan's latest observation is described in completed-session terms; a row at
 * that same latest date is never called stale merely because its HTTP fetch was cached.
 */
export function humanObservationFreshness(freshness: string, lastDate: string, latestObservedDate?: string): string {
  if (latestObservedDate && lastDate < latestObservedDate) {
    const sessions = businessSessionsBetween(lastDate, latestObservedDate);
    if (sessions > 0) return `last bar ${sessions} session${sessions === 1 ? '' : 's'} old`;
  }
  if (freshness === 'stale-observation') return 'last completed session';
  return humanFreshnessLabel(freshness);
}

const UNMATCHED_VERBS: Record<string, string> = {
  lt: 'has not dropped below',
  lte: 'has not moved to or below',
  gt: 'has not risen above',
  gte: 'has not moved to or above',
  eq: 'is not yet equal to',
  approxEq: 'is not yet approximately equal to',
  crossesAbove: 'has not yet crossed above',
  crossesBelow: 'has not yet crossed below',
};

/** Plain-language reason a near-match is missing one screen condition. */
export function describeUnmatchedRule(rule: RuleNode, indicators: IndicatorConfig[], currentLeft?: number | null, currentRight?: number | null): string {
  const left = getIndicatorLabel(rule.leftIndicator, indicators);
  const right = rule.rightIndicator
    ? getIndicatorLabel(rule.rightIndicator, indicators)
    : rule.rightValue !== undefined
      ? ruleValue(rule.rightValue)
      : '';
  const verb = UNMATCHED_VERBS[rule.operator] ?? 'does not yet satisfy';
  const lookback = rule.lookback ? ` within the preceding ${rule.lookback.bars} completed bars` : '';
  const current = currentLeft === null
    ? ' (current value unavailable)'
    : typeof currentLeft === 'number' && Number.isFinite(currentLeft) ? ` (now ${ruleValue(currentLeft)})` : '';
  void currentRight;
  return `${left} ${verb} ${right} yet${lookback}${current}.`;
}

export function formatOperator(op: string): string {
  switch (op) {
    case 'gt': return 'is greater than';
    case 'lt': return 'is less than';
    case 'gte': return 'is greater than or equal to';
    case 'lte': return 'is less than or equal to';
    case 'eq': return 'equals';
    case 'crossesAbove': return 'crosses above';
    case 'crossesBelow': return 'crosses below';
    default: return op;
  }
}

export function renderRuleInPlainLanguage(rule: RuleNode, indicators: IndicatorConfig[]): string {
  const left = rule.leftValue !== undefined ? String(rule.leftValue) : getIndicatorLabel(rule.leftIndicator, indicators);
  const op = formatOperator(rule.operator);
  let right = '';

  if (rule.rightIndicator) {
    right = getIndicatorLabel(rule.rightIndicator, indicators);
  } else if (rule.rightValue !== undefined) {
    right = `${rule.rightValue}`;
  }

  const comparison = rule.operator === 'approxEq' ? `${left} approximately equals ${right} (absolute difference < ${rule.absoluteTolerance})` : `${left} ${op} ${right}`;
  return rule.lookback ? `${comparison} on at least one of the preceding ${rule.lookback.bars} completed bars (excluding the current bar)` : comparison;
}

export function renderStrategyInPlainLanguage(strategy: StrategyAST): {
  overview: string;
  entrySummary: string[];
  exitSummary: string[];
  riskSummary: string;
  costSummary: string;
} {
  const entrySummary = strategy.rules.entry.map(r => renderRuleInPlainLanguage(r, strategy.indicators));
  const exitSummary = strategy.rules.exit.length > 0
    ? strategy.rules.exit.map(r => renderRuleInPlainLanguage(r, strategy.indicators))
    : ['Exits purely on risk controls (Stop Loss / Take Profit / Trailing Stop)'];

  let riskParts: string[] = [];
  if (strategy.risk.stopLoss) {
    riskParts.push(`Stop Loss: ${strategy.risk.stopLoss.value}${strategy.risk.stopLoss.type === 'percent' ? '%' : ' ' + strategy.risk.stopLoss.type}`);
  }
  if (strategy.risk.takeProfit) {
    riskParts.push(`Take Profit: ${strategy.risk.takeProfit.value}${strategy.risk.takeProfit.type === 'percent' ? '%' : ' ' + strategy.risk.takeProfit.type}`);
  }
  if (strategy.risk.trailingStop) {
    riskParts.push(`Trailing Stop: ${strategy.risk.trailingStop.value}${strategy.risk.trailingStop.type === 'percent' ? '%' : ' ' + strategy.risk.trailingStop.type}`);
  }
  if (strategy.risk.maxDrawdownCutoff) {
    riskParts.push(`Max Drawdown Circuit Breaker: ${strategy.risk.maxDrawdownCutoff}%`);
  }

  const riskSummary = riskParts.join(' • ');

  const costSummary = `${strategy.costs.tradeType} mode • ${strategy.costs.slippageBps} bps slippage • ₹${strategy.costs.brokerageFlat} flat brokerage ${strategy.costs.applyIndianTaxes ? '(+ STT, GST, Exchange & Stamp Duty)' : ''}`;

  return {
    overview: `${strategy.name} operates on ${strategy.universe.timeframe} timeframe with ${strategy.indicators.length} technical indicators and ${strategy.rules.entry.length} entry conditions.`,
    entrySummary,
    exitSummary,
    riskSummary,
    costSummary
  };
}
