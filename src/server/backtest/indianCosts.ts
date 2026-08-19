import { IndianCostBreakdown, CostModelConfig } from '../../shared/strategy/types';

export interface ExecutedTradeLeg {
  price: number;
  quantity: number;
  side: 'BUY' | 'SELL';
  timestamp?: number;
}

/**
 * Calculates Indian Statutory Taxes and Execution Charges with exact regulatory schedule:
 * - STT (Securities Transaction Tax):
 *    - Delivery: 0.1% on Buy AND Sell turnover
 *    - Intraday: 0.025% on Sell turnover only
 * - Exchange Transaction Charges: 0.00345% of turnover (NSE equity)
 * - SEBI Turnover Charges: ₹10 per crore (0.0001% of turnover)
 * - Stamp Duty: 0.015% on Buy turnover
 * - GST: 18% on (Brokerage + Exchange Txn Charges + SEBI Charges)
 * - Brokerage: Flat (e.g. ₹20 per executed order leg) or capped
 * - Slippage: Basis points on entry and exit
 */
export function calculateIndianCosts(
  trades: Array<{
    entryPrice: number;
    exitPrice: number;
    quantity: number;
  }>,
  config: CostModelConfig
): IndianCostBreakdown {
  let totalTurnover = 0;
  let totalBrokerage = 0;
  let totalStt = 0;
  let totalExchangeTxn = 0;
  let totalSebi = 0;
  let totalStampDuty = 0;
  let totalGst = 0;
  let totalSlippage = 0;

  for (const trade of trades) {
    const buyTurnover = trade.entryPrice * trade.quantity;
    const sellTurnover = trade.exitPrice * trade.quantity;
    const tradeTurnover = buyTurnover + sellTurnover;
    totalTurnover += tradeTurnover;

    // Brokerage (2 legs: entry & exit)
    const tradeBrokerage = config.brokerageFlat * 2;
    totalBrokerage += tradeBrokerage;

    // Slippage (both legs)
    const slippageRate = config.slippageBps / 10000;
    const tradeSlippage = (buyTurnover + sellTurnover) * slippageRate;
    totalSlippage += tradeSlippage;

    if (config.applyIndianTaxes) {
      // STT
      if (config.tradeType === 'DELIVERY') {
        // 0.1% on buy & sell
        totalStt += (buyTurnover + sellTurnover) * 0.001;
      } else {
        // 0.025% on sell only
        totalStt += sellTurnover * 0.00025;
      }

      // Exchange Transaction Fee (0.00345%)
      const exchangeFee = tradeTurnover * 0.0000345;
      totalExchangeTxn += exchangeFee;

      // SEBI Turnover Fee (₹10 / crore = 0.000001)
      const sebiFee = tradeTurnover * 0.000001;
      totalSebi += sebiFee;

      // Stamp duty (0.015% on buy turnover)
      const stampDuty = buyTurnover * 0.00015;
      totalStampDuty += stampDuty;

      // GST (18% on Brokerage + Exchange + SEBI)
      const taxableAmount = tradeBrokerage + exchangeFee + sebiFee;
      totalGst += taxableAmount * 0.18;
    }
  }

  const totalCharges =
    totalBrokerage +
    totalStt +
    totalExchangeTxn +
    totalSebi +
    totalStampDuty +
    totalGst +
    totalSlippage;

  return {
    brokerage: Number(totalBrokerage.toFixed(2)),
    stt: Number(totalStt.toFixed(2)),
    exchangeTxnCharges: Number(totalExchangeTxn.toFixed(2)),
    sebiCharges: Number(totalSebi.toFixed(2)),
    stampDuty: Number(totalStampDuty.toFixed(2)),
    gst: Number(totalGst.toFixed(2)),
    slippage: Number(totalSlippage.toFixed(2)),
    totalCharges: Number(totalCharges.toFixed(2)),
    turnover: Number(totalTurnover.toFixed(2))
  };
}
