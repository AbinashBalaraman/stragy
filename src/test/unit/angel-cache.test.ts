import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getAngelDebugMetrics, configureAngelTransport, resetAngelTransportForTests, resetAngelDebugMetrics } from '../../server/data/angelClient';
import { createAngelProvider, lastCompletedSession } from '../../server/data/angelProvider';
import { getSymbolByTicker } from '../../server/data/symbols';
import { resetAngelInstrumentCache } from '../../server/data/angelSymbols';
import { configureMarketProvider, loadMarketSeries, type ProviderObservation } from '../../server/data/marketSeries';
import { closeMarketCache, getCandleCoverage, getMarketCacheStats } from '../../server/data/candleStore';

const SCRATCH = '/data/tmp/opencode';
const RELIANCE = getSymbolByTicker('RELIANCE')!.id;
const TCS = getSymbolByTicker('TCS')!.id;
let directory = '';
let currentNow = Date.parse('2026-11-16T08:00:00Z'); // Monday 13:30 IST
let rows: unknown[][] = [];
let candleRequests: Array<Record<string, unknown>> = [];
let candleDelayMs = 0;

function row(date: string, close = 100, volume = 1_000): unknown[] {
  return [date + 'T00:00:00+05:30', close - 1, close + 2, close - 2, close, volume];
}

const loginOk = () => new Response(JSON.stringify({ status: true, message: 'SUCCESS', errorcode: '', data: { jwtToken: 'jwt-cache-test', refreshToken: 'r', feedToken: 'f' } }), { status: 200, headers: { 'content-type': 'application/json' } });
const candlesOk = (data: unknown[][]) => new Response(JSON.stringify({ status: true, message: 'SUCCESS', errorcode: '', data }), { status: 200, headers: { 'content-type': 'application/json' } });

const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  if (String(url).includes('loginByPassword')) return loginOk();
  candleRequests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
  if (candleDelayMs > 0) await new Promise(resolve => setTimeout(resolve, candleDelayMs));
  return candlesOk(rows);
});

function provider() {
  return createAngelProvider(fetcher as unknown as typeof fetch, { now: () => currentNow });
}

async function load(id: number): Promise<ProviderObservation> {
  const observation = await provider().load(id, new AbortController().signal);
  if (Array.isArray(observation)) throw new Error('Expected provider evidence');
  return observation;
}

beforeEach(() => {
  mkdirSync(SCRATCH, { recursive: true });
  closeMarketCache();
  directory = mkdtempSync(join(SCRATCH, 'stragy-angel-cache-'));
  process.env.STRAGY_MARKET_DB = join(directory, 'candles.db');
  vi.stubEnv('ANGEL_API_KEY', 'test-api-key-cache');
  vi.stubEnv('ANGEL_CLIENT_CODE', 'A12345678');
  vi.stubEnv('ANGEL_PASSWORD', '9876');
  vi.stubEnv('ANGEL_TOTP_SECRET', 'JBSWY3DPEHPK3PXP');
  resetAngelTransportForTests();
  resetAngelInstrumentCache();
  currentNow = Date.parse('2026-11-16T08:00:00Z');
  rows = [row('2026-11-12', 100), row('2026-11-13', 101), row('2026-11-13', 105), row('2026-11-16', 102), ['2026-11-14T00:00:00+05:30', 100, 1, 90, 100, 1_000]];
  candleRequests = [];
  candleDelayMs = 0;
  fetcher.mockClear();
  configureAngelTransport({ fetch: fetcher as unknown as typeof fetch, now: () => currentNow, resetSession: true, pacing: false });
});

afterEach(() => {
  configureMarketProvider();
  resetAngelTransportForTests();
  resetAngelInstrumentCache();
  closeMarketCache();
  delete process.env.STRAGY_MARKET_DB;
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('cache-first Angel daily candles', () => {
  it('cold load requests 1,100 days once, stores valid bars and reports the cache', async () => {
    const observation = await load(RELIANCE);
    expect(candleRequests).toHaveLength(1);
    const body = candleRequests[0];
    const expectedFrom = new Date(currentNow - 1_100 * 86_400_000 + 19_800_000).toISOString().slice(0, 10);
    expect(body).toMatchObject({ exchange: 'NSE', symboltoken: '2885', interval: 'ONE_DAY', fromdate: expectedFrom + ' 09:15', todate: '2026-11-16 15:30' });
    expect(observation.bars.map(bar => [bar.date, bar.close])).toEqual([['2026-11-12', 100], ['2026-11-13', 105]]);
    expect(observation.evidence.warnings.join(' ')).toMatch(/invalid row|unfinished session/);
    expect(observation.evidence.cache).toMatchObject({
      hit: false,
      incremental: false,
      candleRequests: 1,
      requestedFrom: expectedFrom,
      requestedTo: '2026-11-16',
      changedBars: 2,
      bars: 2,
      lastFetchAt: new Date(currentNow).toISOString()
    });
    const coverage = getCandleCoverage(RELIANCE);
    expect(coverage).toMatchObject({ bars: 2, firstDate: '2026-11-12', lastDate: '2026-11-13', checkedThrough: '2026-11-13', providerSymbol: 'NSE:2885' });
    expect(getMarketCacheStats()).toMatchObject({ symbols: 1, bars: 2, hits: 0, misses: 1, incrementalFetches: 0 });
  });

  it('warm load inside the same close makes zero provider candle requests', async () => {
    const cold = await load(RELIANCE);
    resetAngelDebugMetrics();
    const warm = await load(RELIANCE);
    expect(candleRequests).toHaveLength(1);
    expect(getAngelDebugMetrics().candleRequests).toBe(0);
    expect(warm.bars).toEqual(cold.bars);
    expect(warm.fetchedAt).toBe(cold.fetchedAt);
    expect(warm.evidence.cache).toMatchObject({ hit: true, incremental: false, candleRequests: 0, lastFetchAt: cold.fetchedAt });
    expect(warm.evidence.warnings.join(' ')).toContain('local daily-candle cache');
    expect(getMarketCacheStats()).toMatchObject({ hits: 1, misses: 1, incrementalFetches: 0 });
  });

  it('fetches only the missing tail with a two-trading-day overlap on a new session', async () => {
    await load(RELIANCE);
    candleRequests = [];
    currentNow = Date.parse('2026-11-17T10:00:00Z'); // Tuesday 15:30 IST
    rows = [row('2026-11-11', 99), row('2026-11-12', 100), row('2026-11-13', 101), row('2026-11-16', 103), row('2026-11-17', 104)];
    resetAngelDebugMetrics();

    const observation = await load(RELIANCE);
    expect(candleRequests).toHaveLength(1);
    expect(candleRequests[0]).toMatchObject({ fromdate: '2026-11-11 09:15', todate: '2026-11-17 15:30' });
    expect(observation.bars.map(bar => bar.date)).toEqual(['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17']);
    expect(observation.evidence.cache).toMatchObject({ hit: false, incremental: true, candleRequests: 1, requestedFrom: '2026-11-11', changedBars: 5 });
    expect(getCandleCoverage(RELIANCE)).toMatchObject({ bars: 5, lastDate: '2026-11-17', checkedThrough: '2026-11-17' });
    expect(getMarketCacheStats()).toMatchObject({ hits: 0, misses: 1, incrementalFetches: 1 });

    resetAngelDebugMetrics();
    candleRequests = [];
    const warm = await load(RELIANCE);
    expect(candleRequests).toHaveLength(0);
    expect(warm.evidence.cache?.hit).toBe(true);
  });

  it('includes a same-day close, then serves it without any network call', async () => {
    currentNow = Date.parse('2026-11-16T10:05:00Z'); // 15:35 IST, after close
    rows = [row('2026-11-12', 100), row('2026-11-13', 101), row('2026-11-16', 102)];
    const cold = await load(RELIANCE);
    expect(cold.bars.map(bar => bar.date)).toEqual(['2026-11-12', '2026-11-13', '2026-11-16']);
    resetAngelDebugMetrics();
    candleRequests = [];
    const warm = await load(RELIANCE);
    expect(candleRequests).toHaveLength(0);
    expect(warm.evidence.freshness).toBe('same-day-broker-close');
    expect(warm.evidence.cache?.hit).toBe(true);
  });

  it('uses the cross-instance lease so two providers do not both download', async () => {
    candleDelayMs = 25;
    const [first, second] = await Promise.all([
      provider().load(TCS, new AbortController().signal),
      provider().load(TCS, new AbortController().signal)
    ]);
    expect(Array.isArray(first)).toBe(false);
    expect(Array.isArray(second)).toBe(false);
    expect(candleRequests).toHaveLength(1);
  });

  it('coalesces same-provider concurrent loads into exactly one provider call', async () => {
    candleDelayMs = 25;
    const instance = provider();
    const [first, second] = await Promise.all([
      instance.load(TCS, new AbortController().signal),
      instance.load(TCS, new AbortController().signal)
    ]);
    expect(candleRequests).toHaveLength(1);
    expect(Array.isArray(first)).toBe(false);
    expect(Array.isArray(second)).toBe(false);
    expect(getMarketCacheStats()).toMatchObject({ symbols: 1, misses: 1, hits: 0 });
  });

  it('keeps counters and coverage across a close/reopen', async () => {
    await load(RELIANCE);
    await load(RELIANCE);
    closeMarketCache();
    expect(getMarketCacheStats()).toMatchObject({ symbols: 1, bars: 2, hits: 1, misses: 1, incrementalFetches: 0 });
    expect(getCandleCoverage(RELIANCE)).toMatchObject({ lastDate: '2026-11-13', bars: 2 });
  });

  it('adds source/freshness/cache provenance without changing the bars', async () => {
    await load(RELIANCE);
    configureMarketProvider(provider());
    const series = await loadMarketSeries(RELIANCE, { mode: 'real' });
    expect(series.provenance.source).toBe('ANGEL_SMARTAPI');
    expect(series.provenance.freshness).toBe('last-completed-session');
    expect(series.provenance.cache).toMatchObject({ hit: true, candleRequests: 0, bars: 2, lastDate: '2026-11-13' });
    expect(series.provenance.actualRange).toEqual({ start: '2026-11-12', end: '2026-11-13' });
    expect(series.bars.map(bar => bar.close)).toEqual([100, 105]);
    expect(Object.isFrozen(series.provenance)).toBe(true);
    resetAngelDebugMetrics();
    configureMarketProvider(provider());
    const again = await loadMarketSeries(RELIANCE, { mode: 'real' });
    expect(getAngelDebugMetrics().candleRequests).toBe(0);
    expect(again.provenance.cache?.hit).toBe(true);
  });

  it('reports a later provider history start without inventing older bars', async () => {
    rows = [row('2024-06-03', 100), row('2024-06-04', 101)];
    const observation = await load(RELIANCE);
    expect(observation.bars.map(bar => bar.date)).toEqual(['2024-06-03', '2024-06-04']);
    expect(observation.evidence.warnings.join(' ')).toContain('older bars are unavailable and were not synthesized');
  });

  it('reports a provider cap honestly instead of inventing older bars', async () => {
    const capRows: unknown[][] = [];
    const start = Date.parse('2010-01-01T00:00:00Z');
    for (let index = 0; index < 5_001; index += 1) {
      const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
      capRows.push(row(date, 100 + (index % 10)));
    }
    rows = capRows;
    const observation = await load(RELIANCE);
    expect(observation.bars).toHaveLength(5_000);
    expect(observation.evidence.warnings.join(' ')).toContain('older bar(s) beyond the 5000-bar response window');
    expect(getMarketCacheStats().bars).toBe(5_000);
  });

  it('uses the correct last completed IST session at clock boundaries', () => {
    expect(lastCompletedSession(Date.parse('2026-11-16T08:00:00Z')).date).toBe('2026-11-13'); // Monday before close
    expect(lastCompletedSession(Date.parse('2026-11-16T10:00:00Z')).date).toBe('2026-11-16'); // Monday after close
    expect(lastCompletedSession(Date.parse('2026-11-14T10:00:00Z')).date).toBe('2026-11-13'); // Saturday
    expect(lastCompletedSession(Date.parse('2026-11-15T10:00:00Z')).date).toBe('2026-11-13'); // Sunday
    expect(lastCompletedSession(Date.parse('2026-11-13T08:00:00Z')).date).toBe('2026-11-12'); // Friday before close
    expect(lastCompletedSession(Date.parse('2026-11-16T10:00:00Z')).closeMs).toBe(Date.parse('2026-11-16T15:30:00+05:30'));
  });
});
