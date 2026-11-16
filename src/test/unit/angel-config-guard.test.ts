import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../server/config';

const base = { NODE_ENV: 'production', DATA_MODE: 'real', EXPOSURE_MODE: 'public-research' } as const;

describe('market provider configuration', () => {
  it('defaults to no market provider and no live quotes', () => {
    const config = parseConfig({ NODE_ENV: 'test' });
    expect(config.MARKET_PROVIDER).toBe('none');
    expect(config.QUOTES_PROVIDER).toBe('none');
  });

  it('accepts angel for historical candles and separates the quotes provider', () => {
    expect(parseConfig({ NODE_ENV: 'test', MARKET_PROVIDER: 'angel' })).toMatchObject({ MARKET_PROVIDER: 'angel', QUOTES_PROVIDER: 'none' });
    expect(parseConfig({ NODE_ENV: 'test', MARKET_PROVIDER: 'angel', QUOTES_PROVIDER: 'angel' })).toMatchObject({ MARKET_PROVIDER: 'angel', QUOTES_PROVIDER: 'angel' });
  });

  it.each([
    ['yahoo', 'none'],
    ['yahoo', 'angel'],
    ['angel', 'none'],
    ['angel', 'angel']
  ])('allows public research with MARKET_PROVIDER=%s and QUOTES_PROVIDER=%s', (market, quotes) => {
    expect(parseConfig({ ...base, MARKET_PROVIDER: market, QUOTES_PROVIDER: quotes })).toMatchObject({ MARKET_PROVIDER: market, QUOTES_PROVIDER: quotes });
  });

  it('still requires observed real data for public research', () => {
    expect(() => parseConfig({ ...base, MARKET_PROVIDER: 'none' })).toThrow(/observed-data provider/);
    expect(() => parseConfig({ ...base, MARKET_PROVIDER: 'yahoo', DATA_MODE: 'demo' })).toThrow(/observed-data provider/);
  });

  it('rejects unknown provider enum values', () => {
    expect(() => parseConfig({ NODE_ENV: 'test', MARKET_PROVIDER: 'angelone' })).toThrow(/MARKET_PROVIDER/);
    expect(() => parseConfig({ NODE_ENV: 'test', QUOTES_PROVIDER: 'yahoo' })).toThrow(/QUOTES_PROVIDER/);
  });
});
