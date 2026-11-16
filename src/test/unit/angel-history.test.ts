import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { angelEvidence, completedAngelBars, createAngelProvider } from '../../server/data/angelProvider';
import { configureAngelTransport, resetAngelTransportForTests, type AngelCandle } from '../../server/data/angelClient';
import { resetAngelInstrumentCache } from '../../server/data/angelSymbols';
import { getSymbolByTicker } from '../../server/data/symbols';

const candle = (date: string, close = 100, volume = 1000): AngelCandle => ({
  date,
  timestamp: Date.parse(`${date}T00:00:00+05:30`),
  open: close - 1,
  high: close + 2,
  low: close - 2,
  close,
  volume
});

beforeEach(() => {
  vi.stubEnv('ANGEL_API_KEY', 'test-api-key-xyz');
  vi.stubEnv('ANGEL_CLIENT_CODE', 'A12345678');
  vi.stubEnv('ANGEL_PASSWORD', '9876');
  vi.stubEnv('ANGEL_TOTP_SECRET', 'JBSWY3DPEHPK3PXP');
  resetAngelTransportForTests();
  resetAngelInstrumentCache();
});
afterEach(() => {
  resetAngelTransportForTests();
  resetAngelInstrumentCache();
  vi.unstubAllEnvs();
});

describe('Angel daily candles', () => {
  it('excludes the in-progress session before 15:30 IST', () => {
    const now = Date.parse('2026-11-16T08:00:00Z'); // 13:30 IST
    const { bars, incomplete, skipped } = completedAngelBars([candle('2026-11-13'), candle('2026-11-16')], now);
    expect(bars.map(b => b.date)).toEqual(['2026-11-13']);
    expect(incomplete).toBe(1);
    expect(skipped).toBe(0);
    expect(angelEvidence(bars, '2885', now, skipped, incomplete)).toMatchObject({
      source: 'ANGEL_SMARTAPI',
      providerSymbol: 'NSE:2885',
      exchangeTimezone: 'Asia/Kolkata',
      freshness: 'last-completed-session'
    });
  });

  it('includes today only after the 15:30 IST close', () => {
    const afterClose = Date.parse('2026-11-16T10:00:00Z'); // 15:30 IST
    const { bars, incomplete } = completedAngelBars([candle('2026-11-13'), candle('2026-11-16')], afterClose);
    expect(bars.map(b => b.date)).toEqual(['2026-11-13', '2026-11-16']);
    expect(incomplete).toBe(0);
    expect(angelEvidence(bars, '2885', afterClose, 0, 0).freshness).toBe('same-day-broker-close');
  });

  it('sorts, deduplicates by session and skips invalid rows without synthesis', () => {
    const now = Date.parse('2026-11-16T08:00:00Z');
    const invalid = { ...candle('2026-11-12'), high: 1 }; // high below open/close
    const { bars, skipped } = completedAngelBars([candle('2026-11-13', 101), candle('2026-11-12', 99), candle('2026-11-13', 102), invalid], now);
    expect(bars.map(b => [b.date, b.close])).toEqual([['2026-11-12', 99], ['2026-11-13', 102]]);
    expect(skipped).toBe(1);
  });

  it('caps the retained history at 5,000 daily bars', () => {
    const now = Date.parse('2026-11-16T08:00:00Z');
    const rows: AngelCandle[] = [];
    const start = Date.parse('2010-01-01T00:00:00Z');
    for (let i = 0; i < 5_001; i++) rows.push(candle(new Date(start + i * 86_400_000).toISOString().slice(0, 10)));
    expect(completedAngelBars(rows, now).bars).toHaveLength(5_000);
  });

  it('loads ONE_DAY candles through the provider with honest provenance', async () => {
    const id = getSymbolByTicker('RELIANCE')!.id;
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('loginByPassword')) {
        return new Response(JSON.stringify({ status: true, message: 'SUCCESS', errorcode: '', data: { jwtToken: 'synthetic-jwt', refreshToken: 'r', feedToken: 'f' } }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ exchange: 'NSE', symboltoken: '2885', interval: 'ONE_DAY' });
      expect(body.fromdate).toMatch(/^\d{4}-\d{2}-\d{2} 09:15$/);
      expect(body.todate).toMatch(/^\d{4}-\d{2}-\d{2} 15:30$/);
      return new Response(JSON.stringify({
        status: true, message: 'SUCCESS', errorcode: '',
        data: [
          ['2026-11-12T00:00:00+05:30', 1335.4, 1342.5, 1330.9, 1339.7, 13807921],
          ['2026-11-13T00:00:00+05:30', 1336.6, 1350.7, 1324, 1339.7, 13756247],
          ['2026-11-16T00:00:00+05:30', 1339.7, 1347.3, 1333.8, 1340.7, 4603417]
        ]
      }), { status: 200 });
    });
    const now = Date.parse('2026-11-16T08:00:00Z');
    configureAngelTransport({ fetch: fetcher as unknown as typeof fetch, now: () => now, resetSession: true });
    const provider = createAngelProvider(fetcher as unknown as typeof fetch, { now: () => now });
    const observation = await provider.load(id, new AbortController().signal);
    expect(Array.isArray(observation)).toBe(false);
    const result = observation as Exclude<typeof observation, unknown[]>;
    expect(result.bars.map(b => b.date)).toEqual(['2026-11-12', '2026-11-13']);
    expect(result.evidence).toMatchObject({ source: 'ANGEL_SMARTAPI', providerSymbol: 'NSE:2885', freshness: 'last-completed-session' });
    expect(result.evidence.warnings.join(' ')).toMatch(/Angel One redistribution|unfinished session/);
  });

  it('never requests an unverified ticker and fails closed', async () => {
    const id = getSymbolByTicker('TMPV')!.id;
    const fetcher = vi.fn(async () => { throw new Error('no network expected'); });
    const provider = createAngelProvider(fetcher as unknown as typeof fetch);
    await expect(provider.load(id, new AbortController().signal)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});
