import type { RuleNode } from '../../shared/strategy/types';
export type IndicatorSeries = Record<string, (number | null)[]>;
function finite(v: number | null | undefined): v is number { return typeof v === 'number' && Number.isFinite(v); }
export function evaluateCondition(rule: RuleNode, index: number, series: IndicatorSeries): boolean {
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
/** Both legacy and v2 groups use AND. Empty exit/entry groups produce no signal. */
export function evaluateRuleSet(rules: RuleNode[], index: number, series: IndicatorSeries): boolean {
  return rules.length > 0 && rules.every(rule => evaluateCondition(rule, index, series));
}
