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
    const parentId = indId.replace('_line', '');
    const parent = indicators.find(i => i.id === parentId);
    return `MACD Line (${parent?.params?.fastPeriod || 12}, ${parent?.params?.slowPeriod || 26})`;
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
    case 'SUPERTREND':
      return `Supertrend (${ind.params.period || 10}, ${ind.params.multiplier || 3}x)`;
    case 'ATR':
      return `ATR (${ind.params.period || 14})`;
    case 'BBANDS':
      return `Bollinger Bands (${ind.params.period || 20}, ${ind.params.stdDev || 2}σ)`;
    case 'MACD':
      return `MACD (${ind.params.fastPeriod || 12}, ${ind.params.slowPeriod || 26}, ${ind.params.signalPeriod || 9})`;
    default:
      return `${ind.type} (${ind.id})`;
  }
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
  const left = getIndicatorLabel(rule.leftIndicator, indicators);
  const op = formatOperator(rule.operator);
  let right = '';

  if (rule.rightIndicator) {
    right = getIndicatorLabel(rule.rightIndicator, indicators);
  } else if (rule.rightValue !== undefined) {
    right = `${rule.rightValue}`;
  }

  return `${left} ${op} ${right}`;
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
