import type { IndianCostBreakdown, CostModelConfig } from '../../shared/strategy/types';
export interface ExecutedTradeLeg { price: number; quantity: number; side: 'BUY' | 'SELL'; timestamp: number; referencePrice?: number; }
export interface FeeSchedule {
  id: string; effectiveFrom: string; effectiveTo?: string; verified: boolean; sources: string[];
  buyStt: number; sellStt: number; exchangeRate: number; sebiRate: number; buyStamp: number; gstRate: number;
  brokerageRate?: number; brokerageCap?: number; brokerageFlat?: number; buyBrokerageFlat?: number; sellBrokerageFlat?: number;
}
/** Illustrative inherited rates, NOT a verified current or historical statutory schedule. */
export function approximateSchedule(config: CostModelConfig): FeeSchedule {
  return { id: 'legacy-illustrative-unverified-v1-' + config.tradeType, effectiveFrom: '1970-01-01', verified: false, sources: [],
    buyStt: config.tradeType === 'DELIVERY' ? 0.001 : 0, sellStt: config.tradeType === 'DELIVERY' ? 0.001 : 0.00025,
    exchangeRate: 0.0000345, sebiRate: 0.000001, buyStamp: config.tradeType === 'DELIVERY' ? 0.00015 : 0.00003,
    gstRate: 0.18, brokerageFlat: config.brokerageFlat };
}
export const emptyCosts = (): IndianCostBreakdown => ({ brokerage: 0, stt: 0, exchangeTxnCharges: 0, sebiCharges: 0, stampDuty: 0, gst: 0, slippage: 0, totalCharges: 0, turnover: 0 });
export function calculateFillCosts(leg: ExecutedTradeLeg, config: CostModelConfig, schedule = approximateSchedule(config)): IndianCostBreakdown {
  if (![leg.price, leg.quantity, leg.timestamp].every(Number.isFinite) || leg.price <= 0 || leg.quantity < 0) throw new Error('INVALID_FILL');
  if (leg.quantity === 0) return emptyCosts();
  const date = new Date(leg.timestamp).toISOString().slice(0, 10);
  if (date < schedule.effectiveFrom || (schedule.effectiveTo && date > schedule.effectiveTo)) throw new Error('FEE_SCHEDULE_OUT_OF_RANGE');
  for (const v of [schedule.buyStt, schedule.sellStt, schedule.exchangeRate, schedule.sebiRate, schedule.buyStamp, schedule.gstRate, schedule.brokerageFlat ?? 0, schedule.brokerageRate ?? 0]) if (!Number.isFinite(v) || v < 0) throw new Error('INVALID_FEE_SCHEDULE');
  const turnover = leg.price * leg.quantity;
  const brokerage = Math.min(schedule.brokerageCap ?? Infinity, (leg.side === 'BUY' ? schedule.buyBrokerageFlat ?? schedule.brokerageFlat ?? config.brokerageFlat : schedule.sellBrokerageFlat ?? schedule.brokerageFlat ?? config.brokerageFlat) + turnover * (schedule.brokerageRate ?? 0));
  const stt = config.applyIndianTaxes ? turnover * (leg.side === 'BUY' ? schedule.buyStt : schedule.sellStt) : 0;
  const exchangeTxnCharges = config.applyIndianTaxes ? turnover * schedule.exchangeRate : 0;
  const sebiCharges = config.applyIndianTaxes ? turnover * schedule.sebiRate : 0;
  const stampDuty = config.applyIndianTaxes && leg.side === 'BUY' ? turnover * schedule.buyStamp : 0;
  const gst = config.applyIndianTaxes ? (brokerage + exchangeTxnCharges + sebiCharges) * schedule.gstRate : 0;
  const slippage = leg.referencePrice !== undefined ? Math.abs(leg.price - leg.referencePrice) * leg.quantity : 0;
  // Slippage is already in fill prices/PnL. It is informational, not another cash debit.
  return { brokerage, stt, exchangeTxnCharges, sebiCharges, stampDuty, gst, slippage, totalCharges: brokerage + stt + exchangeTxnCharges + sebiCharges + stampDuty + gst, turnover };
}
export function aggregateCosts(legs: IndianCostBreakdown[]): IndianCostBreakdown {
  const result = emptyCosts();
  for (const leg of legs) for (const key of Object.keys(result) as (keyof IndianCostBreakdown)[]) result[key] += leg[key];
  return result;
}
/** Legacy report adapter. New simulations aggregate their actual executed-fill cost entries. */
export function calculateIndianCosts(trades: { entryPrice: number; exitPrice: number; quantity: number; entryTimestamp?: number; exitTimestamp?: number }[], config: CostModelConfig): IndianCostBreakdown {
  return aggregateCosts(trades.flatMap(t => [calculateFillCosts({ price: t.entryPrice, quantity: t.quantity, side: 'BUY', timestamp: t.entryTimestamp ?? 0 }, config), calculateFillCosts({ price: t.exitPrice, quantity: t.quantity, side: 'SELL', timestamp: t.exitTimestamp ?? 0 }, config)]));
}
