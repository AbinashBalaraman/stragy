import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAngelTransport, getAngelCandles, resetAngelTransportForTests } from '../../server/data/angelClient';

const API_KEY = 'test-api-key-xyz';
const NOW = Date.parse('2026-11-16T08:00:00Z');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const loginOk = () => json({ status: true, message: 'SUCCESS', errorcode: '', data: { jwtToken: 'jwt-rate-limit', refreshToken: 'r', feedToken: 'f' } });
const candlesOk = () => json({ status: true, message: 'SUCCESS', errorcode: '', data: [['2026-11-13T00:00:00+05:30', 1336.6, 1350.7, 1324, 1339.7, 13756247]] });
// Exact body Angel returns for getCandleData bursts (HTTP 403, not JSON).
const throttled = () => new Response('Access denied because of exceeding access rate', { status: 403 });

const request = (token = '2885') => getAngelCandles(
  { exchange: 'NSE', symbolToken: token, interval: 'ONE_DAY', fromDate: new Date('2026-11-01T00:00:00Z'), toDate: new Date(NOW) }
);

beforeEach(() => {
  vi.stubEnv('ANGEL_API_KEY', API_KEY);
  vi.stubEnv('ANGEL_CLIENT_CODE', 'A12345678');
  vi.stubEnv('ANGEL_PASSWORD', '9876');
  vi.stubEnv('ANGEL_TOTP_SECRET', 'JBSWY3DPEHPK3PXP');
  resetAngelTransportForTests();
  configureAngelTransport({ now: () => NOW, resetSession: true, pacing: false });
});
afterEach(() => {
  resetAngelTransportForTests();
  vi.unstubAllEnvs();
});

describe('Angel rate limiting is not an expired session', () => {
  it('retries a 403 rate-limit response once without re-logging in', async () => {
    let logins = 0;
    let candles = 0;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('loginByPassword')) { logins += 1; return loginOk(); }
      candles += 1;
      return candles === 1 ? throttled() : candlesOk();
    });
    configureAngelTransport({ fetch: fetcher as unknown as typeof fetch, pacing: false });
    await expect(request()).resolves.toHaveLength(1);
    expect(logins).toBe(1);
    expect(candles).toBe(2);
  });

  it('survives two consecutive throttle responses without refreshing the session', async () => {
    let logins = 0;
    let candles = 0;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('loginByPassword')) { logins += 1; return loginOk(); }
      candles += 1;
      return candles <= 2 ? throttled() : candlesOk();
    });
    configureAngelTransport({ fetch: fetcher as unknown as typeof fetch, pacing: false });
    await expect(request()).resolves.toHaveLength(1);
    expect(logins).toBe(1);
    expect(candles).toBe(3);
  });

  it('keeps the same session through a burst of throttled requests', async () => {
    let logins = 0;
    const attempts = new Map<string, number>();
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('loginByPassword')) { logins += 1; return loginOk(); }
      const body = JSON.parse(String(init?.body));
      const token = String(body.symboltoken);
      const seen = (attempts.get(token) ?? 0) + 1;
      attempts.set(token, seen);
      return seen === 1 ? throttled() : candlesOk();
    });
    configureAngelTransport({ fetch: fetcher as unknown as typeof fetch, pacing: false });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => request(String(3000 + i))));
    expect(results.every(rows => rows.length === 1)).toBe(true);
    expect(logins).toBe(1);
    expect([...attempts.values()].every(count => count === 2)).toBe(true);
  });
});
