import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app';
import { parseConfig } from '../../server/config';
import { ResearchRepository } from '../../server/storage/repository';
import { ALL_SYMBOLS } from '../../server/data/symbols';
import { resolveObservedUniverse } from '../../server/data/observedUniverse';

vi.mock('../../server/data/observedUniverse', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/data/observedUniverse')>();
  return { ...actual, resolveObservedUniverse: vi.fn() };
});

const mockedResolve = vi.mocked(resolveObservedUniverse);
const repositories: ResearchRepository[] = [];

function officialMembership() {
  const reliance = ALL_SYMBOLS.find(symbol => symbol.ticker === 'RELIANCE')!;
  return {
    symbols: [{ ...reliance, indices: ['NIFTY_50'] }],
    requested: 50,
    unmapped: [],
    source: 'https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv',
    observedAt: '2026-11-16T12:00:00.000Z',
    freshness: 'official-feed-observed; effective date not supplied',
    warnings: []
  };
}

async function setup() {
  const config = parseConfig({ NODE_ENV: 'test', DATA_MODE: 'real', MARKET_PROVIDER: 'yahoo', AI_PROVIDER: 'none', STORAGE_MODE: 'ephemeral' });
  const repository = await ResearchRepository.open({ maxRuns: 2 });
  repositories.push(repository);
  return createApp({ config, repository, enableVite: false });
}

beforeEach(() => {
  mockedResolve.mockReset();
  vi.stubEnv('SYMBOLS_WARMUP_BUDGET_MS', '20');
});
afterEach(async () => {
  await Promise.all(repositories.splice(0).map(repository => repository.close()));
  vi.unstubAllEnvs();
});

describe('/api/symbols warm-up', () => {
  it('waits through a transient membership failure instead of reporting no symbols', async () => {
    mockedResolve.mockRejectedValueOnce(new Error('transient NSE blip')).mockResolvedValueOnce(officialMembership() as never);
    vi.stubEnv('SYMBOLS_WARMUP_BUDGET_MS', '3000');
    const app = await setup();
    const response = await request(app).get('/api/symbols');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.membershipBasis).toContain('official-current-feed');
    expect(response.body.symbols.some((symbol: { ticker: string }) => symbol.ticker === 'RELIANCE')).toBe(true);
    expect(mockedResolve).toHaveBeenCalledTimes(2);
  });

  it('falls back to the bundled catalog instead of 503 when the feed stays down', async () => {
    mockedResolve.mockRejectedValue(new Error('NSE archives unavailable'));
    const app = await setup();
    const response = await request(app).get('/api/symbols');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.membershipBasis).toContain('bundled-catalog-fallback');
    expect(response.body.membership).toMatchObject({ source: 'BUNDLED_INSTRUMENT_CATALOG', unavailable: true });
    expect(response.body.warning).toMatch(/Official NIFTY 50 membership could not be loaded/);
    const tickers = response.body.symbols.map((symbol: { ticker: string }) => symbol.ticker);
    expect(tickers).toContain('RELIANCE');
    expect(tickers).toContain('^NSEI');
  });
});
