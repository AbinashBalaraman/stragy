import { describe, expect, it } from 'vitest';
import { ALL_SYMBOLS, UnknownSymbolError, filterSymbolsByUniverse, getSymbolById } from '../../shared/data/symbols';

describe('demo symbol catalog integrity', () => {
  it('NIFTY_50 contains only curated equities, never index tickers or generated padding', () => {
    const members = filterSymbolsByUniverse('NIFTY_50');
    expect(members.length).toBeGreaterThan(0);
    expect(members.length).toBeLessThanOrEqual(50);
    expect(members.every(s => !s.ticker.startsWith('^'))).toBe(true);
    expect(members.every(s => s.exchange === 'NSE')).toBe(true);
    expect(members.some(s => s.ticker === 'RELIANCE')).toBe(true);
    expect(members.some(s => s.ticker === '^NSEI')).toBe(false);
    // Synthetic breadth tickers are named "<TICKER> India Ltd." and must stay out of the benchmark.
    expect(members.some(s => /^[A-Z0-9&.-]+ India Ltd\.$/.test(s.name))).toBe(false);
  });

  it('labels ZOMATO as Eternal and never mentions Swiggy', () => {
    const zomato = ALL_SYMBOLS.find(s => s.ticker === 'ZOMATO');
    expect(zomato).toBeDefined();
    expect(zomato!.name).toMatch(/Eternal/i);
    expect(zomato!.name).not.toMatch(/Swiggy/i);
  });
});

describe('unknown symbol handling', () => {
  it('throws a typed UNKNOWN_SYMBOL error instead of a plain Error', () => {
    expect(() => getSymbolById(999_999)).toThrow(UnknownSymbolError);
    try {
      getSymbolById(999_999);
      throw new Error('expected unknown symbol to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownSymbolError);
      expect((error as UnknownSymbolError).code).toBe('UNKNOWN_SYMBOL');
      expect((error as Error).message).toContain('999999');
    }
  });
});
