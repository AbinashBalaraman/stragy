import { z } from 'zod';
import { IndicatorV2Schema, INDICATOR_REGISTRY, PRICE_FIELDS, CANDLE_FIELDS, RESERVED_SERIES, legacyOutputNames, periodSchema } from '../strategy/registry';

const finite = z.number().finite();
const positive = finite.positive();
const pct = positive.max(100);
export const OperandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('price'), field: z.enum(PRICE_FIELDS) }).strict(),
  z.object({ kind: z.literal('candle'), field: z.enum(CANDLE_FIELDS) }).strict(),
  z.object({ kind: z.literal('indicator'), indicatorId: z.string().min(1), output: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('constant'), value: finite }).strict(),
]);
const ruleBase = { id: z.string().min(1).optional(), left: OperandSchema, right: OperandSchema };
export const RuleV2Schema = z.union([
  z.object({ ...ruleBase, operator: z.enum(['gt','lt','gte','lte','eq','crossesAbove','crossesBelow']) }).strict(),
  z.object({ ...ruleBase, operator: z.literal('approxEq'), absoluteTolerance: positive }).strict(),
]);
export const StopV2Schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('percent'), value: positive.max(100) }).strict(),
  z.object({ type: z.literal('points'), value: positive }).strict(),
  z.object({ type: z.literal('atr'), value: positive, atrPeriod: periodSchema }).strict(),
]);
export const TrailingStopV2Schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('percent'), value: positive.max(100), activation: finite.nonnegative().optional() }).strict(),
  z.object({ type: z.literal('points'), value: positive, activation: finite.nonnegative().optional() }).strict(),
  z.object({ type: z.literal('atr'), value: positive, atrPeriod: periodSchema, activation: finite.nonnegative().optional() }).strict(),
]);
export const TargetV2Schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('percent'), value: positive }).strict(),
  z.object({ type: z.literal('points'), value: positive }).strict(),
  z.object({ type: z.literal('rr'), value: positive }).strict(),
]);
export const SizingV2Schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fixedFraction'), allocationPct: pct }).strict(),
  z.object({ type: z.literal('fixedQty'), quantity: positive }).strict(),
  z.object({ type: z.literal('fixedRisk'), riskPct: pct }).strict(),
]);
export const ExecutionV2Schema = z.object({
  allowLong: z.literal(true), allowShort: z.literal(false), orderType: z.literal('MARKET'),
  executionPolicy: z.literal('next_open_long_cash_v1'), liquidateAtEnd: z.boolean(),
}).strict();
export const CostsV2Schema = z.object({ slippageBps: finite.min(0).max(100), brokerageFlat: finite.min(0), tradeType: z.enum(['DELIVERY','INTRADAY']), applyIndianTaxes: z.boolean() }).strict();
// Descriptive input only: this contract does not verify provider tradability or tick sizes.
export const InstrumentMetadataSchema = z.object({ exchange: z.enum(['NSE','BSE']), assetClass: z.literal('EQUITY'), quoteCurrency: z.literal('INR'), tickSize: positive, quantityStep: positive, tradingTimezone: z.literal('Asia/Kolkata') }).strict();
export function legacySymbolId(instrumentId: string): number {
  if (!/^legacy:[1-9]\d*$/.test(instrumentId)) throw new Error('Unsupported instrument ID: only legacy:<positive integer> mappings are supported');
  const id = Number(instrumentId.slice(7));
  if (!Number.isSafeInteger(id)) throw new Error('Unsupported instrument ID: unsafe symbol ID');
  return id;
}
export const UniverseV2Schema = z.object({
  instrumentId: z.string().min(1), symbolId: z.number().int().positive().safe().optional(), ticker: z.string().min(1).optional(),
  timeframe: z.enum(['1m','5m','15m','1H','1D','1W']),
  metadata: InstrumentMetadataSchema.optional(),
}).strict().superRefine((u, ctx) => {
  try {
    const id = legacySymbolId(u.instrumentId);
    if (u.symbolId !== undefined && u.symbolId !== id) ctx.addIssue({ code: 'custom', path: ['symbolId'], message: 'Conflicting instrumentId and symbolId' });
  } catch (e) { ctx.addIssue({ code: 'custom', path: ['instrumentId'], message: (e as Error).message }); }
});
export const StrategyV2Schema = z.object({
  schemaVersion: z.literal(2), revision: z.number().int().positive(), id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(200), description: z.string().optional(),
  universe: UniverseV2Schema, indicators: z.array(IndicatorV2Schema).max(100),
  rules: z.object({ entry: z.object({ all: z.array(RuleV2Schema).min(1).max(100) }).strict(), exit: z.object({ all: z.array(RuleV2Schema).max(100) }).strict() }).strict(),
  risk: z.object({ stopLoss: StopV2Schema, takeProfit: TargetV2Schema.nullable(), trailingStop: TrailingStopV2Schema.nullable(), positionSizing: SizingV2Schema, maxDrawdownCutoff: pct.nullable().optional() }).strict(),
  execution: ExecutionV2Schema, costs: CostsV2Schema,
}).strict().superRefine((s, ctx) => {
  const ids = new Set<string>();
  const names = new Set<string>(RESERVED_SERIES);
  const ruleIds = new Set<string>();
  const fail = (path: (string|number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  s.indicators.forEach((ind, i) => {
    if (ids.has(ind.id)) fail(['indicators',i,'id'], 'Duplicate indicator ID');
    ids.add(ind.id);
    for (const name of Object.keys(legacyOutputNames(ind))) {
      if (names.has(name)) fail(['indicators',i,'id'], 'Reserved or output namespace collision: ' + name);
      names.add(name);
    }
  });
  const unit = (o: z.infer<typeof OperandSchema>): string | undefined => {
    if (o.kind === 'constant') return undefined;
    if (o.kind === 'price') return o.field === 'volume' ? 'volume' : 'price';
    if (o.kind === 'candle') return 'price';
    const ind = s.indicators.find(i => i.id === o.indicatorId);
    return ind ? (ind.type === 'SUPERTREND' && o.output === 'direction' ? 'direction' : INDICATOR_REGISTRY[ind.type].unit) : undefined;
  };
  for (const group of ['entry','exit'] as const) s.rules[group].all.forEach((r,i) => {
    if (r.id) { if (ruleIds.has(r.id)) fail(['rules',group,'all',i,'id'],'Duplicate rule ID'); ruleIds.add(r.id); }
    for (const side of ['left','right'] as const) {
      const o = r[side]; if (o.kind !== 'indicator') continue;
      const ind = s.indicators.find(ind => ind.id === o.indicatorId);
      if (!ind) fail(['rules',group,'all',i,side], 'Unknown indicator reference: ' + o.indicatorId);
      else if (!(INDICATOR_REGISTRY[ind.type].outputs as readonly string[]).includes(o.output)) fail(['rules',group,'all',i,side,'output'], 'Unknown output: ' + o.output);
    }
    const l = unit(r.left), right = unit(r.right);
    if (l && right && l !== right) fail(['rules',group,'all',i], 'Incompatible operand units: ' + l + ' and ' + right);
  });
  const sizing = s.risk.positionSizing;
  if (sizing.type === 'fixedQty') {
    const step = s.universe.metadata?.quantityStep ?? 1;
    const units = sizing.quantity / step;
    if (!Number.isSafeInteger(Math.round(units)) || Math.abs(units - Math.round(units)) > 1e-9) fail(['risk','positionSizing','quantity'], 'Quantity must respect quantityStep ' + step + ' with a safe unit count');
  }
});
export type Operand = z.infer<typeof OperandSchema>;
export type RuleV2 = z.infer<typeof RuleV2Schema>;
export type StrategyV2 = z.infer<typeof StrategyV2Schema>;
/** Metadata presence is not verification of a provider mapping, tick grid or tradability. */
export interface ExecutableValidationContext { requireInstrumentMetadata?: boolean; supportedTimeframes?: readonly string[] }
export function validateExecutableStrategy(raw: unknown, context: ExecutableValidationContext = {}) {
  const parsed = StrategyV2Schema.safeParse(raw);
  if (!parsed.success) return { success: false as const, errors: parsed.error.issues.map(i => i.path.join('.') + ': ' + i.message) };
  const errors: string[] = [];
  if (context.requireInstrumentMetadata && !parsed.data.universe.metadata) errors.push('universe.metadata: descriptive instrument metadata is required; provider tradability and tick sizes remain unverified');
  if (context.supportedTimeframes && !context.supportedTimeframes.includes(parsed.data.universe.timeframe)) errors.push('universe.timeframe: source does not support requested timeframe');
  return errors.length ? { success: false as const, errors } : { success: true as const, data: parsed.data };
}
/** Canonical JSON: lexicographic keys, array order retained. Hash with SHA-256 over UTF-8. */
export function canonicalStrategyJSON(raw: unknown): string {
  const data = StrategyV2Schema.parse(raw);
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([,value]) => value !== undefined).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,value]) => [k,sort(value)])) : v;
  return JSON.stringify(sort(data));
}
