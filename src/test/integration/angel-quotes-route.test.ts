import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app';
import { parseConfig, type RuntimeConfig } from '../../server/config';
import { ResearchRepository } from '../../server/storage/repository';
import { configureAngelTransport, resetAngelTransportForTests } from '../../server/data/angelClient';
import { clearLiveQuoteCache, configureLiveQuotesClock } from '../../server/data/liveQuotes';
import { resetAngelInstrumentCache } from '../../server/data/angelSymbols';

const API_KEY = 'test-api-key-xyz';
const CLIENT_CODE = 'A12345678';
const PIN = '9876';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const JWT = 'synthetic-jwt-not-real';
const NOW = Date.parse('2026-11-16T08:00:00Z');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const login = () => json({ status: true, message: 'SUCCESS', errorcode: '', data: { jwtToken: JWT, refreshToken: 'r', feedToken: 'f' } });
const quotes = () => json({
  status: true, message: 'SUCCESS', errorcode: '',
  data: {
    fetched: [
      { exchange: 'NSE', symbolToken: '99926000', ltp: 25243.7, close: 25144.3, open: 25206.15, high: 25337.6, low: 25190.25, percentChange: 0.4, exchTradeTime: '01-Jan-1970 05:30:00' },
      { exchange: 'NSE', symbolToken: '2885', ltp: 1340.7, close: 1339.7, open: 1339.7, high: 1347.3, low: 1333.8, percentChange: 0.07, exchTradeTime: '16-Nov-2026 13:29:30' }
    ]
  }
});

const repositories: ResearchRepository[] = [];
const fetcherSpy = vi.fn();

beforeEach(() => {
  vi.stubEnv('ANGEL_API_KEY', API_KEY);
  vi.stubEnv('ANGEL_CLIENT_CODE', CLIENT_CODE);
  vi.stubEnv('ANGEL_PASSWORD', PIN);
  vi.stubEnv('ANGEL_TOTP_SECRET', TOTP_SECRET);
  fetcherSpy.mockReset();
  fetcherSpy.mockImplementation(async (url: string | URL | Request) => String(url).includes('loginByPassword') ? login() : quotes());
  resetAngelTransportForTests();
  resetAngelInstrumentCache();
  clearLiveQuoteCache();
  configureLiveQuotesClock(() => NOW);
  vi.stubGlobal('fetch', fetcherSpy);
});
afterEach(async () => {
  await Promise.all(repositories.splice(0).map(repository => repository.close()));
  resetAngelTransportForTests();
  resetAngelInstrumentCache();
  clearLiveQuoteCache();
  configureLiveQuotesClock();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup(overrides: Partial<RuntimeConfig> = {}) {
  const config = { ...parseConfig({ NODE_ENV: 'test', DATA_MODE: 'demo', AI_PROVIDER: 'none', STORAGE_MODE: 'ephemeral' }), ...overrides };
  const repository = await ResearchRepository.open({ maxRuns: 2 });
  repositories.push(repository);
  return createApp({ config, repository, enableVite: false });
}

describe('GET /api/v2/quotes', () => {
  it('returns an explicit unavailable payload when live quotes are disabled', async () => {
    const app = await setup({ QUOTES_PROVIDER: 'none' });
    const response = await request(app).get('/api/v2/quotes?symbolIds=1,9');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true, source: 'ANGEL_SMARTAPI', available: false, delay: 'unknown', configured: true,
      reason: { code: 'PROVIDER_UNAVAILABLE' }, quotes: []
    });
    expect(response.body.labels).toEqual([
      { symbolId: 1, ticker: '^NSEI', name: 'NIFTY 50 Benchmark Index', exchange: 'NSE' },
      { symbolId: 9, ticker: 'RELIANCE', name: 'Reliance Industries Ltd.', exchange: 'NSE' }
    ]);
    expect(fetcherSpy).not.toHaveBeenCalled();
  });

  it('validates count, format and catalog membership', async () => {
    const app = await setup();
    const tooMany = await request(app).get('/api/v2/quotes?symbolIds=' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].join(','));
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.code).toBe('VALIDATION_FAILED');
    const malformed = await request(app).get('/api/v2/quotes?symbolIds=1,abc');
    expect(malformed.status).toBe(422);
    expect(malformed.body.error.code).toBe('VALIDATION_FAILED');
    const unknown = await request(app).get('/api/v2/quotes?symbolIds=999999');
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.code).toBe('UNKNOWN_SYMBOL');
    const missing = await request(app).get('/api/v2/quotes');
    expect(missing.status).toBe(422);
  });

  it('serves live Angel quotes through the configured provider without leaking secrets', async () => {
    const app = await setup({ QUOTES_PROVIDER: 'angel' });
    configureAngelTransport({ fetch: fetcherSpy as unknown as typeof fetch, now: () => NOW, resetSession: true });
    const response = await request(app).get('/api/v2/quotes?symbolIds=1,9');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, source: 'ANGEL_SMARTAPI', available: true, configured: true });
    expect(response.body.quotes).toHaveLength(2);
    expect(response.body.quotes[1]).toMatchObject({ symbolId: 9, ticker: 'RELIANCE', ltp: 1340.7, close: 1339.7, changePercent: 0.07, delay: 'live', source: 'ANGEL_SMARTAPI' });
    expect(response.body.quotes[0]).toMatchObject({ symbolId: 1, ticker: '^NSEI', delay: 'unknown', exchangeTimestamp: null });
    const text = JSON.stringify(response.body);
    for (const secret of [API_KEY, CLIENT_CODE, PIN, TOTP_SECRET, JWT]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/jwtToken|refreshToken|feedToken/i);
  });
});

describe('GET /api/smartapi/status', () => {
  it('is observational, reports unverified credentials and exposes no secrets', async () => {
    const app = await setup({ QUOTES_PROVIDER: 'angel' });
    const response = await request(app).get('/api/smartapi/status');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true, configured: true, connected: false, authStatus: 'UNVERIFIED', latencyMs: null,
      activeSymbolsTracked: 0, quoteProvider: 'angel', streamState: 'READ_ONLY_REST',
      capabilities: { liveQuotes: true, historicalCandles: false, orders: false, streaming: false },
      credentials: { envSource: 'ANGEL', missing: [] }
    });
    expect(fetcherSpy).not.toHaveBeenCalled();
    const text = JSON.stringify(response.body);
    for (const secret of [API_KEY, CLIENT_CODE, PIN, TOTP_SECRET, JWT]) expect(text).not.toContain(secret);
    expect(response.body).not.toHaveProperty('clientCode');
  });
});
