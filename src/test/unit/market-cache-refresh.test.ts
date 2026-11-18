import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getMarketCacheRefresh,
  resetMarketCacheRefreshForTests,
  startMarketCacheRefresh,
  type CacheRefreshState,
} from '../../server/data/marketCacheRefresh';
import { MarketDataError } from '../../server/data/marketSeries';

async function waitForTerminal(id: string): Promise<CacheRefreshState> {
  for (let i = 0; i < 200; i += 1) {
    const state = getMarketCacheRefresh(id);
    if (state && state.status !== 'running') return state;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error('refresh did not finish');
}

afterEach(() => resetMarketCacheRefreshForTests());

describe('market cache refresh', () => {
  it('warms every requested symbol through the cache-first loader', async () => {
    const load = vi.fn(async () => ({ bars: [], provenance: {} })) as never;
    const { state, alreadyRunning } = startMarketCacheRefresh(
      { symbolIds: [1, 2, 3] },
      {
        loadSeries: load,
        getSymbol: (id: number) => ({ id, ticker: 'S' + id }) as never,
      },
    );
    expect(alreadyRunning).toBe(false);
    const done = await waitForTerminal(state.id);
    expect(done.status).toBe('done');
    expect(done.total).toBe(3);
    expect(done.processed).toBe(3);
    expect(done.succeeded).toBe(3);
    expect(done.failed).toBe(0);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('collects typed per-symbol failures without aborting the rest', async () => {
    const load = vi.fn(async (id: number) => {
      if (id === 2) throw new MarketDataError('PROVIDER_RATE_LIMITED', 'Angel One is busy. Try again in a minute.');
      return { bars: [] };
    }) as never;
    const { state } = startMarketCacheRefresh(
      { symbolIds: [1, 2, 3] },
      { loadSeries: load, getSymbol: (id: number) => ({ id, ticker: 'S' + id }) as never },
    );
    const done = await waitForTerminal(state.id);
    expect(done.succeeded).toBe(2);
    expect(done.failed).toBe(1);
    expect(done.errors[0]).toMatchObject({ symbolId: 2, ticker: 'S2', code: 'PROVIDER_RATE_LIMITED' });
    expect(done.status).toBe('done');
  });

  it('rejects a second concurrent refresh instead of doubling provider load', async () => {
    const gate: { release?: () => void } = {};
    const load = (async () => {
      await new Promise<void>(resolve => { gate.release = resolve; });
      return { bars: [] };
    }) as never;
    const first = startMarketCacheRefresh(
      { symbolIds: [1] },
      { loadSeries: load, getSymbol: (id: number) => ({ id, ticker: 'S' + id }) as never },
    );
    const second = startMarketCacheRefresh({ symbolIds: [2] });
    expect(second.alreadyRunning).toBe(true);
    expect(second.state.id).toBe(first.state.id);
    gate.release?.();
    await waitForTerminal(first.state.id);
  });

  it('reports a cap warning and only warms the cap', async () => {
    const load = vi.fn(async () => ({ bars: [] })) as never;
    const { state } = startMarketCacheRefresh(
      { symbolIds: [1, 2, 3, 4], maxSymbols: 2 },
      { loadSeries: load, getSymbol: (id: number) => ({ id, ticker: 'S' + id }) as never },
    );
    const done = await waitForTerminal(state.id);
    expect(done.total).toBe(2);
    expect(done.warning).toContain('first 2 of 4');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reports an empty universe honestly', async () => {
    const { state } = startMarketCacheRefresh(
      { universe: 'EMPTY' },
      { resolveUniverse: (async () => ({ symbols: [] })) as never },
    );
    const done = await waitForTerminal(state.id);
    expect(done.status).toBe('failed');
    expect(done.warning).toContain('No symbols');
  });
});
