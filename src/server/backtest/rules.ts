import type { RuleNode } from '../../shared/strategy/types';
export type IndicatorSeries = Record<string, (number | null)[]>;
function finite(v: number | null | undefined): v is number { return typeof v === 'number' && Number.isFinite(v); }
function evaluateAt(rule: RuleNode, index: number, series: IndicatorSeries): boolean {
  if (!Number.isInteger(index) || index < 0) return false;
  const left = rule.leftValue ?? series[rule.leftIndicator]?.[index];
  const right = rule.rightIndicator ? series[rule.rightIndicator]?.[index] : rule.rightValue;
  if (!finite(left) || !finite(right)) return false;
  switch (rule.operator) {
    case 'gt': return left > right;
    case 'gte': return left >= right;
    case 'lt': return left < right;
    case 'lte': return left <= right;
    case 'eq': return left === right;
    case 'approxEq': return finite(rule.absoluteTolerance) && rule.absoluteTolerance > 0 && Math.abs(left - right) < rule.absoluteTolerance;
    case 'crossesAbove':
    case 'crossesBelow': {
      const previousLeft = rule.leftValue ?? series[rule.leftIndicator]?.[index - 1];
      const previousRight = rule.rightIndicator ? series[rule.rightIndicator]?.[index - 1] : rule.rightValue;
      if (!finite(previousLeft) || !finite(previousRight)) return false;
      return rule.operator === 'crossesAbove' ? previousLeft <= previousRight && left > right : previousLeft >= previousRight && left < right;
    }
    default: return false;
  }
}
export interface ConditionMatch {
  matched: boolean;
  mostRecentMatchingIndex?: number;
  mostRecentMatchingDate?: string;
}
/**
 * Shared causal predicate for scanning and simulation. index is a completed decision
 * bar; callers must exclude forming bars. A historical crossover remains an actual
 * crossover at each candidate bar (including its immediately preceding value).
 * Missing/nonfinite warmup values never satisfy a comparison.
 */
export function evaluateConditionMatch(
  rule: RuleNode, index: number, series: IndicatorSeries, bars?: readonly { date: string }[],
): ConditionMatch {
  if (!Number.isInteger(index) || index < 0) return { matched: false };
  const window = rule.lookback;
  // Also fail closed for unvalidated runtime callers.
  if (window && (!Number.isInteger(window.bars) || window.bars < 1 || window.bars > 252 || window.includeCurrent !== false || window.match !== 'any')) return { matched: false };
  const newest = window ? index - 1 : index;
  const oldest = window ? Math.max(0, index - window.bars) : index;
  for (let candidate = newest; candidate >= oldest; candidate--) {
    if (evaluateAt(rule, candidate, series)) return {
      matched: true, mostRecentMatchingIndex: candidate,
      ...(bars?.[candidate] ? { mostRecentMatchingDate: bars[candidate].date } : {}),
    };
  }
  return { matched: false };
}
export function evaluateCondition(rule: RuleNode, index: number, series: IndicatorSeries): boolean {
  return evaluateConditionMatch(rule, index, series).matched;
}
/** Both legacy and v2 groups use AND. Empty exit/entry groups produce no signal. */
export function evaluateRuleSet(rules: RuleNode[], index: number, series: IndicatorSeries): boolean {
  return rules.length > 0 && rules.every(rule => evaluateCondition(rule, index, series));
}
