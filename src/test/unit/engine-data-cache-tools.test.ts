import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEnginePlugin, EngineContextStore, type EngineToolDeps } from '../../server/ai/engineTools';
import { ApprovalStore } from '../../server/ai/engineApprovals';
import { ENGINE_SYSTEM_PROMPT } from '../../server/ai/engineConfig';
import {
  clearMarketCacheForTests, closeMarketCache, markCandleFetch, upsertCandles,
} from '../../server/data/candleStore';
import { filterSymbolsByUniverse, getSymbolByTicker, UNIVERSE_OPTIONS } from '../../server/data/symbols';
import { validateStrategy } from '../../shared/strategy/schema';
import type { ResearchPayload } from '../../server/jobs/manager';

type Tool = {
  name: string;
  input: { safeParse: (value: unknown) => { success: boolean } };
  execute: (input: unknown, context: unknown) => Promise<{ output?: Record<string, any> }>;
};

const strategyRaw = {
  name: 'RSI(2) oversold', version: 2, universe: { symbolId: getSymbolByTicker('RELIANCE')!.id, timeframe: '1D' },
  indicators: [{ id: 'rsi2', type: 'RSI', params: { period: 2 } }],
  rules: {
    entry: [{ id: 'e1', leftIndicator: 'rsi2', operator: 'lt', rightValue: 30 }],
    exit: [{ id: 'x1', leftIndicator: 'rsi2', operator: 'gt', rightValue: 55 }],
  },
  risk: { stopLoss: { type: 'percent', value: 5 }, takeProfit: { type: 'rr', value: 2 }, trailingStop: null, positionSizing: { type: 'fixedFraction', fraction: 0.1 }, maxDrawdownCutoff: 20 },
  execution: { allowLong: true, allowShort: false, orderType: 'MARKET' },
  costs: { slippageBps: 5, brokerageFlat: 20, applyIndianTaxes: true, tradeType: 'DELIVERY' },
};
const validated = validateStrategy(strategyRaw);
if (!validated.success) throw new Error('fixture strategy invalid');
const strategy = validated.data!;

const dbPath = path.join('/data/tmp/opencode', 'h-engine-cache-' + randomUUID() + '.db');
let originalQuotesProvider: string | undefined = undefined;

beforeAll(() => {
  process.env.STRAGY_MARKET_DB = dbPath;
  originalQuotesProvider = process.env.QUOTES_PROVIDER;
  process.env.QUOTES_PROVIDER = 'none';
  closeMarketCache();
});

beforeEach(() => {
  closeMarketCache();
  clearMarketCacheForTests();
});

afterEach(() => {
  closeMarketCache();
});

afterAll(() => {
  closeMarketCache();
  for (const file of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    if (existsSync(file)) rmSync(file, { force: true });
  }
  delete process.env.STRAGY_MARKET_DB;
  if (originalQuotesProvider === undefined) delete process.env.QUOTES_PROVIDER;
  else process.env.QUOTES_PROVIDER = originalQuotesProvider;
});

function seedSymbol(ticker: string, bars = 60): string {
  const symbol = getSymbolByTicker(ticker)!;
  const start = Date.UTC(2026, 0, 1);
  const rows = Array.from({ length: bars }, (_, index) => {
    const close = 100 + index;
    return {
      date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
      timestamp: start + index * 86_400_000,
      open: close - 1, high: close + 1, low: close - 2, close, volume: 10_000 + index,
    };
  });
  const fetchedAt = '2026-11-18T10:00:00.000Z';
  upsertCandles(symbol.id, rows, 'ANGEL_SMARTAPI', fetchedAt);
  markCandleFetch(symbol.id, 'ANGEL_SMARTAPI', rows.at(-1)!.date, fetchedAt, 'NSE:' + symbol.id);
  return rows.at(-1)!.date;
}

async function setup(overrides: Partial<EngineToolDeps> = {}) {
  const tools: Tool[] = [];
  const deps: EngineToolDeps = {
    dataMode: 'demo', approvals: new ApprovalStore(), contexts: new EngineContextStore(), ...overrides,
  };
  const plugin = createEnginePlugin(() => deps);
  await plugin.setup({
    tool: {
      transform: async (callback: (editor: {
        add: (tool: Tool) => void; list: () => Tool[]; get: (name: string) => Tool | undefined;
        namespace: () => void; update: () => void; remove: () => void;
      }) => void) => {
        callback({
          add: tool => tools.push(tool), list: () => tools, get: name => tools.find(tool => tool.name === name),
          namespace: () => undefined, update: () => undefined, remove: () => undefined,
        });
      },
    },
  } as never);
  return { tools, deps, get: (name: string) => tools.find(tool => tool.name === name)! };
}

const context = (sessionID = 's1') => ({ sessionID, agent: 'stragy', messageID: 'm1', id: 'call_1', signal: new AbortController().signal, progress: async () => undefined });

function fakeSeries(input: { hit: boolean; incremental: boolean; bars: number; candleRequests: number }) {
  const symbol = getSymbolByTicker('TCS')!;
  const start = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 60 }, (_, index) => {
    const close = 100 + index;
    return {
      date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
      timestamp: start + index * 86_400_000,
      open: close - 1, high: close + 1, low: close - 2, close, volume: 10_000 + index,
    };
  });
  return {
    bars,
    provenance: {
      mode: 'real', source: 'ANGEL_SMARTAPI', symbolId: symbol.id, asOf: bars.at(-1)!.date,
      fetchedAt: '2026-11-18T10:00:00.000Z', requestedRange: {}, actualRange: { start: bars[0].date, end: bars.at(-1)!.date },
      adjustment: 'unadjusted', checksum: 'test', coverage: 'available-history', freshness: 'cached-observation',
      calendarVersion: 'weekday-demo-v1', providerSymbol: 'NSE:11536', warnings: ['Served from the local daily-candle cache'],
      cache: {
        hit: input.hit, incremental: input.incremental, candleRequests: input.candleRequests,
        requestedFrom: input.incremental ? '2026-11-10' : null, requestedTo: input.incremental ? '2026-11-18' : null,
        changedBars: input.incremental ? 5 : 0, firstDate: bars[0].date, lastDate: bars.at(-1)!.date,
        bars: input.bars, lastFetchAt: '2026-11-18T10:00:00.000Z',
      },
    },
  };
}

describe('engine data and cache tools', () => {
  it('reports cache stats and per-universe coverage without touching a provider', async () => {
    seedSymbol('TCS');
    const loadSeries = vi.fn();
    const { get } = await setup({ loadSeries });
    const result = await get('get_data_cache').execute({}, context());
    expect(result.output?.status).toBe('ok');
    expect(loadSeries).not.toHaveBeenCalled();
    expect(result.output?.cache).toMatchObject({ symbols: 1, bars: 60, dbPath });
    expect(typeof result.output?.cache.dbBytes).toBe('number');
    expect(result.output?.quotes).toMatchObject({ cached: false });
    expect(String(result.output?.quotes.note)).toMatch(/not cached/i);
    const universes = result.output?.universes as Record<string, any>[];
    expect(universes).toHaveLength(UNIVERSE_OPTIONS.length);
    const nifty = universes.find(item => item.id === 'NIFTY_50')!;
    expect(nifty.configuredSymbols).toBe(filterSymbolsByUniverse('NIFTY_50').length);
    expect(nifty.cachedSymbols).toBeGreaterThanOrEqual(1);
    expect(nifty.cachedBars).toBeGreaterThanOrEqual(60);
    expect(nifty.estimatedColdSeconds).toBeGreaterThan(nifty.estimatedWarmSeconds);
    expect(nifty.estimatedWarmSeconds).toBeGreaterThan(0);
    expect(String(result.output?.note)).toMatch(/never calls a provider/i);
  });

  it('queues a bounded warm-up job and returns a typed unavailable when jobs cannot run it', async () => {
    const enqueue = vi.fn((_payload: ResearchPayload) => ({ id: 'cache1', kind: 'cache', status: 'queued' }));
    const { get } = await setup({ jobs: { enqueue, get: () => undefined } });
    const queued = await get('refresh_market_data').execute({ universe: 'NIFTY_50', maxSymbols: 5 }, context());
    expect(queued.output).toMatchObject({ status: 'queued', kind: 'cache', jobId: 'cache1', total: 5 });
    expect(typeof queued.output?.estimatedSeconds).toBe('number');
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cache', universe: 'NIFTY_50', maxSymbols: 5 }));

    const noJobs = await setup();
    const unavailable = await noJobs.get('refresh_market_data').execute({ universe: 'NIFTY_50' }, context());
    expect(unavailable.output).toMatchObject({ status: 'failed', error: { code: 'CACHE_REFRESH_UNAVAILABLE' } });

    const unsupportedEnqueue = vi.fn();
    const unsupported = await setup({ jobs: { enqueue: unsupportedEnqueue, get: () => undefined, supportsCacheJobs: false } });
    const refused = await unsupported.get('refresh_market_data').execute({ universe: 'NIFTY_50' }, context());
    expect(refused.output).toMatchObject({ status: 'failed', error: { code: 'CACHE_REFRESH_UNAVAILABLE' } });
    expect(unsupportedEnqueue).not.toHaveBeenCalled();

    const bySymbol = await get('refresh_market_data').execute({ symbolIds: ['TCS', 'RELIANCE'], maxSymbols: 1 }, context());
    expect(bySymbol.output).toMatchObject({ status: 'queued', total: 1 });
    expect(enqueue).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'cache', symbolIds: [getSymbolByTicker('TCS')!.id], maxSymbols: 1 }));
  });

  it('bounds maxSymbols at 1..200 and keeps limit as result pagination', async () => {
    const enqueue = vi.fn((_payload: ResearchPayload) => ({ id: 'scan1', kind: 'scan', status: 'queued' }));
    const { get } = await setup({ jobs: { enqueue, get: () => undefined } });
    const scan = get('scan_market');
    expect(scan.input.safeParse({ universe: 'NSE', strategy, maxSymbols: 0 }).success).toBe(false);
    expect(scan.input.safeParse({ universe: 'NSE', strategy, maxSymbols: 201 }).success).toBe(false);
    expect(scan.input.safeParse({ universe: 'NSE', strategy, maxSymbols: 200 }).success).toBe(true);
    expect(scan.input.safeParse({ universe: 'NSE', strategy, limit: 101 }).success).toBe(false);
    expect(scan.input.safeParse({ universe: 'NSE', strategy, limit: 100 }).success).toBe(true);

    const queued = await scan.execute({ universe: 'NSE', strategy, maxSymbols: 5 }, context());
    const configured = filterSymbolsByUniverse('NSE').length;
    expect(queued.output).toMatchObject({ status: 'queued', evaluation: { requested: 5, scanCap: 200, configuredSymbols: configured } });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'scan', maxSymbols: 5, limit: 50 }));
    expect(String(queued.output?.note)).toMatch(new RegExp('first 5 of ' + configured));
    expect(String(queued.output?.note)).toMatch(/cold scan/);
    expect(queued.output?.cacheCoverage).toMatchObject({ total: 5 });
  });

  it('reports real scan progress and only computes an ETA from measured progress', async () => {
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const running = {
      enqueue: vi.fn(),
      get: () => ({ id: 'scan2', kind: 'scan', status: 'running', stage: 'scan 20/200', startedAt, progress: { processed: 20, total: 200 } }),
    };
    const { get } = await setup({ jobs: running, pollBudgetCapMs: 0, pollIntervalMs: 1 });
    const result = await get('get_scan_result').execute({ jobId: 'scan2', waitSeconds: 5 }, context());
    expect(result.output).toMatchObject({ status: 'running', percent: 10, progress: { processed: 20, total: 200 } });
    expect(result.output?.elapsedSeconds).toBeGreaterThanOrEqual(60);
    expect(result.output?.estimatedSecondsRemaining).toBeGreaterThanOrEqual(540);
    expect(result.output?.estimatedSecondsRemaining).toBeLessThanOrEqual(560);
    expect(result.output?.etaBasis).toMatch(/measured from 20 of 200/);
    expect(String(result.output?.note)).toMatch(/Do not narrate each poll/);

    const early = {
      enqueue: vi.fn(),
      get: () => ({ id: 'scan3', kind: 'scan', status: 'running', startedAt, progress: { processed: 1, total: 200 } }),
    };
    const earlySetup = await setup({ jobs: early, pollBudgetCapMs: 0, pollIntervalMs: 1 });
    const earlyResult = await earlySetup.get('get_scan_result').execute({ jobId: 'scan3' }, context());
    expect(earlyResult.output?.estimatedSecondsRemaining).toBeNull();
    expect(earlyResult.output?.etaNote).toMatch(/No ETA/);

    const queued = {
      enqueue: vi.fn(),
      get: () => ({ id: 'scan4', kind: 'scan', status: 'queued', stage: 'waiting', queuedBehind: 2 }),
    };
    const queuedSetup = await setup({ jobs: queued, pollBudgetCapMs: 0, pollIntervalMs: 1 });
    const queuedResult = await queuedSetup.get('get_scan_result').execute({ jobId: 'scan4' }, context());
    expect(queuedResult.output).toMatchObject({ status: 'running', queuedBehind: 2 });
    expect(String(queuedResult.output?.note)).toMatch(/Do not narrate/);
  });

  it('summarizes a finished warm-up honestly', async () => {
    const result = {
      id: 'cache1', status: 'done', universe: 'NIFTY_50', total: 5, processed: 5, succeeded: 5, failed: 0,
      startedAt: '2026-11-18T10:00:00.000Z', finishedAt: '2026-11-18T10:00:09.000Z', errors: [],
      warning: 'Refreshed the first 5 of 47 configured symbols; this is not full coverage.',
    };
    const { get } = await setup({ jobs: { enqueue: vi.fn(), get: () => ({ id: 'cache1', kind: 'cache', status: 'succeeded', result }) } });
    const output = await get('get_refresh_result').execute({ jobId: 'cache1' }, context());
    expect(output.output).toMatchObject({ status: 'succeeded', kind: 'cache', total: 5, processed: 5, succeeded: 5 });
    expect(output.output?.warning).toMatch(/not full coverage/);
    expect(String(output.output?.note)).toMatch(/Warm-up finished/);
  });

  it('summarizes retained scan coverage and cache provenance honestly', async () => {
    const result = {
      universe: 'NSE', requested: 2, attempted: 2, succeeded: 2, unavailable: 0, failed: 0, matched: 1,
      membership: { selected: 2, available: 2051, cap: 200, truncated: true, basis: 'bundled-catalog' },
      matches: [{
        ticker: 'TCS', lastDate: '2026-11-18', lastClose: 100, changePercent: 1, score: 1, matchedRules: [{ rule: 'rsi2 < 30' }],
        provenance: fakeSeries({ hit: true, incremental: false, bars: 60, candleRequests: 0 }).provenance,
      }],
      nearMatches: [{
        ticker: 'INFY', lastClose: 200, changePercent: -1, unmatchedRules: [{ rule: 'rsi2 < 30' }],
        provenance: fakeSeries({ hit: false, incremental: true, bars: 60, candleRequests: 1 }).provenance,
      }],
      warnings: [],
    };
    const { get } = await setup({ jobs: { enqueue: vi.fn(), get: () => ({ id: 'scan5', kind: 'scan', status: 'succeeded', result }) } });
    const summary = await get('get_scan_result').execute({ jobId: 'scan5' }, context());
    expect(summary.output?.status).toBe('succeeded');
    expect(summary.output?.evaluated).toBe(2);
    expect(summary.output?.universeMembership).toMatchObject({ available: 2051, truncated: true });
    expect(summary.output?.cacheCoverage).toMatchObject({ retainedRows: 2, cached: 1, incremental: 1, fetched: 0, candleRequests: 1 });
    expect(summary.output?.matches[0].cache).toMatchObject({ hit: true, bars: 60 });
  });

  it('maps loader cache provenance into quote, history, indicator and check results', async () => {
    const series = fakeSeries({ hit: true, incremental: false, bars: 1100, candleRequests: 0 });
    const loadSeries = vi.fn(async () => series as never);
    const { get } = await setup({ loadSeries, dataMode: 'real' });

    const quote = await get('get_quote').execute({ symbols: ['TCS'] }, context());
    expect(quote.output?.status).toBe('ok');
    expect(quote.output?.quotes[0]).toMatchObject({
      ticker: 'TCS', closeBasis: 'latest-observed-daily-close', sourceKind: 'cache',
      cache: { hit: true, incremental: false, bars: 1100, lastFetchAt: '2026-11-18T10:00:00.000Z', candleRequests: 0 },
    });
    expect(quote.output?.quotes[0].liveLtp).toBeUndefined();
    expect(String(quote.output?.note)).toMatch(/never a live price/i);

    const history = await get('get_price_history').execute({ symbol: 'TCS', lookbackDays: 30 }, context());
    expect(history.output).toMatchObject({ status: 'ok', sourceKind: 'cache', freshness: 'cached-observation' });
    expect(history.output?.cache).toMatchObject({ hit: true, bars: 1100 });

    const indicators = await get('compute_indicators').execute({ symbol: 'TCS', indicators: [{ id: 'sma20', type: 'SMA', params: { period: 20 } }] }, context());
    expect(indicators.output).toMatchObject({ status: 'ok', sourceKind: 'cache' });
    expect(indicators.output?.cache).toMatchObject({ hit: true, bars: 1100 });

    const checked = await get('check_symbol').execute({ symbol: 'TCS', strategy }, context());
    expect(checked.output).toMatchObject({ status: 'ok', sourceKind: 'cache', freshness: 'cached-observation' });
    expect(checked.output?.cache).toMatchObject({ hit: true, bars: 1100 });
  });

  it('scanner honors maxSymbols as an evaluation cap, not pagination', async () => {
    const { scanUniverseAsync } = await import('../../server/backtest/scanner');
    const result = await scanUniverseAsync(strategy, 'NIFTY_50', { mode: 'demo', maxSymbols: 3 });
    expect(result.attempted).toBe(3);
    expect(result.requested).toBe(3);
    expect(result.warnings.join(' ')).toMatch(/first 3 of \d+ resolved symbols/);
  });

  it('teaches the cache-first, bounded-scan workflow in the system prompt', () => {
    expect(ENGINE_SYSTEM_PROMPT).toMatch(/call get_data_cache once/);
    expect(ENGINE_SYSTEM_PROMPT).toMatch(/Why didn't X match\?/);
    expect(ENGINE_SYSTEM_PROMPT).toMatch(/check_symbol/);
    expect(ENGINE_SYSTEM_PROMPT).toMatch(/near-misses/);
    expect(ENGINE_SYSTEM_PROMPT).toMatch(/first 200 of 2,051/);
    expect(ENGINE_SYSTEM_PROMPT).toMatch(/never claim full-universe coverage/i);
    expect(ENGINE_SYSTEM_PROMPT).toMatch(/without writing a progress paragraph/);
    expect(ENGINE_SYSTEM_PROMPT).toMatch(/state an ETA only when the tool computed one/i);
    expect(ENGINE_SYSTEM_PROMPT).toMatch(/Quotes are not cached/);
    expect(ENGINE_SYSTEM_PROMPT).toMatch(/close is the latest observed daily close, never live/i);
  });
});
