import { z } from 'zod';
import type { StrategyAST, RuleNode } from './types';
import { IndicatorV2Schema, IndicatorTypeSchema, RESERVED_SERIES, legacyOutputNames } from './registry';
import { StrategyV2Schema, type StrategyV2, type Operand, type RuleV2, canonicalStrategyJSON, RuleLookbackSchema, InstrumentMetadataSchema, legacySymbolId } from '../contracts/strategy-v2';
export { IndicatorTypeSchema, StrategyV2Schema, canonicalStrategyJSON };

const finite = z.number().finite();
const positive = finite.positive();
export const PriceFieldSchema = z.enum(['open', 'high', 'low', 'close', 'volume', 'candleBody', 'upperWick', 'lowerWick']);
export const RuleOperatorSchema = z.enum(['gt', 'lt', 'gte', 'lte', 'eq', 'approxEq', 'crossesAbove', 'crossesBelow']);
export const IndicatorConfigSchema = IndicatorV2Schema;
export const RuleNodeSchema = z.object({
  lookback: RuleLookbackSchema.optional(),
  id: z.string().optional(), leftIndicator: z.string().min(1), leftValue: finite.optional(),
  operator: RuleOperatorSchema, rightIndicator: z.string().min(1).optional(), rightValue: finite.optional(),
  absoluteTolerance: positive.optional(), equality: z.literal('exact').optional(),
}).strict().superRefine((r, c) => {
  if ((r.rightIndicator !== undefined) === (r.rightValue !== undefined)) c.addIssue({ code: 'custom', message: 'Exactly one right operand is required' });
  if (r.operator === 'approxEq' && r.absoluteTolerance === undefined) c.addIssue({ code: 'custom', message: 'Approximate equality requires absoluteTolerance' });
});
const stopBase = z.object({ type: z.enum(['percent', 'points', 'atr']), value: positive, atrPeriod: z.number().int().min(1).max(10000).optional() }).strict();
const stop = stopBase.refine(r => r.type !== 'percent' || r.value <= 100, 'Percent stop exceeds 100');
export const RiskControlsSchema = z.object({
  stopLoss: stop,
  takeProfit: z.object({ type: z.enum(['percent', 'points', 'rr']), value: positive }).strict().nullable(),
  trailingStop: stopBase.extend({ activation: finite.nonnegative().optional() }).refine(r => r.type !== 'percent' || r.value <= 100, 'Percent trail exceeds 100').nullable(),
  positionSizing: z.discriminatedUnion('type', [
    z.object({ type: z.literal('fixedFraction'), fraction: positive.max(1) }).strict(),
    z.object({ type: z.literal('fixedQty'), quantity: positive }).strict(),
    z.object({ type: z.literal('fixedRisk'), riskPerTrade: positive.max(1) }).strict(),
  ]),
  maxDrawdownCutoff: positive.max(100).nullable().optional(),
}).strict();
export const ExecutionConfigSchema = z.object({
  allowLong: z.boolean(), allowShort: z.boolean(), orderType: z.enum(['MARKET', 'LIMIT']),
  intradaySquareOffTime: z.string().optional(), liquidateAtEnd: z.boolean().optional(),
  executionPolicy: z.literal('next_open_long_cash_v1').optional(),
}).strict();
export const CostModelConfigSchema = z.object({
  slippageBps: finite.min(0).max(100), brokerageFlat: finite.min(0).max(1e6),
  tradeType: z.enum(['DELIVERY', 'INTRADAY']), applyIndianTaxes: z.boolean(),
}).strict();
export const StrategyUniverseSchema = z.object({
  symbolId: z.number().int().positive().safe(), instrumentId: z.string().min(1).optional(), ticker: z.string().optional(),
  metadata: InstrumentMetadataSchema.optional(),
  timeframe: z.enum(['1m', '5m', '15m', '1H', '1D', '1W']),
}).strict().superRefine((u, ctx) => {
  if (u.instrumentId === undefined) return;
  try {
    if (legacySymbolId(u.instrumentId) !== u.symbolId) ctx.addIssue({ code: 'custom', path: ['symbolId'], message: 'Conflicting instrumentId and symbolId' });
  } catch (e) { ctx.addIssue({ code: 'custom', path: ['instrumentId'], message: (e as Error).message }); }
});
export const StrategySchema = z.object({
  id: z.string().optional(), name: z.string().trim().min(1).max(200), description: z.string().max(10000).optional(),
  version: z.number().int().positive(), universe: StrategyUniverseSchema,
  indicators: z.array(IndicatorConfigSchema).max(100),
  rules: z.object({ entry: z.array(RuleNodeSchema).min(1).max(100), exit: z.array(RuleNodeSchema).max(100) }).strict(),
  risk: RiskControlsSchema, execution: ExecutionConfigSchema, costs: CostModelConfigSchema,
}).strict().superRefine((s, c) => {
  const names = new Set<string>(RESERVED_SERIES), ids = new Set<string>();
  const fail = (p: (string | number)[], message: string) => c.addIssue({ code: 'custom', path: p, message });
  s.indicators.forEach((i, n) => {
    if (ids.has(i.id)) fail(['indicators', n, 'id'], 'Duplicate ID');
    ids.add(i.id);
    for (const name of Object.keys(legacyOutputNames(i))) {
      if (names.has(name)) fail(['indicators', n, 'id'], 'Output/reserved namespace collision: ' + name);
      names.add(name);
    }
  });
  for (const g of ['entry', 'exit'] as const) s.rules[g].forEach((r, n) => {
    if (r.leftValue === undefined && !names.has(r.leftIndicator)) fail(['rules', g, n, 'leftIndicator'], 'Unknown reference: ' + r.leftIndicator);
    if (r.rightIndicator && !names.has(r.rightIndicator)) fail(['rules', g, n, 'rightIndicator'], 'Unknown reference: ' + r.rightIndicator);
  });
});
function errors(e: z.ZodError) { return e.issues.map(i => i.path.join('.') + ': ' + i.message); }
function aliases(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const copy = JSON.parse(JSON.stringify(raw));
  if (Array.isArray(copy.indicators)) for (const i of copy.indicators) {
    if (i?.type !== 'MACD' || !i.params || typeof i.params !== 'object') continue;
    for (const [a, b] of [['fast', 'fastPeriod'], ['slow', 'slowPeriod'], ['signal', 'signalPeriod']]) {
      if (i.params[a] === undefined) continue;
      if (i.params[b] !== undefined && i.params[b] !== i.params[a]) throw new Error('Conflicting MACD aliases: ' + a);
      i.params[b] = i.params[a]; delete i.params[a];
    }
  }
  return copy;
}
function operand(name: string, indicators: StrategyAST['indicators'], value?: number): Operand {
  if (value !== undefined) return { kind: 'constant', value };
  if ((RESERVED_SERIES as readonly string[]).includes(name)) {
    if (name === 'candleBody' || name === 'upperWick' || name === 'lowerWick') return { kind: 'candle', field: name === 'candleBody' ? 'body' : name };
    return { kind: 'price', field: name as 'close' };
  }
  for (const i of indicators) { const output = legacyOutputNames(i)[name]; if (output) return { kind: 'indicator', indicatorId: i.id, output }; }
  throw new Error('Unknown reference: ' + name);
}
function operandName(o: Operand, indicators: StrategyV2['indicators']): string {
  if (o.kind === 'constant') return '__constant';
  if (o.kind === 'price') return o.field;
  if (o.kind === 'candle') return o.field === 'body' ? 'candleBody' : o.field;
  const i = indicators.find(i => i.id === o.indicatorId);
  if (!i) throw new Error('Unknown indicator');
  const found = Object.entries(legacyOutputNames(i)).find(([, value]) => value === o.output);
  if (!found) throw new Error('Unknown indicator output');
  return found[0];
}
export function migrateLegacyStrategy(raw: unknown) {
  try {
    const p = StrategySchema.safeParse(aliases(raw));
    if (!p.success) return { success: false as const, errors: errors(p.error), warnings: [] as string[] };
    const s = p.data as StrategyAST;
    const warnings = ['Legacy allocation fractions converted to percentages; AND entry/exit behavior preserved.'];
    if (s.risk.positionSizing.type === 'fixedRisk' && s.version < 2) return { success: false as const, errors: ['Legacy fixedRisk was not implemented; choose explicit v2 riskPct.'], warnings: ['Legacy fixedRisk migration cannot claim behavioral equivalence.'] };
    if (!s.execution.allowLong || s.execution.allowShort || s.execution.orderType !== 'MARKET' || s.execution.intradaySquareOffTime) return { success: false as const, errors: ['Only long cash-funded market orders without square-off are supported.'], warnings };
    const rule = (r: RuleNode): RuleV2 => ({
      ...(r.id ? { id: r.id } : {}), ...(r.lookback ? { lookback: { ...r.lookback } } : {}), left: operand(r.leftIndicator, s.indicators, r.leftValue),
      right: r.rightIndicator ? operand(r.rightIndicator, s.indicators) : { kind: 'constant', value: r.rightValue! },
      operator: r.operator === 'eq' && r.equality !== 'exact' ? 'approxEq' : r.operator,
      ...(r.operator === 'eq' && r.equality !== 'exact' || r.operator === 'approxEq' ? { absoluteTolerance: r.absoluteTolerance ?? 0.0001 } : {}),
    }) as RuleV2;
    const withATR = <T extends { type: string; atrPeriod?: number }>(r: T | null) => r?.type === 'atr' ? { ...r, atrPeriod: r.atrPeriod ?? 14 } : r;
    if (s.risk.stopLoss.type === 'atr' || s.risk.trailingStop?.type === 'atr') warnings.push('Risk ATR period explicitly set to 14 when absent in legacy input.');
    const sizing = s.risk.positionSizing;
    const v = {
      schemaVersion: 2, revision: s.version, id: s.id, name: s.name, description: s.description,
      universe: { ...s.universe, instrumentId: s.universe.instrumentId ?? 'legacy:' + s.universe.symbolId }, indicators: s.indicators,
      rules: { entry: { all: s.rules.entry.map(rule) }, exit: { all: s.rules.exit.map(rule) } },
      risk: { ...s.risk, stopLoss: withATR(s.risk.stopLoss), trailingStop: withATR(s.risk.trailingStop), positionSizing: sizing.type === 'fixedFraction' ? { type: sizing.type, allocationPct: sizing.fraction! * 100 } : sizing.type === 'fixedRisk' ? { type: sizing.type, riskPct: sizing.riskPerTrade! * 100 } : sizing },
      execution: { allowLong: true, allowShort: false, orderType: 'MARKET', executionPolicy: 'next_open_long_cash_v1', liquidateAtEnd: s.execution.liquidateAtEnd ?? true }, costs: s.costs,
    };
    const vp = StrategyV2Schema.safeParse(v);
    return vp.success ? { success: true as const, data: vp.data, warnings } : { success: false as const, errors: errors(vp.error), warnings };
  } catch (e) { return { success: false as const, errors: [e instanceof Error ? e.message : 'Invalid legacy strategy'], warnings: [] as string[] }; }
}
export function readStrategy(raw: unknown) {
  if (raw && typeof raw === 'object' && 'schemaVersion' in raw) {
    const p = StrategyV2Schema.safeParse(raw);
    return p.success ? { success: true as const, data: p.data, warnings: [] as string[] } : { success: false as const, errors: errors(p.error), warnings: [] as string[] };
  }
  return migrateLegacyStrategy(raw);
}
export function toLegacyStrategy(v: StrategyV2): StrategyAST {
  const s = StrategyV2Schema.parse(v);
  const id = legacySymbolId(s.universe.instrumentId);
  const rule = (r: RuleV2): RuleNode => ({
    id: r.id, ...(r.lookback ? { lookback: { ...r.lookback } } : {}), leftIndicator: operandName(r.left, s.indicators), ...(r.left.kind === 'constant' ? { leftValue: r.left.value } : {}),
    operator: r.operator, ...(r.operator === 'eq' ? { equality: 'exact' as const } : {}), ...(r.right.kind === 'constant' ? { rightValue: r.right.value } : { rightIndicator: operandName(r.right, s.indicators) }),
    ...(r.operator === 'approxEq' ? { absoluteTolerance: r.absoluteTolerance } : {}),
  });
  const sizing = s.risk.positionSizing;
  return {
    id: s.id, name: s.name, description: s.description, version: Math.max(2, s.revision),
    universe: { ...s.universe, symbolId: id }, indicators: s.indicators,
    rules: { entry: s.rules.entry.all.map(rule), exit: s.rules.exit.all.map(rule) },
    risk: { ...s.risk, positionSizing: sizing.type === 'fixedFraction' ? { type: sizing.type, fraction: sizing.allocationPct / 100 } : sizing.type === 'fixedRisk' ? { type: sizing.type, riskPerTrade: sizing.riskPct / 100 } : sizing },
    execution: s.execution, costs: s.costs,
  };
}
export function validateStrategy(raw: unknown): { success: boolean; data?: StrategyAST; canonicalData?: StrategyV2; errors?: string[]; warnings?: string[] } {
  const r = readStrategy(raw);
  if (!r.success) return r;
  if (r.data.universe.timeframe !== '1D') return { success: false, errors: ['Only daily data is currently supported.'], warnings: r.warnings };
  try { return { success: true, data: toLegacyStrategy(r.data), canonicalData: r.data, warnings: r.warnings }; }
  catch (e) { return { success: false, errors: [(e as Error).message], warnings: r.warnings }; }
}
/** Compatibility name only. Invalid input is rejected, never semantically repaired. */
export function repairStrategyAST(raw: unknown): StrategyAST {
  const r = validateStrategy(raw);
  if (!r.success || !r.data) throw new Error(r.errors?.join('; ') ?? 'Invalid strategy');
  return JSON.parse(JSON.stringify(r.data));
}
