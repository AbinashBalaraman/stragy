import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  angelLogin, configureAngelTransport, getAngelCandles, resetAngelTransportForTests
} from '../../server/data/angelClient';

const API_KEY = 'test-api-key-xyz';
const CLIENT_CODE = 'A12345678';
const PIN = '9876';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const NOW = Date.parse('2026-11-16T08:00:00Z');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const loginOk = (jwt: string) => json({ status: true, message: 'SUCCESS', errorcode: '', data: { jwtToken: jwt, refreshToken: 'r', feedToken: 'f' } });
const candlesOk = () => json({ status: true, message: 'SUCCESS', errorcode: '', data: [['2026-11-13T00:00:00+05:30', 1336.6, 1350.7, 1324, 1339.7, 13756247]] });
const authFailure = () => json({ status: false, message: 'Token Expired', errorcode: 'AG8002', data: null }, 401);

interface Harness {
  fetcher: ReturnType<typeof vi.fn>;
  logins: () => number;
  candles: () => number;
  validJwt: () => string;
  setValidJwt: (jwt: string) => void;
}

function harness(options: { loginDelayMs?: number } = {}): Harness {
  let loginCount = 0;
  let candleCount = 0;
  let valid = '';
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes('loginByPassword')) {
      loginCount += 1;
      if (options.loginDelayMs) await new Promise(resolve => setTimeout(resolve, options.loginDelayMs));
      valid = `jwt-${loginCount}`;
      return loginOk(valid);
    }
    candleCount += 1;
    const authorization = String((init?.headers as Record<string, string>)?.Authorization ?? '');
    return authorization === `Bearer ${valid}` ? candlesOk() : authFailure();
  });
  return { fetcher, logins: () => loginCount, candles: () => candleCount, validJwt: () => valid, setValidJwt: jwt => { valid = jwt; } };
}

const request = (token: string) => getAngelCandles(
  { exchange: 'NSE', symbolToken: token, interval: 'ONE_DAY', fromDate: new Date('2026-11-01T00:00:00Z'), toDate: new Date(NOW) },
  { fetch: undefined }
);

beforeEach(() => {
  vi.stubEnv('ANGEL_API_KEY', API_KEY);
  vi.stubEnv('ANGEL_CLIENT_CODE', CLIENT_CODE);
  vi.stubEnv('ANGEL_PASSWORD', PIN);
  vi.stubEnv('ANGEL_TOTP_SECRET', TOTP_SECRET);
  resetAngelTransportForTests();
  configureAngelTransport({ now: () => NOW, resetSession: true, pacing: false });
});
afterEach(() => {
  resetAngelTransportForTests();
  vi.unstubAllEnvs();
});

describe('Angel One single-session coordination', () => {
  it('runs 50 concurrent candle loads through exactly one login', async () => {
    const h = harness({ loginDelayMs: 25 });
    configureAngelTransport({ fetch: h.fetcher as unknown as typeof fetch });
    const tokens = Array.from({ length: 50 }, (_, i) => String(3000 + i));
    const results = await Promise.all(tokens.map(token => getAngelCandles(
      { exchange: 'NSE', symbolToken: token, interval: 'ONE_DAY', fromDate: new Date('2026-11-01T00:00:00Z'), toDate: new Date(NOW) },
      { fetch: h.fetcher as unknown as typeof fetch }
    )));
    expect(results).toHaveLength(50);
    expect(results.every(rows => rows.length === 1)).toBe(true);
    expect(h.logins()).toBe(1);
    expect(h.candles()).toBe(50);
  });

  it('turns a stale-token 401 storm into one re-login and one retry per request', async () => {
    const h = harness();
    configureAngelTransport({ fetch: h.fetcher as unknown as typeof fetch });
    await angelLogin();
    expect(h.logins()).toBe(1);
    const stale = h.validJwt();

    // An external login invalidated our JWT; 40 in-flight requests fail at once.
    h.setValidJwt('jwt-external');
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => getAngelCandles(
      { exchange: 'NSE', symbolToken: String(4000 + i), interval: 'ONE_DAY', fromDate: new Date('2026-11-01T00:00:00Z'), toDate: new Date(NOW) },
      { fetch: h.fetcher as unknown as typeof fetch }
    )));
    expect(results).toHaveLength(40);
    expect(results.every(rows => rows.length === 1)).toBe(true);
    expect(stale).toBe('jwt-1');
    expect(h.logins()).toBe(2); // initial + exactly one re-login
    expect(h.candles()).toBe(80); // 40 rejected + 40 retried
  });

  it('never re-logs in twice inside the 60 s cooldown', async () => {
    const h = harness();
    configureAngelTransport({ fetch: h.fetcher as unknown as typeof fetch });
    await angelLogin();
    h.setValidJwt('jwt-external');
    await expect(request('2885')).resolves.toHaveLength(1); // forces the one allowed re-login
    expect(h.logins()).toBe(2);

    h.setValidJwt('jwt-external-again'); // the replacement session dies too
    await expect(request('2885')).rejects.toMatchObject({ code: 'PROVIDER_AUTH_FAILED' });
    expect(h.logins()).toBe(2); // cooling down, no third login
  });

  it('backs off after a throttled 403 login and succeeds on the next attempt', async () => {
    let attempts = 0;
    let clock = NOW;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('loginByPassword')) {
        attempts += 1;
        return attempts === 1 ? json({ status: false, message: 'Forbidden', errorcode: 'HTTP_403', data: null }, 403) : loginOk('jwt-after-backoff');
      }
      return candlesOk();
    });
    configureAngelTransport({ fetch: fetcher as unknown as typeof fetch, now: () => clock, loginFailureBackoffMs: 150, reloginCooldownMs: 60_000 });
    await expect(angelLogin()).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
    expect(attempts).toBe(1);
    await expect(angelLogin()).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' }); // cached only for the backoff
    expect(attempts).toBe(1);
    clock += 200; // backoff elapsed
    await expect(angelLogin()).resolves.toMatchObject({ connected: true });
    expect(attempts).toBe(2);
  });

  it('shares a failed re-login across concurrent auth failures instead of retrying per request', async () => {
    const h = harness();
    configureAngelTransport({ fetch: h.fetcher as unknown as typeof fetch });
    await angelLogin();
    h.setValidJwt('jwt-external');
    const failing = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('loginByPassword')) return json({ status: false, message: 'Forbidden', errorcode: 'HTTP_403', data: null }, 403);
      return authFailure();
    });
    configureAngelTransport({ fetch: failing as unknown as typeof fetch, loginFailureBackoffMs: 5_000 });
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => getAngelCandles(
      { exchange: 'NSE', symbolToken: String(5000 + i), interval: 'ONE_DAY', fromDate: new Date('2026-11-01T00:00:00Z'), toDate: new Date(NOW) },
      { fetch: failing as unknown as typeof fetch }
    )));
    expect(outcomes.every(outcome => outcome.status === 'rejected')).toBe(true);
    const loginCalls = failing.mock.calls.filter(call => String(call[0]).includes('loginByPassword'));
    expect(loginCalls).toHaveLength(1); // one shared re-login attempt, then cooldown
  });
});
