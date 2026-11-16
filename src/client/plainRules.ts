import { getIndicatorLabel } from '../shared/strategy/renderPlainLanguage';
import type { IndicatorConfig, RuleNode } from '../shared/strategy/types';

const OPERATOR_TEXT: Record<RuleNode['operator'], string> = {
  gt: 'above', lt: 'below', gte: 'at or above', lte: 'at or below', eq: 'equal to', approxEq: 'approximately equal to', crossesAbove: 'crosses above', crossesBelow: 'crosses below',
};

/** Readable operand: "Supertrend (10, 3)", "200-day EMA", "its 20-day average". */
export function plainOperand(input: string, indicators: IndicatorConfig[]): string {
  if (input === 'close') return 'Close';
  if (input === 'open') return 'Open';
  if (input === 'high') return 'High';
  if (input === 'low') return 'Low';
  if (input === 'volume') return 'Volume';
  if (input === 'candleBody') return 'Candle body';
  if (input === 'upperWick') return 'Upper wick';
  if (input === 'lowerWick') return 'Lower wick';
  const label = getIndicatorLabel(input, indicators);
  const ema = /^EMA \((\d+)\)$/.exec(label);
  if (ema) return `${ema[1]}-day EMA`;
  const sma = /^SMA \((\d+)\)$/.exec(label);
  if (sma) return `${sma[1]}-day SMA`;
  const volumeAverage = /^Volume avg (\d+)d$/.exec(label);
  if (volumeAverage) return `its ${volumeAverage[1]}-day average`;
  const supertrend = /^Supertrend \((\d+), ([\d.]+)x\)$/.exec(label);
  if (supertrend) return `Supertrend (${supertrend[1]}, ${supertrend[2]})`;
  const rsi = /^RSI \((\d+)\)$/.exec(label);
  if (rsi) return `${rsi[1]}-day RSI`;
  const atr = /^ATR \((\d+)\)$/.exec(label);
  if (atr) return `${atr[1]}-day ATR`;
  return label;
}

/** One rule in plain language; internal indicator ids never reach the summary. */
export function plainRule(rule: RuleNode, indicators: IndicatorConfig[]): string {
  const left = rule.leftValue !== undefined ? String(rule.leftValue) : plainOperand(rule.leftIndicator, indicators);
  const right = rule.rightIndicator ? plainOperand(rule.rightIndicator, indicators) : rule.rightValue !== undefined ? String(rule.rightValue) : '?';
  const lookback = rule.lookback ? ` within the last ${rule.lookback.bars} completed bars` : '';
  return `${left} ${OPERATOR_TEXT[rule.operator]} ${right}${lookback}`;
}
