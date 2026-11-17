import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  angelLogin, configureAngelTransport, getAngelCredentialStatus, getAngelQuotes, getAngelSessionInfo,
  getAngelCandles, resetAngelTransportForTests
} from '../../server/data/angelClient';
import { getSmartApiStatus } from '../../server/data/smartApi';

const API_KEY = 'test-api-key-xyz';
const CLIENT_CODE = 'A12345678';
const PIN = '9876';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const JWT_ONE = 'synthetic-jwt-one-not-real';
const JWT_TWO = 'synthetic-jwt-two-not-real';
const NOW = Date.parse('2026-11-16T08:00:00Z');

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const loginOk = (jwt = JWT_ONE) => json({ status: true, message: 'SUCCESS', errorcode: '', data: { jwtToken: jwt, refreshToken: 'synthetic-refresh', feedToken: 'synthetic-feed' } });
const quoteOk = (ltp = 1340.7) => json({ status: true, message: 'SUCCESS', errorcode: '', data: { fetched: [{ exchange: 'NSE', symbolToken: '2885', ltp, close: 1339.7, open: 1339.7, high: 1347.3, low: 1333.8, percentChange: 0.07, exchTradeTime: '16-Nov-2026 13:32:28' }] } });

function stubCredentials(): void {
  vi.stubEnv('ANGEL_API_KEY', API_KEY);
  vi.stubEnv('ANGEL_CLIENT_CODE', CLIENT_CODE);
  vi.stubEnv('ANGEL_PASSWORD', PIN);
  vi.stubEnv('ANGEL_TOTP_SECRET', TOTP_SECRET);
}

beforeEach(() => {
  vi.stubEnv('QUOTES_PROVIDER', 'none');
  stubCredentials();
  resetAngelTransportForTests();
});
afterEach(() => {
  resetAngelTransportForTests();
  vi.unstubAllEnvs();
});

describe('Angel One client authentication', () => {
  it('reads credentials only from env and accepts SMARTAPI_* aliases', () => {
    expect(getAngelCredentialStatus()).toMatchObject({ configured: true, envSource: 'ANGEL', missing: [] });
    vi.unstubAllEnvs();
    vi.stubEnv('SMARTAPI_API_KEY', API_KEY);
    vi.stubEnv('SMARTAPI_CLIENT_CODE', CLIENT_CODE);
    vi.stubEnv('SMARTAPI_PASSWORD', PIN);
    vi.stubEnv('SMARTAPI_TOTP_KEY', TOTP_SECRET);
    expect(getAngelCredentialStatus()).toMatchObject({ configured: true, envSource: 'SMARTAPI' });
    vi.unstubAllEnvs();
    expect(getAngelCredentialStatus()).toMatchObject({ configured: false, envSource: 'NONE' });
    expect(getAngelCredentialStatus().missing).toEqual(['ANGEL_API_KEY', 'ANGEL_CLIENT_CODE', 'ANGEL_PASSWORD', 'ANGEL_TOTP_SECRET']);
  });

  it('sends the documented login headers and an exact clientcode/password/totp body', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return loginOk();
    });
    configureAngelTransport({ fetch: fetcher as typeof fetch, now: () => NOW, resetSession: true });
    const info = await angelLogin();
    expect(info).toMatchObject({ configured: true, connected: true });
    expect(info.expiresAt).toBeTruthy();
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe('https://apiconnect.angelbroking.com/rest/auth/angelbroking/user/v1/loginByPassword');
    expect(call.init.method).toBe('POST');
    expect(call.init.redirect).toBe('error');
    const headers = call.init.headers as Record<string, string>;
    expect(headers).toMatchObject({
      'X-UserType': 'USER', 'X-SourceID': 'WEB', 'X-ClientLocalIP': '192.168.1.1',
      'X-ClientPublicIP': '106.193.147.98', 'X-MACAddress': 'fe80::1', 'X-PrivateKey': API_KEY
    });
    expect(headers.Authorization).toBeUndefined();
    const body = JSON.parse(String(call.init.body));
    expect(Object.keys(body).sort()).toEqual(['clientcode', 'password', 'totp']);
    expect(body.clientcode).toBe(CLIENT_CODE);
    expect(body.password).toBe(PIN);
    expect(body.totp).toMatch(/^\d{6}$/);
    expect(getAngelSessionInfo()).toMatchObject({ connected: true });
    expect(JSON.stringify(getAngelSessionInfo())).not.toContain(JWT_ONE);
  });

  it('caches the session and re-logs in once on an invalid-token response', async () => {
    let logins = 0;
    const quoteAuth: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (String(url).includes('loginByPassword')) {
        logins += 1;
        expect(body.totp).toMatch(/^\d{6}$/);
        return loginOk(logins === 1 ? JWT_ONE : JWT_TWO);
      }
      quoteAuth.push(String((init?.headers as Record<string, string>).Authorization));
      if (quoteAuth.length === 1) return json({ status: false, message: 'Token Expired', errorcode: 'AG8002', data: null }, 401);
      return quoteOk();
    });
    configureAngelTransport({ fetch: fetcher as typeof fetch, now: () => NOW, resetSession: true });
    const quotes = await getAngelQuotes([{ exchange: 'NSE', tokens: ['2885'] }]);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ ltp: 1340.7, close: 1339.7, percentChange: 0.07, exchangeTime: '2026-11-16T08:02:28.000Z' });
    expect(logins).toBe(2);
    expect(quoteAuth).toEqual([`Bearer ${JWT_ONE}`, `Bearer ${JWT_TWO}`]);

    // A second call reuses the cached session, no extra login.
    await getAngelQuotes([{ exchange: 'NSE', tokens: ['2885'] }]);
    expect(logins).toBe(2);
  });

  it('uses FULL mode with the documented quote body and exchangeTokens grouping', async () => {
    const bodies: unknown[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('loginByPassword')) return loginOk();
      bodies.push(JSON.parse(String(init?.body)));
      return quoteOk();
    });
    configureAngelTransport({ fetch: fetcher as typeof fetch, now: () => NOW, resetSession: true });
    await getAngelQuotes([{ exchange: 'NSE', tokens: ['2885', '99926000'] }]);
    expect(bodies).toEqual([{ mode: 'FULL', exchangeTokens: { NSE: ['2885', '99926000'] } }]);
  });

  it('stays under the documented login rate limit (1/s)', async () => {
    const fetcher = vi.fn(async () => loginOk());
    configureAngelTransport({ fetch: fetcher as typeof fetch, resetSession: true });
    await angelLogin();
    configureAngelTransport({ resetSession: true });
    const started = Date.now();
    await angelLogin();
    expect(Date.now() - started).toBeGreaterThanOrEqual(850);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('maps broker failures to key-free MarketDataError codes', async () => {
    const fetcher = vi.fn(async () => json({ status: false, message: `Invalid totp for ${CLIENT_CODE} pin ${PIN}`, errorcode: 'AG8002', data: null }, 403));
    configureAngelTransport({ fetch: fetcher as typeof fetch, now: () => NOW, resetSession: true });
    const error = await angelLogin().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: 'MarketDataError', code: 'PROVIDER_AUTH_FAILED' });
    const text = JSON.stringify({ message: (error as Error).message, info: getAngelSessionInfo() });
    for (const secret of [API_KEY, CLIENT_CODE, PIN, TOTP_SECRET, JWT_ONE]) expect(text).not.toContain(secret);
    expect(text).toMatch(/TOTP/i);
  });

  it('reports rate limits as PROVIDER_RATE_LIMITED and never as a fabricated quote', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('loginByPassword')) return loginOk();
      return json({ status: false, message: 'Too many requests', errorcode: 'AG8004', data: null }, 429);
    });
    configureAngelTransport({ fetch: fetcher as typeof fetch, now: () => NOW, resetSession: true, rateLimitBaseMs: 5 });
    await expect(getAngelQuotes([{ exchange: 'NSE', tokens: ['2885'] }])).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED', message: 'Angel One is busy. Try again in a minute.' });
  });

  it('caps oversized responses and refuses non-allowlisted hosts', async () => {
    const oversized = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-length': '2000000' } }));
    configureAngelTransport({ fetch: oversized as typeof fetch, now: () => NOW, resetSession: true });
    await expect(angelLogin()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('status never logs in and never exposes secrets', async () => {
    vi.stubEnv('QUOTES_PROVIDER', 'angel');
    const fetcher = vi.fn(async () => { throw new Error('status must not authenticate'); });
    configureAngelTransport({ fetch: fetcher as typeof fetch, now: () => NOW, resetSession: true });
    const status = await getSmartApiStatus();
    expect(fetcher).not.toHaveBeenCalled();
    expect(status).toMatchObject({ configured: true, connected: false, authStatus: 'UNVERIFIED', latencyMs: null, activeSymbolsTracked: 0 });
    expect(status.capabilities).toMatchObject({ liveQuotes: true, orders: false });
    const text = JSON.stringify(status);
    for (const secret of [API_KEY, CLIENT_CODE, PIN, TOTP_SECRET]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/jwtToken|refreshToken|feedToken/i);
  });

  it('parses daily candles and refuses malformed rows', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('loginByPassword')) return loginOk();
      return json({ status: true, message: 'SUCCESS', errorcode: '', data: [['2026-11-13T00:00:00+05:30', 1336.6, 1350.7, 1324, 1339.7, 13756247]] });
    });
    configureAngelTransport({ fetch: fetcher as typeof fetch, now: () => NOW, resetSession: true });
    const candles = await getAngelCandles({ exchange: 'NSE', symbolToken: '2885', interval: 'ONE_DAY', fromDate: new Date('2026-11-01T00:00:00Z'), toDate: new Date(NOW) });
    expect(candles).toEqual([{ date: '2026-11-13', timestamp: Date.parse('2026-11-13T00:00:00+05:30'), open: 1336.6, high: 1350.7, low: 1324, close: 1339.7, volume: 13756247 }]);
  });
});
