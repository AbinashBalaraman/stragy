import type { StrategyAST, OHLCVBar } from '../../shared/strategy/types';
export function strategy(): StrategyAST {
  return { name: 'Offline fixture', version: 2, universe: { symbolId: 1, timeframe: '1D' }, indicators: [], rules: { entry: [{ leftIndicator: 'volume', operator: 'eq', rightValue: 1 }], exit: [{ leftIndicator: 'volume', operator: 'eq', rightValue: 2 }] },
    risk: { stopLoss: { type: 'percent', value: 20 }, takeProfit: null, trailingStop: null, positionSizing: { type: 'fixedQty', quantity: 10 }, maxDrawdownCutoff: null }, execution: { allowLong: true, allowShort: false, orderType: 'MARKET' }, costs: { slippageBps: 0, brokerageFlat: 0, applyIndianTaxes: false, tradeType: 'DELIVERY' } };
}
/** Synthetic closed-session bars for arithmetic tests, not observed market prices. */
export function bars(values: [number, number, number, number][]): OHLCVBar[] {
  return values.map(([open, high, low, close], i) => { const timestamp = Date.UTC(2026, 0, 5 + i, 10); return { date: new Date(timestamp).toISOString().slice(0, 10), timestamp, open, high, low, close, volume: i + 1 }; });
}
