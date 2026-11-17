import type { RuleNode, StrategyAST } from '../../shared/strategy/types';

/**
 * Deterministic overrides for numbers the user typed explicitly.
 *
 * A model draft (or a template default) must never replace a stop, target,
 * trailing stop, RSI level or moving-average period that the request stated.
 * This module only reads literal numbers from the request; it never guesses a
 * value and never invents an indicator.
 */

type DistanceType = 'percent' | 'points' | 'atr';
type TakeProfitType = 'percent' | 'points' | 'rr';

interface Distance {
  value: number;
  type: DistanceType;
  text: string;
}

interface TakeProfit {
  value: number;
  type: TakeProfitType;
  text: string;
}

interface RsiLevel {
  direction: 'below' | 'above';
  value: number;
  text: string;
}

interface RsiPeriod {
  value: number;
  text: string;
}

interface MaPeriod {
  type: 'SMA' | 'EMA';
  period: number;
  text: string;
}

export interface ExplicitNumberOptions {
  /** New drafts should not keep a model-added exit indicator the user did not name. */
  dropUnrequestedExits?: boolean;
  /** A new draft should not keep an unrequested trailing stop when a stop/target was stated. */
  clearUnrequestedTrailing?: boolean;
}

export interface ExplicitNumberResult {
  strategy: StrategyAST;
  changes: string[];
  assumptions: string[];
  matched: boolean;
  /** True when at least one exit rule was removed because the user did not request it. */
  removedExitRules: boolean;
  /** True when a stated stop, target or trailing stop replaced a draft default. */
  riskChanged: boolean;
}

const PERCENT = '(?:%|percent|per\\s*cent)';
const POINTS = '(?:points?|pts?)';
const UNIT = `(${PERCENT}|${POINTS}|atr)?`;
const NUMBER = '(\\d+(?:\\.\\d+)?)';

const TRAILING_PATTERNS = [
  new RegExp(`${NUMBER}\\s*${UNIT}\\s*(?:trailing(?:[\\s-]*stop)?|trail(?:ing)?)\\b`, 'gi'),
  new RegExp(`\\b(?:trailing(?:[\\s-]*stop)?|trail(?:ing)?)\\s*(?:at|of|=|:|is|to)?\\s*${NUMBER}\\s*${UNIT}`, 'gi'),
];

const STOP_PATTERNS = [
  new RegExp(`${NUMBER}\\s*${UNIT}\\s*(?:stop[\\s-]*loss|stoploss|\\bsl\\b)`, 'gi'),
  new RegExp(`(?:stop[\\s-]*loss|stoploss|\\bsl\\b)\\s*(?:at|of|=|:|is|to)?\\s*${NUMBER}\\s*${UNIT}`, 'gi'),
  new RegExp(`\\bstop\\b\\s*(?:at|of|=|:|is|to)?\\s*${NUMBER}\\s*(${PERCENT}|${POINTS})`, 'gi'),
];

const TARGET_PATTERNS = [
  new RegExp(`${NUMBER}\\s*${UNIT}\\s*(?:target|take[\\s-]*profit|\\btp\\b)`, 'gi'),
  new RegExp(`(?:target|take[\\s-]*profit|\\btp\\b)\\s*(?:at|of|=|:|is|to)?\\s*${NUMBER}\\s*${UNIT}`, 'gi'),
];

function unitType(unit: string | undefined, fallback: DistanceType = 'percent'): DistanceType {
  const text = (unit ?? '').toLowerCase();
  if (text === 'atr') return 'atr';
  if (/^(?:point|pt)/.test(text)) return 'points';
  if (text === '%' || text.includes('percent') || text.includes('per cent')) return 'percent';
  return fallback;
}

function validPercent(type: DistanceType, value: number): boolean {
  return type !== 'percent' || value <= 100;
}

function clone(strategy: StrategyAST): StrategyAST {
  return JSON.parse(JSON.stringify(strategy)) as StrategyAST;
}

function firstMatch(patterns: RegExp[], text: string): RegExpExecArray | null {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) return match;
  }
  return null;
}

function distanceFrom(match: RegExpExecArray, valueIndex: number, unitIndex: number): Distance | null {
  const value = Number(match[valueIndex]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const type = unitType(match[unitIndex]);
  if (!validPercent(type, value)) return null;
  return { value, type, text: match[0] };
}

function parseTrailing(text: string): Distance | null {
  for (const pattern of TRAILING_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const value = Number(match[1]);
      const unit = match[2];
      if (Number.isFinite(value) && value > 0) {
        const type = unitType(unit, 'percent');
        if (validPercent(type, value)) return { value, type, text: match[0] };
      }
    }
  }
  return null;
}

function scrubTrailing(text: string): string {
  let scrubbed = text;
  for (const pattern of TRAILING_PATTERNS) {
    pattern.lastIndex = 0;
    scrubbed = scrubbed.replace(pattern, ' ');
  }
  return scrubbed;
}

function parseStop(text: string): Distance | null {
  const match = firstMatch(STOP_PATTERNS, text);
  if (!match) return null;
  // The first two patterns put the number first; the bare "stop at 5%" pattern
  // also puts it first. The unit is always group 2.
  return distanceFrom(match, 1, 2);
}

function parseTarget(text: string): TakeProfit | null {
  const match = firstMatch(TARGET_PATTERNS, text);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2];
  // A reward:risk ratio is not a percentage. Do not treat "1:2" or "2R" as 2%.
  if (!unit && /^\s*[:x×r]/i.test(text.slice(match.index + match[0].length))) return null;
  const type = unitType(unit, 'percent');
  if (!validPercent(type, value)) return null;
  return { value, type: type === 'atr' ? 'rr' : type, text: match[0] };
}

function parseRsiLevels(text: string): RsiLevel[] {
  const out: RsiLevel[] = [];
  const pattern = /\brsi\b[^.;\n]{0,40}?(below|under|less\s+than|<|above|over|greater\s+than|>)\s*(\d{1,3})/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const direction = /below|under|less|<|^</i.test(match[1]) ? 'below' : 'above';
    const value = Number(match[2]);
    if (Number.isFinite(value) && value >= 1 && value <= 99) out.push({ direction, value, text: match[0] });
  }
  return out;
}

function parseRsiPeriods(text: string): RsiPeriod[] {
  const out: RsiPeriod[] = [];
  const pattern = /\brsi\s*\(?\s*(\d{1,3})\s*\)?/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= 2 && value <= 100 && !out.some(item => item.value === value)) {
      out.push({ value, text: match[0] });
    }
  }
  return out;
}

function parseMaPeriods(text: string): MaPeriod[] {
  const out: MaPeriod[] = [];
  const add = (type: string, period: string, label: string) => {
    const value = Number(period);
    const kind = type.toUpperCase() === 'EMA' ? 'EMA' : 'SMA';
    if (!Number.isFinite(value) || value < 2 || value > 250) return;
    if (!out.some(item => item.type === kind && item.period === value)) out.push({ type: kind, period: value, text: label });
  };
  for (const match of text.matchAll(/\b(sma|ema)\s*\(?\s*(\d{1,3})\s*\)?/gi)) add(match[1], match[2], match[0]);
  for (const match of text.matchAll(/(\d{1,3})\s*[- ]?\s*(?:day|bar|period|session)?\s*(sma|ema)\b/gi)) add(match[2], match[1], match[0]);
  return out;
}

function referencedIndicators(strategy: StrategyAST): Set<string> {
  const ids = new Set<string>();
  for (const rule of [...strategy.rules.entry, ...strategy.rules.exit]) {
    if (rule.leftIndicator) ids.add(rule.leftIndicator);
    if (rule.rightIndicator) ids.add(rule.rightIndicator);
  }
  return ids;
}

function indicatorType(strategy: StrategyAST, id: string): string | null {
  const exact = strategy.indicators.find(indicator => indicator.id === id);
  if (exact) return exact.type;
  const prefix = strategy.indicators.find(indicator => id.startsWith(indicator.id + '_'));
  return prefix?.type ?? null;
}

const TYPE_KEYWORDS: Record<string, RegExp> = {
  RSI: /\brsi\b/i,
  RSI_SMA: /\brsi\b/i,
  RSI_TRENDLINE: /\brsi\b/i,
  SMA: /\b(?:sma|simple\s+moving\s+average)\b/i,
  EMA: /\b(?:ema|exponential\s+moving\s+average)\b/i,
  SUPERTREND: /\bsupertrend\b/i,
  MACD: /\bmacd\b/i,
  BBANDS: /\bbollinger|bands?\b/i,
  ATR: /\batr|average\s+true\s+range\b/i,
  VOLUME_SMA: /\bvolume\b/i,
  HIGHEST: /\b(?:high|breakout)\b/i,
  LOWEST: /\b(?:low|breakdown)\b/i,
  PCT_CHANGE: /\b(?:change|momentum|trend)\b/i,
};

function keepRule(rule: RuleNode, strategy: StrategyAST, text: string): boolean {
  const ids = [rule.leftIndicator, rule.rightIndicator].filter((id): id is string => !!id);
  for (const id of ids) {
    const type = indicatorType(strategy, id);
    if (!type || type === 'PRICE' || type === 'CLOSE' || type === 'OPEN' || type === 'HIGH' || type === 'LOW' || type === 'VOLUME') continue;
    const keyword = TYPE_KEYWORDS[type];
    if (keyword && !keyword.test(text)) return false;
  }
  return true;
}

function percent(value: number): string {
  return `${value}%`;
}

function distanceLabel(distance: Pick<Distance, 'value' | 'type'>): string {
  if (distance.type === 'points') return `${distance.value} points`;
  if (distance.type === 'atr') return `${distance.value}× ATR`;
  return percent(distance.value);
}

function targetLabel(target: TakeProfit): string {
  if (target.type === 'points') return `${target.value} points`;
  if (target.type === 'rr') return `${target.value}× the stop distance`;
  return percent(target.value);
}

function applyRsiOverrides(strategy: StrategyAST, text: string, changes: string[], assumptions: string[]): void {
  const periods = parseRsiPeriods(text);
  if (periods.length === 1) {
    const referenced = referencedIndicators(strategy);
    const rsiIndicators = strategy.indicators.filter(indicator =>
      (indicator.type === 'RSI' || indicator.type === 'RSI_SMA' || indicator.type === 'RSI_TRENDLINE') && referenced.has(indicator.id));
    for (const indicator of rsiIndicators) {
      if (indicator.params.period === periods[0].value) continue;
      indicator.params = { ...indicator.params, period: periods[0].value };
      changes.push(`RSI period ${periods[0].value} from your message.`);
      assumptions.push(`RSI period ${periods[0].value} (from your message).`);
    }
  }
  const levels = parseRsiLevels(text);
  for (const level of levels) {
    const operators = level.direction === 'below' ? ['lt', 'lte', 'crossesBelow'] : ['gt', 'gte', 'crossesAbove'];
    for (const rule of [...strategy.rules.entry, ...strategy.rules.exit]) {
      if (!operators.includes(rule.operator)) continue;
      const type = rule.leftIndicator ? indicatorType(strategy, rule.leftIndicator) : null;
      if (type !== 'RSI' && type !== 'RSI_SMA' && type !== 'RSI_TRENDLINE') continue;
      if (rule.rightIndicator || rule.rightValue === level.value) continue;
      rule.rightValue = level.value;
      const label = `RSI ${level.direction} ${level.value} (from your message).`;
      changes.push(label);
      assumptions.push(label);
    }
  }
}

function applyMaOverrides(strategy: StrategyAST, text: string, changes: string[], assumptions: string[]): void {
  const mentions = parseMaPeriods(text);
  if (!mentions.length) return;
  const referenced = referencedIndicators(strategy);
  for (const type of ['SMA', 'EMA'] as const) {
    const periods = [...new Set(mentions.filter(item => item.type === type).map(item => item.period))].sort((a, b) => a - b);
    const indicators = strategy.indicators.filter(indicator => indicator.type === type && referenced.has(indicator.id));
    if (!periods.length || !indicators.length) continue;
    if (periods.length === 1) {
      // One stated period is unambiguous only when one indicator is referenced,
      // or when exactly one indicator already carries that period.
      const target = indicators.length === 1
        ? indicators[0]
        : indicators.find(indicator => indicator.params.period === periods[0]);
      if (!target || target.params.period === periods[0]) continue;
      target.params = { ...target.params, period: periods[0] };
      changes.push(`${type} period ${periods[0]} from your message.`);
      assumptions.push(`${type}(${periods[0]}) period (from your message).`);
      continue;
    }
    if (periods.length === indicators.length) {
      const sorted = [...indicators].sort((a, b) => a.params.period - b.params.period);
      sorted.forEach((indicator, index) => {
        if (indicator.params.period === periods[index]) return;
        indicator.params = { ...indicator.params, period: periods[index] };
        changes.push(`${type} period ${periods[index]} from your message.`);
        assumptions.push(`${type}(${periods[index]}) period (from your message).`);
      });
    }
  }
}

export function applyExplicitNumbers(
  input: StrategyAST,
  text: string,
  options: ExplicitNumberOptions = {},
): ExplicitNumberResult {
  const strategy = clone(input);
  const changes: string[] = [];
  const assumptions: string[] = [];
  const message = String(text ?? '');

  const trailing = parseTrailing(message);
  const withoutTrailing = scrubTrailing(message);
  const stop = parseStop(withoutTrailing);
  const target = parseTarget(withoutTrailing);

  if (stop) {
    strategy.risk = {
      ...strategy.risk,
      stopLoss: { type: stop.type, value: stop.value, ...(stop.type === 'atr' ? { atrPeriod: strategy.risk.stopLoss.atrPeriod ?? 14 } : {}) },
    };
    const label = `Stop loss: ${distanceLabel(stop)} below entry (from your message).`;
    changes.push(`Stop loss set to ${distanceLabel(stop)}.`);
    assumptions.push(label);
  }
  if (target) {
    strategy.risk = {
      ...strategy.risk,
      takeProfit: { type: target.type, value: target.value },
    };
    const label = `Target: ${targetLabel(target)} above entry (from your message).`;
    changes.push(`Take profit set to ${targetLabel(target)}.`);
    assumptions.push(label);
  }
  if (trailing) {
    strategy.risk = {
      ...strategy.risk,
      trailingStop: {
        type: trailing.type,
        value: trailing.value,
        ...(trailing.type === 'atr' ? { atrPeriod: strategy.risk.trailingStop?.atrPeriod ?? 14 } : {}),
      },
    };
    const label = `Trailing stop: ${distanceLabel(trailing)} from the high-water mark (from your message).`;
    changes.push(`Trailing stop set to ${distanceLabel(trailing)}.`);
    assumptions.push(label);
  }

  const explicitRisk = !!stop || !!target;
  const riskChanged = explicitRisk || !!trailing;
  if (options.clearUnrequestedTrailing && explicitRisk && !trailing && strategy.risk.trailingStop) {
    strategy.risk = { ...strategy.risk, trailingStop: null };
    changes.push('Removed the unrequested trailing stop.');
    assumptions.push('Trailing stop: none (not requested).');
  }

  let removedExitRules = false;
  if (options.dropUnrequestedExits && riskChanged) {
    // An exit indicator is requested only when the sentence itself asks for an
    // exit. Otherwise a target/stop is the exit plan, and model-added rules such
    // as "close below Supertrend" must not survive.
    const wantsExitRule = /\b(?:exit|sell|square[\s-]*off|book\s+profit|stop[\s-]*and[\s-]*reverse)\b/i.test(message);
    const kept = wantsExitRule ? strategy.rules.exit.filter(rule => keepRule(rule, strategy, message)) : [];
    removedExitRules = kept.length !== strategy.rules.exit.length;
    strategy.rules.exit = kept;
    if (removedExitRules) {
      changes.push('Removed an exit indicator the request did not name.');
      assumptions.push(strategy.rules.exit.length
        ? 'Exit: only the exit rules you named are kept; the rest were removed.'
        : 'Exit: no indicator exit rule; the position exits on the stop loss, target or trailing stop.');
    }
  }

  applyRsiOverrides(strategy, message, changes, assumptions);
  applyMaOverrides(strategy, message, changes, assumptions);

  const matched = changes.length > 0 || assumptions.length > 0;
  return { strategy, changes: [...new Set(changes)], assumptions: [...new Set(assumptions)], matched, removedExitRules, riskChanged };
}

/** Drops stale template risk/exit assumptions before appending the explicit ones. */
export function mergeExplicitAssumptions(existing: string[], result: ExplicitNumberResult): string[] {
  const riskReplaced = result.assumptions.some(line => /^(?:stop loss|target):/i.test(line));
  const remove = (line: string): boolean => {
    if (/^risk:/i.test(line) && riskReplaced) return true;
    if (result.removedExitRules && /^exit:\s*(?:the workspace exit rules are preserved|the opposite crossover)/i.test(line)) return true;
    return false;
  };
  return [...existing.filter(line => !remove(line)), ...result.assumptions.filter(line => !existing.includes(line))];
}
