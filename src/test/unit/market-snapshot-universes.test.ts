import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMarketSnapshot, marketSnapshotDeadlineMs } from '../../server/backtest/marketSnapshot';
import { configureMarketProvider, generateDemoBars, MarketDataError } from '../../server/data/marketSeries';
import { UNIVERSE_OPTIONS } from '../../server/data/symbols';
import { parseMarketSnapshotResult } from '../../shared/contracts/scanner-results';

const barsFor = new Map<number, ReturnType<typeof generateDemoBars>>();
const offline = { name: 'OFFLINE_FIXTURE', load: async (id: number) => { const cached = barsFor.get(id); if (cached) return cached; const bars = generateDemoBars(id).slice(-260); barsFor.set(id, bars); return bars; } };

beforeEach(() => {
  vi.stubEnv('DATA_MODE', 'real');
  vi.stubEnv('MARKET_PROVIDER', 'none');
  // The official NSE constituent file is never reached in these tests: a failed
  // fetch proves the NIFTY 50 fallback path without a network dependency.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline fixture'); }));
});
afterEach(() => {
  configureMarketProvider();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('market snapshot universe contract', () => {
  it('returns data or a typed status for every selectable universe', async () => {
    configureMarketProvider(offline);
    for (const option of UNIVERSE_OPTIONS) {
      const result = await buildMarketSnapshot(option.id, undefined, 'real', undefined, { concurrency: 4 });
      expect(['complete', 'partial', 'unavailable'], option.id).toContain(result.status);
      expect(result.coverage.succeeded + result.coverage.unavailable, option.id).toBe(result.coverage.requested);
      expect(result.errors, option.id).toHaveLength(result.coverage.unavailable);
      if (result.status === 'unavailable') {
        expect(result.statusReason, option.id).toBeTruthy();
        expect(result.recommendations?.length, option.id).toBeGreaterThan(0);
      }
      expect(parseMarketSnapshotResult(result).universe).toBe(option.id);
    }
  }, 120_000);

  it('caps broad NSE at 200 configured symbols and says which 200', async () => {
    configureMarketProvider(offline);
    const result = await buildMarketSnapshot('NSE', undefined, 'real', undefined, { concurrency: 4 });
    expect(result.membership).toMatchObject({ basis: 'bundled-catalog', verified: false, selected: 200, cap: 200, truncated: true });
    expect(result.coverage.requested).toBe(200);
    expect(result.trends).toHaveLength(200);
    expect(result.warnings?.join(' ')).toMatch(/first 200 of/);
    expect(result.status).toBe('complete');
  });

  it('screens BSE Sensex through BSE rows and reports partial coverage only for real gaps', async () => {
    configureMarketProvider(offline);
    const result = await buildMarketSnapshot('BSE_SENSEX', undefined, 'real', undefined, { concurrency: 4 });
    expect(result.membership).toMatchObject({ basis: 'bundled-catalog', verified: false, selected: 30 });
    expect(result.membership?.truncated).toBeUndefined();
    expect(result.trends).toHaveLength(30);
    expect(result.status).toBe('complete');
  });

  it('returns a typed unavailable status with a plain reason instead of failing the request', async () => {
    configureMarketProvider({ name: 'OFFLINE_FIXTURE', load: async () => { throw new MarketDataError('PROVIDER_UNAVAILABLE', 'fixture provider down'); } });
    const result = await buildMarketSnapshot('BANK_NIFTY', undefined, 'real', undefined, { concurrency: 2 });
    expect(result.status).toBe('unavailable');
    expect(result.statusReason).toMatch(/No usable observations/);
    expect(result.recommendations?.length).toBeGreaterThan(0);
    expect(result.retryable).toBe(true);
    expect(result.trends).toHaveLength(0);
    expect(parseMarketSnapshotResult(result).status).toBe('unavailable');
  });

  it('stops at the hard deadline with counted, retryable partial coverage', async () => {
    configureMarketProvider({ name: 'OFFLINE_FIXTURE', deadlineMs: 400, load: () => new Promise(() => undefined) });
    const started = Date.now();
    const result = await buildMarketSnapshot('POPULAR_INDICES', undefined, 'real', undefined, { deadlineMs: 80, concurrency: 2 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.deadline).toMatchObject({ budgetMs: 80, reached: true, truncated: true });
    expect(result.status).toBe('unavailable');
    expect(result.retryable).toBe(true);
    expect(result.statusReason).toMatch(/deadline/i);
    expect(result.errors.every(error => error.code === 'NOT_ATTEMPTED_DEADLINE')).toBe(true);
    expect(result.coverage.succeeded + result.coverage.unavailable).toBe(result.coverage.requested);
    expect(result.warnings?.join(' ')).toMatch(/deadline/i);
    expect(parseMarketSnapshotResult(result).deadline?.truncated).toBe(true);
  });

  it('reports structured progress and bounds in-flight symbol work', async () => {
    let active = 0, peak = 0;
    configureMarketProvider({ name: 'OFFLINE_FIXTURE', load: async (id: number) => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); active--; return generateDemoBars(id); } });
    const progress: { processed: number; total: number }[] = [];
    const result = await buildMarketSnapshot('POPULAR_INDICES', undefined, 'real', (_stage, counts) => { if (counts) progress.push({ processed: counts.processed, total: counts.total }); }, { concurrency: 4 });
    expect(result.trends).toHaveLength(8);
    expect(progress.at(-1)).toEqual({ processed: 8, total: 8 });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('publishes a 90 s Nifty 50 deadline and a longer broad-universe deadline', () => {
    expect(marketSnapshotDeadlineMs('NIFTY_50')).toBe(90_000);
    expect(marketSnapshotDeadlineMs('BANK_NIFTY')).toBe(90_000);
    expect(marketSnapshotDeadlineMs('NSE')).toBe(210_000);
    expect(marketSnapshotDeadlineMs('BSE')).toBe(210_000);
  });
});
