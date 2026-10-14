import { StrategySchema, PriceFieldSchema } from '../../shared/strategy/schema';
import type { StrategyAST } from '../../shared/strategy/types';
import { ALL_SYMBOLS } from '../data/symbols';

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

  const allowedKeys = [...REQUIRED_TOP_LEVEL, 'id', 'description'];
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

/** Human-readable list of leaf-level differences (bounded). */
export function diffStrategies(before: unknown, after: unknown, limit = 40): string[] {
  const out: string[] = [];
  const walk = (a: any, b: any, path: string) => {
    if (out.length >= limit) return;
    if (a === b) return;
    const aObj = a && typeof a === 'object';
    const bObj = b && typeof b === 'object';
    if (aObj && bObj && Array.isArray(a) === Array.isArray(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) walk(a[k], b[k], path ? `${path}.${k}` : k);
      return;
    }
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    const fmt = (v: unknown) => (v === undefined ? '(absent)' : JSON.stringify(v));
    out.push(`${path || 'strategy'}: ${fmt(a)} -> ${fmt(b)}`);
  };
  walk(before, after, '');
  return out;
}
