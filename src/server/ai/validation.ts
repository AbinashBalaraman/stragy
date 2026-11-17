import { StrategySchema, PriceFieldSchema, validateStrategy } from '../../shared/strategy/schema';
import type { IndicatorConfig, RuleNode, StrategyAST } from '../../shared/strategy/types';
import { ALL_SYMBOLS, getSymbolById } from '../data/symbols';
import { renderRuleInPlainLanguage } from '../../shared/strategy/renderPlainLanguage';

/** Bounds for untrusted text going into an AI prompt. */
export const INPUT_LIMITS = {
  maxPromptChars: 4_000,
  maxHistoryMessages: 8,
  maxHistoryMessageChars: 1_500,
  maxHistoryTotalChars: 8_000,
  maxStrategyJsonChars: 20_000,
  maxModelOutputChars: 200_000,
} as const;

const REQUIRED_TOP_LEVEL = ['name', 'version', 'universe', 'indicators', 'rules', 'risk', 'execution', 'costs'] as const;
const PRICE_FIELDS = new Set<string>(PriceFieldSchema.options as readonly string[]);

/** Remove control characters (keeps \n and \t) and cap length. */
export function sanitizeText(input: unknown, maxChars: number): string {
  const s = typeof input === 'string' ? input : '';
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, '').slice(0, maxChars);
}

export interface BoundedHistory {
  history: { role: 'user' | 'assistant'; text: string }[];
  truncated: boolean;
}

export function boundHistory(raw: unknown): BoundedHistory {
  if (!Array.isArray(raw)) return { history: [], truncated: raw !== undefined && raw !== null };
  let truncated = raw.length > INPUT_LIMITS.maxHistoryMessages;
  const out: { role: 'user' | 'assistant'; text: string }[] = [];
  let total = 0;
  const tail = raw.slice(-INPUT_LIMITS.maxHistoryMessages);
  for (let i = tail.length - 1; i >= 0; i--) {
    const h: any = tail[i];
    if (!h || typeof h !== 'object' || typeof h.text !== 'string') { truncated = true; continue; }
    const role: 'user' | 'assistant' = h.role === 'assistant' ? 'assistant' : 'user';
    let text = sanitizeText(h.text, INPUT_LIMITS.maxHistoryMessageChars);
    if (text.length < h.text.length) truncated = true;
    if (total + text.length > INPUT_LIMITS.maxHistoryTotalChars) {
      truncated = true;
      text = text.slice(0, Math.max(0, INPUT_LIMITS.maxHistoryTotalChars - total));
      if (!text) break;
    }
    total += text.length;
    out.unshift({ role, text });
  }
  return { history: out, truncated };
}

export interface StrictStrategyResult { success: boolean; data?: StrategyAST; errors?: string[] }

/**
 * Strict validation: NO repair, NO imputed defaults for missing top-level sections, NO invented rules.
 * Unknown top-level advisory keys are discarded by an explicit allowlist. Nested strategy fields remain strict; no required semantic field is invented.
 */
export function strictValidateStrategy(raw: unknown): StrictStrategyResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { success: false, errors: ['strategy: must be an object'] };
  const obj = raw as Record<string, any>;
  const errors: string[] = [];
  for (const k of REQUIRED_TOP_LEVEL) if (obj[k] === undefined || obj[k] === null) errors.push(`${k}: required`);
  if (errors.length) return { success: false, errors };

  const allowedKeys = [...REQUIRED_TOP_LEVEL, 'id', 'description', 'canonicalOrigin'];
  const candidate = Object.fromEntries(allowedKeys.filter(key => Object.prototype.hasOwnProperty.call(obj, key)).map(key => [key, obj[key]]));
  const parsed = StrategySchema.safeParse(candidate);
  if (!parsed.success) return { success: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'strategy'}: ${i.message}`) };
  const s = parsed.data as StrategyAST;

  const ids = new Set<string>();
  for (const ind of s.indicators) {
    if (ids.has(ind.id)) errors.push(`indicators: duplicate id "${ind.id}"`);
    ids.add(ind.id);
    if (PRICE_FIELDS.has(ind.id)) errors.push(`indicators: id "${ind.id}" collides with a price field`);
    for (const [k, v] of Object.entries(ind.params)) if (!Number.isFinite(v) || v <= 0) errors.push(`indicators.${ind.id}.params.${k}: must be a positive finite number`);
  }
  const known = (ref: string) => {
    if (PRICE_FIELDS.has(ref) || ids.has(ref)) return true;
    // multi-output indicators expose sub-series such as <id>_signal / <id>.upper
    return [...ids].some((id) => ref.startsWith(id + '_') || ref.startsWith(id + '.'));
  };
  (['entry', 'exit'] as const).forEach((side) => {
    s.rules[side].forEach((r, idx) => {
      if (!known(r.leftIndicator)) errors.push(`rules.${side}.${idx}.leftIndicator: unknown reference "${r.leftIndicator}"`);
      if (r.rightIndicator !== undefined && r.rightIndicator !== '' && !known(r.rightIndicator)) errors.push(`rules.${side}.${idx}.rightIndicator: unknown reference "${r.rightIndicator}"`);
      if (r.rightValue !== undefined && !Number.isFinite(r.rightValue)) errors.push(`rules.${side}.${idx}.rightValue: must be finite`);
    });
  });
  if (!ALL_SYMBOLS.some((x) => x.id === s.universe.symbolId)) errors.push(`universe.symbolId: unsupported symbol ${s.universe.symbolId}`);
  if (!s.execution.allowLong && !s.execution.allowShort) errors.push('execution: at least one of allowLong/allowShort must be true');
  if (errors.length) return { success: false, errors };
  // A draft is only valid when it can actually run through the shared executable gate:
  // daily timeframe, long-only, cash-funded MARKET orders. This does not repair or
  // normalise the draft; it only surfaces the executable contract's own errors.
  const executable = validateStrategy(s);
  if (!executable.success) return { success: false, errors: executable.errors?.length ? executable.errors : ['strategy: is not executable'] };
  return { success: true, data: s };
}

/** Extract exactly one JSON object from model text. Accepts a bare object or a single fenced block; never evaluates anything. */
export function parseModelJson(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, message: 'Empty model output.' };
  if (text.length > INPUT_LIMITS.maxModelOutputChars) return { ok: false, message: 'Model output too large.' };
  let body = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(body);
  if (fence) body = fence[1].trim();
  try {
    const v = JSON.parse(body);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, message: 'Model output was not a JSON object.' };
    return { ok: true, value: v as Record<string, unknown> };
  } catch {
    return { ok: false, message: 'Model output was not valid JSON.' };
  }
}

export interface StrategyChangeDetail {
  /** Raw strategy path for the JSON view. */
  path: string;
  before: unknown;
  after: unknown;
}

export interface StrategyChangeSet {
  /** Plain-language list for the draft card. */
  changes: string[];
  /** Raw paths and values for the JSON view. */
  details: StrategyChangeDetail[];
}

const INTERNAL_KEYS = new Set([
  'id', 'version', 'createdAt', 'updatedAt', 'canonicalOrigin', 'strategySignature',
  'instrumentId', 'metadata',
]);

const VALUE_PERCENT_PATHS = new Set([
  'risk.stopLoss.value', 'risk.takeProfit.value', 'risk.trailingStop.value',
  'risk.maxDrawdownCutoff', 'risk.positionSizing.fraction',
]);

function formatValue(value: unknown, path = ''): string {
  if (value === undefined) return 'absent';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return VALUE_PERCENT_PATHS.has(path) ? `${Number(value.toFixed(4))}%` : String(Number(value.toFixed(4)));
  }
  if (typeof value === 'string') return value;
  if (value === null) return 'none';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return JSON.stringify(value);
}

function symbolName(value: unknown): string {
  if (typeof value !== 'number') return formatValue(value);
  try { return getSymbolById(value).ticker; } catch { return `symbol ${value}`; }
}

function humanPath(path: string): string {
  const labels: Record<string, string> = {
    name: 'Name',
    description: 'Description',
    'universe.timeframe': 'Timeframe',
    'universe.symbolId': 'Symbol',
    'risk.stopLoss.type': 'Stop loss type',
    'risk.stopLoss.value': 'Stop loss',
    'risk.takeProfit.type': 'Take profit type',
    'risk.takeProfit.value': 'Take profit',
    'risk.trailingStop.type': 'Trailing stop type',
    'risk.trailingStop.value': 'Trailing stop',
    'risk.maxDrawdownCutoff': 'Max drawdown cutoff',
    'risk.positionSizing.type': 'Position sizing',
    'risk.positionSizing.fraction': 'Position size',
    'risk.positionSizing.quantity': 'Position size',
    'risk.positionSizing.riskPerTrade': 'Risk per trade',
    'execution.allowLong': 'Allow long',
    'execution.allowShort': 'Allow short',
    'execution.orderType': 'Order type',
    'costs.slippageBps': 'Slippage (bps)',
    'costs.brokerageFlat': 'Brokerage (₹)',
    'costs.tradeType': 'Trade type',
    'costs.applyIndianTaxes': 'Indian taxes',
  };
  return labels[path] ?? path.split('.').map(part => part.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')).join(' ').replace(/^./, c => c.toUpperCase());
}

function formatChange(detail: StrategyChangeDetail): string {
  const path = detail.path;
  if (path === 'universe.symbolId') return `Symbol: ${symbolName(detail.before)} → ${symbolName(detail.after)}`;
  if (path === 'name' || path === 'description') return `${humanPath(path)}: ${formatValue(detail.before)} → ${formatValue(detail.after)}`;
  return `${humanPath(path)}: ${formatValue(detail.before, path)} → ${formatValue(detail.after, path)}`;
}

function ruleLabel(rule: RuleNode, indicators: IndicatorConfig[]): string {
  try { return renderRuleInPlainLanguage(rule, indicators); } catch { return rule.leftIndicator; }
}

function ruleKey(rule: RuleNode): string {
  const copy = { ...rule } as Record<string, unknown>;
  delete copy.id;
  return JSON.stringify(copy);
}

function indicatorLabel(indicator: IndicatorConfig): string {
  const params = Object.entries(indicator.params).map(([key, value]) => `${key} ${value}`).join(', ');
  return `${indicator.type}(${params})`;
}

/**
 * Strategy changes for people, with a parallel raw-path array for the JSON view.
 * Internal identity/timestamp fields are never user-facing changes.
 */
export function describeStrategyChanges(before: unknown, after: unknown, limit = 40): StrategyChangeSet {
  const details: StrategyChangeDetail[] = [];
  const add = (path: string, oldValue: unknown, newValue: unknown) => {
    if (details.length >= limit) return;
    details.push({ path, before: oldValue, after: newValue });
  };
  const beforeStrategy = before as StrategyAST | null;
  const afterStrategy = after as StrategyAST | null;

  // Rules are compared as a set, not as internal index/ID edits.
  for (const group of ['entry', 'exit'] as const) {
    const oldRules = beforeStrategy?.rules?.[group] ?? [];
    const newRules = afterStrategy?.rules?.[group] ?? [];
    const oldKeys = new Map(oldRules.map(rule => [ruleKey(rule), rule]));
    const newKeys = new Map(newRules.map(rule => [ruleKey(rule), rule]));
    for (const [key, rule] of newKeys) if (!oldKeys.has(key)) add(`rules.${group}`, undefined, rule);
    for (const [key, rule] of oldKeys) if (!newKeys.has(key)) add(`rules.${group}`, rule, undefined);
  }

  for (const field of ['indicators'] as const) {
    const oldItems = beforeStrategy?.[field] ?? [];
    const newItems = afterStrategy?.[field] ?? [];
    const oldKeys = new Map(oldItems.map(item => [JSON.stringify({ ...item, id: undefined }), item]));
    const newKeys = new Map(newItems.map(item => [JSON.stringify({ ...item, id: undefined }), item]));
    for (const [key, item] of newKeys) if (!oldKeys.has(key)) add(field, undefined, item);
    for (const [key, item] of oldKeys) if (!newKeys.has(key)) add(field, item, undefined);
  }

  const walk = (a: any, b: any, path: string) => {
    if (details.length >= limit) return;
    if (a === b) return;
    const key = path.split('.').pop() ?? '';
    if (INTERNAL_KEYS.has(key)) return;
    if (path === 'rules.entry' || path === 'rules.exit' || path === 'indicators') return;
    const aObj = a && typeof a === 'object';
    const bObj = b && typeof b === 'object';
    if (aObj && bObj && Array.isArray(a) === Array.isArray(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) walk(a[k], b[k], path ? `${path}.${k}` : k);
      return;
    }
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    add(path || 'strategy', a, b);
  };
  walk(before, after, '');

  const changes = details.map(detail => {
    if (detail.path === 'rules.entry' || detail.path === 'rules.exit') {
      const group = detail.path.endsWith('entry') ? 'Entry' : 'Exit';
      const rules = (detail.after ?? detail.before) as RuleNode;
      const indicators = detail.after ? (afterStrategy?.indicators ?? []) : (beforeStrategy?.indicators ?? []);
      if (detail.before === undefined) return `${group}: added '${ruleLabel(rules, indicators)}'`;
      if (detail.after === undefined) return `${group}: removed '${ruleLabel(rules, indicators)}'`;
      return `${group}: changed`;
    }
    if (detail.path === 'indicators') {
      const item = (detail.after ?? detail.before) as IndicatorConfig;
      return detail.before === undefined ? `Indicator: added ${indicatorLabel(item)}` : `Indicator: removed ${indicatorLabel(item)}`;
    }
    return formatChange(detail);
  });

  return { changes, details };
}

/** Human-readable list of leaf-level differences (bounded). */
export function diffStrategies(before: unknown, after: unknown, limit = 40): string[] {
  return describeStrategyChanges(before, after, limit).changes;
}
const REASONING_MARKERS = /\b(?:schema|current_strategy|system\s+prompt|hard\s+schema|instrumentId|symbolId|previous_output|validation_errors|the\s+request\s+is|the\s+user\s+(?:wants|asked)|looking\s+at\s+the\s+(?:request|schema)|we\s+need\s+to|let\s+me\s+(?:think|see|check|look|analy[sz]e|work\s+through|reason|consider)|let['’]s\s+think|i\s+need\s+to|i\s+should|i['’]ll\s+analy[sz]e|step\s*[1-9]|first,?\s+let)\b/i;
const REASONING_START = /^(?:the\s+request|the\s+user|looking\s+at|we\s+need|first,?\s+i)\b/i;

/**
 * Model deliberation is not an answer. Detection uses internal-analysis
 * markers, not prose length or the number of first-person pronouns: a long
 * clean explanation with several "I"s is a valid answer.
 */
export function looksLikeReasoning(text: string): boolean {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return false;
  return REASONING_MARKERS.test(value) || REASONING_START.test(value);
}

export function plainRationale(text: string): string {
  return looksLikeReasoning(text)
    ? 'I prepared a draft from your request. Nothing is applied until you review and apply it.'
    : text;
}

