import { describe, expect, it } from 'vitest';
import { detectMarketSymbols, lastCompletedSessionDate } from '../../server/ai/marketContext';

// The first-version chat that consumed the market-context renderer was removed
// in Round 12. The pure symbol/session helpers remain part of the module, so
// keep their unit coverage without any provider or network access.
describe('market symbol detection', () => {
  it('resolves Nifty/Bank Nifty aliases and caps a message at three symbols', () => {
    expect(detectMarketSymbols('what is bank nifty price?')).toEqual([2]);
    expect(detectMarketSymbols('what is the nifty 50 level?')).toEqual([1]);
    expect(detectMarketSymbols('Compare RELIANCE, HDFCBANK, TCS and INFY last price')).toEqual([9, 10, 11]);
  });
});

describe('last completed session', () => {
  it('resolves around weekends and the 15:30 IST close', () => {
    expect(lastCompletedSessionDate(new Date('2026-11-16T08:35:00.000Z'))).toBe('2026-11-13');
    expect(lastCompletedSessionDate(new Date('2026-11-16T10:30:00.000Z'))).toBe('2026-11-16');
    expect(lastCompletedSessionDate(new Date('2026-11-14T08:00:00.000Z'))).toBe('2026-11-13');
  });
});
