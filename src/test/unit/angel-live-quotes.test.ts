import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLiveQuoteCache, configureLiveQuotesClock, getLiveQuotes } from '../../server/data/liveQuotes';
import { configureAngelTransport, resetAngelTransportForTests } from '../../server/data/angelClient';
import { resetAngelInstrumentCache } from '../../server/data/angelSymbols';

const API_KEY = 'test-api-key-xyz';
const CLIENT_CODE = 'A12345678';
const NOW = Date.parse('2026-11-16T08:00:00Z');
const FILLER = Array.from({ length: 1_000 }, (_, i) => ({ token: String(20000 + i), symbol: `FILL${i}-EQ`, name: `FILL${i}`, exch_seg: 'NSE' }));
const MASTER_WITHOUT_HCLTECH = JSON.stringify([{ token: '2885', symbol: 'RELIANCE-EQ', name: 'RELIANCE', exch_seg: 'NSE' }, ...FILLER]);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const login = () => json({ status: true, message: 'SUCCESS', errorcode: '', data: { jwtToken: 'synthetic-jwt', refreshToken: 'r', feedToken: 'f' } });
const quotes = () => json({
  status: true, message: 'SUCCESS', errorcode: '',
  data: {
    fetched: [
      { exchange: 'NSE', symbolToken: '99926000', ltp: 25243.7, close: 25144.3, open: 25206.15, high: 25337.6, low: 25190.25, percentChange: 0.4, exchTradeTime: '16-Nov-2026 13:29:28', tradeVolume: 0 },
      { exchange: 'NSE', symbolToken: '2885', ltp: 1340.7, close: 1339.7, open: 1339.7, high: 1347.3, low: 1333.8, percentChange: 0.07, exchTradeTime: '16-Nov-2026 13:29:30', tradeVolume: 4603417 }
    ]
  }
});

let directory: string;
beforeEach(async () => {
  vi.stubEnv('ANGEL_API_KEY', API_KEY);
  vi.stubEnv('ANGEL_CLIENT_CODE', CLIENT_CODE);
  vi.stubEnv('ANGEL_PASSWORD', '9876');
  vi.stubEnv('ANGEL_TOTP_SECRET', 'JBSWY3DPEHPK3PXP');
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'angel-quotes-test-'));
  resetAngelTransportForTests();
  resetAngelInstrumentCache();
  clearLiveQuoteCache();
  configureLiveQuotesClock(() => NOW);
});
afterEach(async () => {
  resetAngelTransportForTests();
  resetAngelInstrumentCache();
  clearLiveQuoteCache();
  configureLiveQuotesClock();
  vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('live Angel quotes', () => {
  it('returns an explicit unavailable result when QUOTES_PROVIDER is not angel', async () => {
    vi.stubEnv('QUOTES_PROVIDER', 'none');
    const fetcher = vi.fn(async () => { throw new Error('no network expected'); });
    const result = await getLiveQuotes([1, 9], { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory });
    expect(result).toMatchObject({ source: 'ANGEL_SMARTAPI', available: false, delay: 'unknown', configured: true, reason: { code: 'PROVIDER_UNAVAILABLE' } });
    expect(result.quotes).toEqual([]);
    expect(result.unavailable.map(u => u.ticker)).toEqual(['^NSEI', 'RELIANCE']);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns an explicit auth-unavailable result when credentials are absent', async () => {
    vi.stubEnv('QUOTES_PROVIDER', 'angel');
    vi.unstubAllEnvs();
    vi.stubEnv('QUOTES_PROVIDER', 'angel');
    const fetcher = vi.fn(async () => { throw new Error('no network expected'); });
    const result = await getLiveQuotes([1], { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory });
    expect(result).toMatchObject({ available: false, configured: false, reason: { code: 'PROVIDER_AUTH_FAILED' } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('parses live quotes with source, delay and exchange timestamps', async () => {
    vi.stubEnv('QUOTES_PROVIDER', 'angel');
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('loginByPassword') ? login() : quotes());
    configureAngelTransport({ fetch: fetcher as unknown as typeof fetch, now: () => NOW, resetSession: true });
    const result = await getLiveQuotes([1, 9], { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory });
    expect(result).toMatchObject({ source: 'ANGEL_SMARTAPI', available: true, delay: 'live', cached: false, configured: true });
    expect(result.quotes).toHaveLength(2);
    expect(result.quotes[0]).toMatchObject({
      symbolId: 1, ticker: '^NSEI', ltp: 25243.7, open: 25206.15, high: 25337.6, low: 25190.25,
      close: 25144.3, changePercent: 0.4, exchangeTimestamp: '2026-11-16T07:59:28.000Z',
      fetchedAt: '2026-11-16T08:00:00.000Z', source: 'ANGEL_SMARTAPI', delay: 'live'
    });
    expect(result.quotes[1]).toMatchObject({ symbolId: 9, ticker: 'RELIANCE', ltp: 1340.7, delay: 'live' });
    expect(result.unavailable).toEqual([]);
  });

  it('labels a stale exchange timestamp as unknown rather than live', async () => {
    vi.stubEnv('QUOTES_PROVIDER', 'angel');
    const stale = json({
      status: true, message: 'SUCCESS', errorcode: '',
      data: { fetched: [{ exchange: 'NSE', symbolToken: '2885', ltp: 1339.7, close: 1339.7, open: 1339.7, high: 1339.7, low: 1339.7, percentChange: 0, exchTradeTime: '13-Nov-2026 15:29:00' }] }
    });
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('loginByPassword') ? login() : stale);
    configureAngelTransport({ fetch: fetcher as unknown as typeof fetch, now: () => NOW, resetSession: true });
    const result = await getLiveQuotes([9], { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory });
    expect(result.quotes[0]).toMatchObject({ ticker: 'RELIANCE', delay: 'unknown' });
    expect(result.delay).toBe('unknown');
  });

  it('treats an epoch-zero exchange timestamp as unknown', async () => {
    vi.stubEnv('QUOTES_PROVIDER', 'angel');
    const indexQuote = json({
      status: true, message: 'SUCCESS', errorcode: '',
      data: { fetched: [{ exchange: 'NSE', symbolToken: '99926000', ltp: 25243.7, close: 25144.3, open: 25206.15, high: 25337.6, low: 25190.25, percentChange: 0.4, exchTradeTime: '01-Jan-1970 05:30:00' }] }
    });
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('loginByPassword') ? login() : indexQuote);
    configureAngelTransport({ fetch: fetcher as unknown as typeof fetch, now: () => NOW, resetSession: true });
    const result = await getLiveQuotes([1], { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory });
    expect(result.quotes[0]).toMatchObject({ exchangeTimestamp: null, delay: 'unknown' });
    expect(result.delay).toBe('unknown');
  });

  it('caches for 10 s and deduplicates concurrent identical requests', async () => {
    vi.stubEnv('QUOTES_PROVIDER', 'angel');
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('loginByPassword') ? login() : quotes());
    configureAngelTransport({ fetch: fetcher as unknown as typeof fetch, now: () => NOW, resetSession: true });
    const [a, b] = await Promise.all([
      getLiveQuotes([1, 9], { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory }),
      getLiveQuotes([1, 9], { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory })
    ]);
    expect(a.quotes).toHaveLength(2);
    expect(b.quotes).toHaveLength(2);
    const quoteCalls = fetcher.mock.calls.filter(call => String(call[0]).includes('market/v1/quote'));
    expect(quoteCalls).toHaveLength(1);
    const cached = await getLiveQuotes([1, 9], { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory });
    expect(cached).toMatchObject({ cached: true, available: true });
    expect(fetcher.mock.calls.filter(call => String(call[0]).includes('market/v1/quote'))).toHaveLength(1);
  });

  it('fails a missing mapping closed without dropping mapped symbols', async () => {
    vi.stubEnv('QUOTES_PROVIDER', 'angel');
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('OpenAPIScripMaster')) return new Response(MASTER_WITHOUT_HCLTECH, { status: 200 });
      if (String(url).includes('loginByPassword')) return login();
      return quotes();
    });
    configureAngelTransport({ fetch: fetcher as unknown as typeof fetch, now: () => NOW, resetSession: true });
    const result = await getLiveQuotes([9, 28], { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory });
    expect(result.quotes.map(q => q.ticker)).toEqual(['RELIANCE']);
    expect(result.unavailable).toEqual([{ symbolId: 28, ticker: 'HCLTECH', code: 'UNKNOWN_MAPPING', message: 'No verified Angel One token for HCLTECH' }]);
  });

  it('validates the symbol id budget', async () => {
    vi.stubEnv('QUOTES_PROVIDER', 'angel');
    await expect(getLiveQuotes([])).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(getLiveQuotes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(getLiveQuotes([0])).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('BSE segment and quote identity matching', () => {
  it('requests BSE tokens on the BSE segment and matches by exchange+token, never token alone', async () => {
    vi.stubEnv('QUOTES_PROVIDER', 'angel');
    const master = JSON.stringify([
      { token: '500325', symbol: 'RELIANCE', name: 'RELIANCE', exch_seg: 'BSE' },
      { token: '2885', symbol: 'RELIANCE-EQ', name: 'RELIANCE', exch_seg: 'NSE' },
      ...FILLER,
    ]);
    const quoteBody = {
      status: true, message: 'SUCCESS', errorcode: '',
      data: {
        fetched: [
          { exchange: 'BSE', symbolToken: '500325', ltp: 1500.5, close: 1490, open: 1495, high: 1510, low: 1480, percentChange: 0.7, exchTradeTime: '16-Nov-2026 13:29:28' },
          // Colliding NSE token: must never surface under the BSE symbol.
          { exchange: 'NSE', symbolToken: '500325', ltp: 9999, close: 9990, open: 9990, high: 9999, low: 9990, percentChange: 0.1, exchTradeTime: '16-Nov-2026 13:29:28' },
          { exchange: 'NSE', symbolToken: '2885', ltp: 1340.7, close: 1339.7, open: 1339.7, high: 1347.3, low: 1333.8, percentChange: 0.07, exchTradeTime: '16-Nov-2026 13:29:30' },
        ]
      }
    };
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('loginByPassword')) return login();
      if (u.includes('OpenAPIScripMaster')) return new Response(master, { status: 200, headers: { 'content-type': 'application/json' } });
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return json(quoteBody);
    });
    configureAngelTransport({ fetch: fetcher as unknown as typeof fetch, now: () => NOW, resetSession: true });
    // 2059 = 500325.BO (BSE), 9 = RELIANCE (NSE).
    const result = await getLiveQuotes([2059, 9], { fetch: fetcher as unknown as typeof fetch, cacheDirectory: directory });
    expect(result.available).toBe(true);
    expect(result.quotes.find(q => q.symbolId === 2059)).toMatchObject({ ticker: '500325.BO', ltp: 1500.5 });
    expect(result.quotes.find(q => q.symbolId === 9)).toMatchObject({ ticker: 'RELIANCE', ltp: 1340.7 });
    const quoteCalls = bodies.filter(b => b.exchangeTokens);
    expect(quoteCalls.some(b => {
      const t = b.exchangeTokens as Record<string, string[]>;
      return Array.isArray(t.BSE) && t.BSE.includes('500325') && !t.NSE;
    })).toBe(true);
    expect(quoteCalls.some(b => {
      const t = b.exchangeTokens as Record<string, string[]>;
      return Array.isArray(t.NSE) && t.NSE.includes('2885') && !t.BSE;
    })).toBe(true);
  });
});
