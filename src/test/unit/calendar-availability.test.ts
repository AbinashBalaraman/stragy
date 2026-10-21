import { afterEach, describe, expect, it } from 'vitest';
import { getAvailableTradingDates, findNearestTradingDate } from '../../server/data/realMarketData';
import { getMarketSeries } from '../../server/data/marketSeries';
import { NSE_SYMBOLS } from '../../shared/data/symbols';
const originalMode = process.env.DATA_MODE;
afterEach(() => { if (originalMode === undefined) delete process.env.DATA_MODE; else process.env.DATA_MODE = originalMode; });
describe('calendar data availability', () => {
  it('lists only dataset bars and labels generated demo honestly', () => {
    process.env.DATA_MODE = 'demo';
    const bars = getMarketSeries(NSE_SYMBOLS[0].id).bars;
    const dates = getAvailableTradingDates(250);
    expect(dates.map(item => item.date)).toEqual(bars.slice(-250).reverse().map(bar => bar.date));
    expect(dates[0].fullLabel).toContain('Generated Demo Bar');
    expect(dates.filter(item => item.isLatest)).toHaveLength(1);
  });
  it('snaps future dates to the final available bar, not a later calendar session', () => {
    process.env.DATA_MODE = 'demo';
    const latest = getAvailableTradingDates(1)[0].date;
    const resolved = findNearestTradingDate('2099-01-01');
    expect(resolved.resolvedDate).toBe(latest);
    expect(resolved.isSnapped).toBe(true);
  });
  it('keeps invalid date/count errors explicit', () => {
    process.env.DATA_MODE = 'demo';
    expect(() => getAvailableTradingDates(0)).toThrow();
    expect(() => findNearestTradingDate('2026-02-31')).toThrow();
  });
});
