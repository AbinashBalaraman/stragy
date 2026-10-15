import { OHLCVBar } from '../../shared/strategy/types';
import { getRealDailyBars, refreshAllRealMarketData } from './realMarketData';

/**
 * Returns authentic real-world daily OHLCV bars for backtesting and strategy evaluation
 */
export function getDailyBars(symbolId: number): OHLCVBar[] {
  return getRealDailyBars(symbolId);
}

/**
 * Generates or retrieves historical daily bars for a given symbol
 */
export function generateSymbolBars(symbolId: number, count?: number): OHLCVBar[] {
  const bars = getRealDailyBars(symbolId);
  if (count && bars.length > count) {
    return bars.slice(bars.length - count);
  }
  return bars;
}

export { refreshAllRealMarketData };
