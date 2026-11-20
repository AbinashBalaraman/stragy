/**
 * Movers session-label regressions (2026-11-19 review):
 *  - the session label must be the NEWEST observed date in the evaluated
 *    pool, not an arbitrary first row (trends arrive sorted by symbol id)
 *  - an empty evaluated pool is a typed null session, never a fabricated
 *    today's date
 */
import { describe, expect, it } from 'vitest';
import { calculateMarketMovers } from '../../server/data/smartApi';
import type { StockTrendData } from '../../shared/strategy/types';

const trend = (overrides: Partial<StockTrendData>): StockTrendData => ({
  id: 1, ticker: 'X', name: 'X', sector: 'Sector', exchange: 'NSE',
  date: '2026-11-18', formattedDate: '18 Nov 2026',
  ltp: 100, changePercent: 1, high: 101, low: 99, volume: 1000, volumeRatio: 1,
  rsi: 50, trendLabel: 'BULLISH', distFrom52WHigh: 10, distFrom52WLow: 10,
  oiInterpretation: 'LONG_BUILDUP', indices: [],
  ...overrides,
} as StockTrendData);

describe('movers session label', () => {
  it('uses the newest observed pool date, not the first row', () => {
    const trends = [
      trend({ id: 1, ticker: 'AAA', date: '2026-11-17', formattedDate: '17 Nov 2026' }),
      trend({ id: 2, ticker: 'BBB', date: '2026-11-19', formattedDate: '19 Nov 2026' }),
      trend({ id: 3, ticker: 'CCC', date: '2026-11-18', formattedDate: '18 Nov 2026' }),
    ];
    const movers = calculateMarketMovers(trends, 'ALL');
    expect(movers.asOfDate).toBe('2026-11-19');
    expect(movers.formattedDate).toBe('19 Nov 2026');
  });

  it('reports a null session when nothing was evaluated (no fabricated today)', () => {
    const movers = calculateMarketMovers([], 'ALL');
    expect(movers.asOfDate).toBeNull();
    expect(movers.formattedDate).toBe('');
  });

  it('keeps an explicit requested date when the pool has no dates', () => {
    const movers = calculateMarketMovers([], 'ALL', '2026-11-10');
    expect(movers.asOfDate).toBe('2026-11-10');
  });
});
