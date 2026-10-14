import { z } from 'zod';

export const PRICE_FIELDS = ['open', 'high', 'low', 'close', 'volume'] as const;
export const CANDLE_FIELDS = ['body', 'upperWick', 'lowerWick'] as const;
export const RESERVED_SERIES = [...PRICE_FIELDS, 'candleBody', 'upperWick', 'lowerWick'] as const;
export const periodSchema = z.number().int().min(1).max(10000);
const positive = z.number().finite().positive().max(10000);
const periodParams = z.object({ period: periodSchema }).strict();
export const INDICATOR_REGISTRY = {
  SMA: { params: periodParams, defaults: { period: 20 }, outputs: ['value'], unit: 'price' },
  EMA: { params: periodParams, defaults: { period: 20 }, outputs: ['value'], unit: 'price' },
  RSI: { params: periodParams, defaults: { period: 14 }, outputs: ['value'], unit: 'oscillator' },
  ATR: { params: periodParams, defaults: { period: 14 }, outputs: ['value'], unit: 'price' },
  VOLUME_SMA: { params: periodParams, defaults: { period: 20 }, outputs: ['value'], unit: 'volume' },
  BBANDS: { params: z.object({ period: periodSchema, stdDev: positive }).strict(), defaults: { period: 20, stdDev: 2 }, outputs: ['middle', 'upper', 'lower'], unit: 'price' },
  MACD: { params: z.object({ fastPeriod: periodSchema, slowPeriod: periodSchema, signalPeriod: periodSchema }).strict().refine(p => p.fastPeriod < p.slowPeriod, 'MACD fastPeriod must be less than slowPeriod'), defaults: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }, outputs: ['line', 'signal', 'histogram'], unit: 'price' },
  SUPERTREND: { params: z.object({ period: periodSchema, multiplier: positive }).strict(), defaults: { period: 10, multiplier: 3 }, outputs: ['line', 'direction'], unit: 'price' },
} as const;
export type RegisteredIndicatorType = keyof typeof INDICATOR_REGISTRY;
export const IndicatorTypeSchema = z.enum(['SMA', 'EMA', 'RSI', 'ATR', 'VOLUME_SMA', 'BBANDS', 'MACD', 'SUPERTREND']);
export const IndicatorV2Schema = z.discriminatedUnion('type', [
  z.object({ id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), type: z.literal('SMA'), params: INDICATOR_REGISTRY.SMA.params }).strict(),
  z.object({ id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), type: z.literal('EMA'), params: INDICATOR_REGISTRY.EMA.params }).strict(),
  z.object({ id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), type: z.literal('RSI'), params: INDICATOR_REGISTRY.RSI.params }).strict(),
  z.object({ id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), type: z.literal('ATR'), params: INDICATOR_REGISTRY.ATR.params }).strict(),
  z.object({ id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), type: z.literal('VOLUME_SMA'), params: INDICATOR_REGISTRY.VOLUME_SMA.params }).strict(),
  z.object({ id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), type: z.literal('BBANDS'), params: INDICATOR_REGISTRY.BBANDS.params }).strict(),
  z.object({ id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), type: z.literal('MACD'), params: INDICATOR_REGISTRY.MACD.params }).strict(),
  z.object({ id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), type: z.literal('SUPERTREND'), params: INDICATOR_REGISTRY.SUPERTREND.params }).strict(),
]);
export type IndicatorV2 = z.infer<typeof IndicatorV2Schema>;
/** The legacy engine flattened compound outputs; retain these aliases only at the boundary. */
export function legacyOutputNames(ind: { id: string; type: RegisteredIndicatorType }): Record<string, string> {
  switch (ind.type) {
    case 'MACD': return { [ind.id]: 'line', [ind.id + '_line']: 'line', [ind.id + '_signal']: 'signal', [ind.id + '_hist']: 'histogram', [ind.id + '_histogram']: 'histogram' };
    case 'BBANDS': return { [ind.id]: 'middle', [ind.id + '_upper']: 'upper', [ind.id + '_middle']: 'middle', [ind.id + '_lower']: 'lower' };
    case 'SUPERTREND': return { [ind.id]: 'line', [ind.id + '_dir']: 'direction', [ind.id + '_direction']: 'direction', [ind.id + '_line']: 'line' };
    default: return { [ind.id]: 'value' };
  }
}
