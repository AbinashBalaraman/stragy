import { z } from 'zod';
import { NSE_SYMBOLS } from '../../shared/data/symbols';
const number = z.number().finite();
const positive = number.positive();
const nonnegative = number.nonnegative();
const text = z.string().min(1);
const provenance = z.object({ mode: z.literal('demo'), source: z.literal('DEMO_MODEL'), asOf: z.literal('2026-09-30'), assumptions: z.array(text).min(1) });
const basisProvenance = provenance.extend({ source: z.literal('DEMO_COST_OF_CARRY') });
const model = { success: z.literal(true), mode: z.literal('demo'), model: z.literal(true) };
const leg = z.object({ ltp: positive, change: number, iv: nonnegative, delta: number, gamma: number, theta: number, vega: number, oi: nonnegative, oiChange: number, volume: nonnegative, bid: nonnegative, ask: nonnegative });
export const optionChainSchema = z.object({ ...model, provenance, symbol: text, ticker: text, spotPrice: positive, expiry: text, atmStrike: positive, totalCallOI: nonnegative, totalPutOI: nonnegative, pcr: nonnegative, maxPainStrike: positive, atmIV: nonnegative, ivRank: nonnegative, strikes: z.array(z.object({ strikePrice: positive, isAtm: z.boolean(), straddlePrice: nonnegative, call: leg, put: leg })).min(1) });
export const volumeProfileSchema = z.object({ ...model, provenance, symbol: text, ticker: text, spotPrice: positive, pocPrice: positive, vahPrice: positive, valPrice: positive, vwap: positive, stdDev1Upper: positive, stdDev1Lower: positive, stdDev2Upper: positive, stdDev2Lower: positive, stdDev3Upper: positive, stdDev3Lower: positive, totalSessionVolume: positive, buyPressurePct: number.min(0).max(100), marketRegime: text, profileLevels: z.array(z.object({ price: positive, buyVol: nonnegative, sellVol: nonnegative, totalVol: nonnegative, pctOfTotal: number.min(0).max(100), isPOC: z.boolean(), inValueArea: z.boolean() })).min(1) });
export const basisSpreadsSchema = z.object({ ...model, count: nonnegative.int(), spreads: z.array(z.object({ provenance: basisProvenance, ticker: text, name: text, lotSize: positive.int(), cashLtp: positive, nearFutLtp: positive, nextFutLtp: positive, nearBasisInr: number, nearBasisPct: number, calendarSpreadInr: number, calendarSpreadPct: number, annualizedYieldPct: number, state: z.enum(['CONTANGO', 'BACKWARDATION']), arbitrageSignal: text })) }).refine(value => value.count === value.spreads.length, 'Spread count mismatch');
export const gttInputSchema = z.object({ symbolId: positive.int().refine(id => NSE_SYMBOLS.some(s => s.id === id)), action: z.enum(['BUY', 'SELL']), capitalAllocated: positive.max(1e8), riskPct: positive.max(50), rewardRatio: positive.max(20), trailPct: positive.max(50) });
export type GttInput = z.infer<typeof gttInputSchema>;
const numericString = text.refine(v => Number.isFinite(Number(v)) && Number(v) > 0);
export const gttSchema = z.object({ success: z.literal(true), mode: z.literal('demo'), previewOnly: z.literal(true), inputRevision: text, warnings: z.array(text).min(1), symbol: text, ticker: text, spotPrice: positive, action: z.enum(['BUY', 'SELL']), capitalAllocated: positive, qty: positive.int(), entryPrice: positive, stopLossPrice: positive, stopLossAmountInr: nonnegative, stopLossPct: positive, targetPrice: positive, targetAmountInr: nonnegative, targetPct: positive, trailingStopLossStep: positive, trailingJumpPct: positive, riskRewardRatio: positive, smartApiPayload: z.object({ variety: z.literal('ROBO'), tradingsymbol: text, symboltoken: text, transactiontype: z.enum(['BUY', 'SELL']), exchange: text, ordertype: z.literal('LIMIT'), producttype: z.literal('BO'), duration: z.literal('DAY'), price: numericString, squareoff: numericString, stoploss: numericString, trailingStopLoss: numericString, quantity: numericString, disclosedquantity: z.literal('0') }) });
export function parseOptionChain(value: unknown, key: string) { const result = optionChainSchema.parse(value); if (result.ticker !== key) throw new Error('Response symbol mismatch'); return result; }
export function parseVolumeProfile(value: unknown, key: string) { const result = volumeProfileSchema.parse(value); if (result.ticker !== NSE_SYMBOLS.find(s => s.id === Number(key))?.ticker) throw new Error('Response symbol mismatch'); return result; }
export function parseBasisSpreads(value: unknown) { return basisSpreadsSchema.parse(value); }
export function parseGtt(value: unknown, key: string) {
  const input = gttInputSchema.parse(JSON.parse(key)); const result = gttSchema.parse(value);
  const payload = result.smartApiPayload;
  if (result.ticker !== NSE_SYMBOLS.find(s => s.id === input.symbolId)?.ticker || result.action !== input.action || result.capitalAllocated !== input.capitalAllocated || result.stopLossPct !== input.riskPct || result.riskRewardRatio !== input.rewardRatio || result.trailingJumpPct !== input.trailPct || payload.transactiontype !== result.action || Number(payload.quantity) !== result.qty || Number(payload.price) !== result.entryPrice || Number(payload.trailingStopLoss) !== result.trailingStopLossStep) throw new Error('Preview does not match current inputs');
  if (result.action === 'BUY' ? !(result.stopLossPrice < result.entryPrice && result.entryPrice < result.targetPrice) : !(result.targetPrice < result.entryPrice && result.entryPrice < result.stopLossPrice)) throw new Error('Invalid stop/target direction');
  return result;
}
