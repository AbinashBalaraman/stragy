import { describe, expect, it, vi } from 'vitest';
import { createEnginePlugin, EngineContextStore, type EngineToolDeps } from '../../server/ai/engineTools';
import { ApprovalStore } from '../../server/ai/engineApprovals';
import { getSymbolByTicker } from '../../server/data/symbols';
import { validateStrategy } from '../../shared/strategy/schema';
import type { ResearchPayload } from '../../server/jobs/manager';

type Tool = {
  name: string;
  input: { safeParse: (value: unknown) => { success: boolean } };
  execute: (input: unknown, context: unknown) => Promise<{ output?: Record<string, any> }>;
};

const baseStrategyRaw = {
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
const validated = validateStrategy(baseStrategyRaw);
if (!validated.success) throw new Error('fixture strategy invalid');
const strategy = validated.data!;

async function setup(overrides: Partial<EngineToolDeps> = {}) {
  const tools: Tool[] = [];
  const deps: EngineToolDeps = { dataMode: 'demo', approvals: new ApprovalStore(), contexts: new EngineContextStore(), ...overrides };
  const entries = new Map<string, unknown>();
  const sessionApi = {
    instructions: {
      entry: {
        list: async () => [...entries.entries()].map(([key, value]) => ({ key, value })),
        put: async ({ key, value }: { key: string; value: unknown }) => { entries.set(key, value); },
      },
    },
  };
  const plugin = createEnginePlugin(() => deps);
  await plugin.setup({
    session: sessionApi,
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
  return { tools, deps, sessionApi, get: (name: string) => tools.find(tool => tool.name === name)! };
}

const context = (sessionID = 's1') => ({ sessionID, agent: 'stragy', messageID: 'm1', id: 'call_1', signal: new AbortController().signal, progress: async () => undefined });

function jobsOf(view: Record<string, unknown> | undefined) {
  const enqueue = vi.fn((_payload: ResearchPayload) => ({ id: 'job1', kind: 'scan', status: 'queued' }));
  const get = vi.fn(() => view);
  return { jobs: { enqueue, get }, enqueue, get };
}

describe('expanded engine research tools', () => {
  it('registers the complete toolset with unique names and validated inputs', async () => {
    const { tools } = await setup();
    const names = tools.map(tool => tool.name);
    expect(names).toHaveLength(28);
    expect(new Set(names).size).toBe(28);
    expect(names).toEqual(expect.arrayContaining([
      'read_chart', 'get_chart_result', 'scan_market', 'get_scan_result', 'list_universes', 'list_indicators',
      'get_data_cache', 'refresh_market_data', 'get_refresh_result',
      'search_symbols', 'get_symbol_info', 'get_quote', 'get_price_history', 'compute_indicators', 'market_overview',
      'get_market_result', 'check_symbol', 'explain_match', 'get_current_strategy', 'validate_strategy',
      'list_strategy_templates', 'list_saved_strategies', 'load_saved_strategy', 'propose_strategy_edit',
      'run_backtest', 'get_backtest_result', 'remember_preference', 'get_preferences',
    ]));
    for (const tool of tools) expect(typeof tool.input.safeParse).toBe('function');
  });

  it('lists universes and indicators with bounds and copyable examples', async () => {
    const { get } = await setup();
    const universes = await get('list_universes').execute({}, context());
    expect(universes.output?.status).toBe('ok');
    expect(universes.output?.universes.some((item: any) => item.id === 'NIFTY_50')).toBe(true);
    expect(universes.output?.universes.every((item: any) => typeof item.symbols === 'number')).toBe(true);
    const indicators = await get('list_indicators').execute({}, context());
    expect(indicators.output?.indicators.map((item: any) => item.type)).toContain('RSI');
    expect(indicators.output?.indicators.find((item: any) => item.type === 'RSI').example).toMatchObject({ id: 'rsi14', params: { period: 14 } });
    expect(indicators.output?.priceSeries).toContain('close');
  });

  it('searches symbols and returns metadata without prices', async () => {
    const { get } = await setup();
    const found = await get('search_symbols').execute({ query: 'TCS' }, context());
    expect(found.output?.symbols[0]).toMatchObject({ ticker: 'TCS' });
    expect(found.output?.symbols[0].currentPrice).toBeUndefined();
    const info = await get('get_symbol_info').execute({ symbol: 'TCS' }, context());
    expect(info.output?.symbol).toMatchObject({ ticker: 'TCS', exchange: 'NSE' });
    const missing = await get('get_symbol_info').execute({ symbol: 'NOT_A_TICKER' }, context());
    expect(missing.output).toMatchObject({ status: 'failed', error: { code: 'UNKNOWN_SYMBOL' } });
  });

  it('bounds quote and history inputs at the schema level', async () => {
    const { get } = await setup();
    expect(get('get_quote').input.safeParse({ symbols: Array.from({ length: 21 }, () => 'TCS') }).success).toBe(false);
    expect(get('get_quote').input.safeParse({ symbols: ['TCS'] }).success).toBe(true);
    expect(get('get_price_history').input.safeParse({ symbol: 'TCS', lookbackDays: 751 }).success).toBe(false);
    expect(get('get_price_history').input.safeParse({ symbol: 'TCS', lookbackDays: 750 }).success).toBe(true);
    expect(get('compute_indicators').input.safeParse({ symbol: 'TCS', indicators: [{ id: 'x', type: 'RSI', params: { period: 0 } }] }).success).toBe(false);
  });

  it('reads demo daily bars for a quote and a bounded history with provenance', async () => {
    const { get } = await setup();
    const quote = await get('get_quote').execute({ symbols: ['TCS'] }, context());
    expect(quote.output?.status).toBe('ok');
    expect(quote.output?.quotes[0]).toMatchObject({ ticker: 'TCS', delayed: true });
    expect(typeof quote.output?.quotes[0].close).toBe('number');
    expect(quote.output?.quotes[0].source).toBeTruthy();
    const history = await get('get_price_history').execute({ symbol: 'TCS', lookbackDays: 60 }, context());
    expect(history.output?.status).toBe('ok');
    expect(history.output?.summary.sessions).toBe(60);
    expect(history.output?.bars.length).toBeLessThanOrEqual(30);
    expect(history.output?.droppedBars).toBe(30);
    expect(history.output?.provenance.source).toBeTruthy();
    const unknown = await get('get_price_history').execute({ symbol: 'ZZZZ' }, context());
    expect(unknown.output).toMatchObject({ status: 'failed', error: { code: 'UNKNOWN_SYMBOL' } });
  });

  it('computes indicators and checks per-condition pass/fail on a symbol', async () => {
    const { get } = await setup();
    const computed = await get('compute_indicators').execute({ symbol: 'TCS', indicators: [{ id: 'sma20', type: 'SMA', params: { period: 20 } }] }, context());
    expect(computed.output?.status).toBe('ok');
    expect(computed.output?.indicators[0]).toMatchObject({ indicatorId: 'sma20', type: 'SMA' });
    expect(computed.output?.indicators[0].recent).toHaveLength(5);
    const checked = await get('check_symbol').execute({ symbol: 'TCS', strategy }, context());
    expect(checked.output?.status).toBe('ok');
    expect(checked.output?.conditions).toHaveLength(1);
    expect(checked.output?.conditions[0].line).toMatch(/rsi2=.*(<|>)/);
    expect(typeof checked.output?.conditions[0].matched).toBe('boolean');
    const noStrategy = await get('check_symbol').execute({ symbol: 'TCS' }, context());
    expect(noStrategy.output).toMatchObject({ status: 'failed', error: { code: 'STRATEGY_REQUIRED' } });
  });

  it('explains a retained scan match and stays honest when the symbol is not retained', async () => {
    const result = {
      universe: 'NIFTY_50', matched: 1, requested: 2, succeeded: 2, unavailable: 0, failed: 0,
      matches: [{ symbolId: getSymbolByTicker('TCS')!.id, ticker: 'TCS', lastClose: 100, lastDate: '2026-09-30', matchedRules: [{ rule: 'rsi2 < 30' }], unmatchedRules: [], indicatorValues: {} }],
      nearMatches: [],
    };
    const { get } = await setup({ jobs: jobsOf({ id: 'scan1', kind: 'scan', status: 'succeeded', result }).jobs as never });
    const matched = await get('explain_match').execute({ jobId: 'scan1', symbol: 'TCS' }, context());
    expect(matched.output).toMatchObject({ status: 'matched', symbol: 'TCS' });
    const missing = await get('explain_match').execute({ jobId: 'scan1', symbol: 'INFY' }, context());
    expect(missing.output).toMatchObject({ status: 'not_in_scan' });
    const noJobs = await setup({ jobs: { enqueue: vi.fn(), get: () => undefined } });
    const unknownJob = await noJobs.get('explain_match').execute({ jobId: 'nope', symbol: 'TCS' }, context());
    expect(unknownJob.output).toMatchObject({ status: 'failed', error: { code: 'JOB_NOT_FOUND' } });
  });

  it('validates and proposes strategies from both objects and JSON strings', async () => {
    const { get } = await setup();
    const valid = await get('validate_strategy').execute({ strategy }, context());
    expect(valid.output?.status).toBe('valid');
    expect(valid.output?.summary.entryRules).toBe(1);
    const invalid = await get('validate_strategy').execute({ strategy: { name: 'Broken' } }, context());
    expect(invalid.output?.status).toBe('invalid');
    expect(invalid.output?.errors.length).toBeGreaterThan(0);
    const proposed = await get('propose_strategy_edit').execute({ candidate: JSON.stringify(strategy), rationale: 'Tighten it.', changes: ['RSI 2'] }, context());
    expect(proposed.output?.status).toBe('ok');
    expect(proposed.output?.proposal.applied).toBe(false);
    const rejected = await get('propose_strategy_edit').execute({ candidate: '{"name":"Broken"}', rationale: 'Bad.' }, context());
    expect(rejected.output).toMatchObject({ status: 'failed', error: { code: 'INVALID_STRATEGY' } });
  });

  it('lists and loads saved strategies read-only', async () => {
    const record = { id: 'saved-1', revision: 2, strategy, updatedAt: '2026-09-30T00:00:00.000Z' };
    const repository = { listStrategies: () => [record], getStrategy: (id: string) => id === 'saved-1' ? record : undefined };
    const { get } = await setup({ repository });
    const listed = await get('list_saved_strategies').execute({}, context());
    expect(listed.output?.strategies[0]).toMatchObject({ id: 'saved-1', revision: 2 });
    const loaded = await get('load_saved_strategy').execute({ id: 'saved-1' }, context());
    expect(loaded.output?.strategy.name).toBe(strategy.name);
    const missing = await get('load_saved_strategy').execute({ id: 'nope' }, context());
    expect(missing.output).toMatchObject({ status: 'failed', error: { code: 'STRATEGY_NOT_FOUND' } });
  });

  it('round-trips session preferences through instruction entries', async () => {
    const { get } = await setup();
    const saved = await get('remember_preference').execute({ key: 'risk_tolerance', value: 'moderate', note: 'Stated by the operator.' }, context());
    expect(saved.output?.status).toBe('ok');
    const read = await get('get_preferences').execute({}, context());
    expect(read.output?.preferences).toEqual([{ key: 'risk_tolerance', value: 'moderate', note: 'Stated by the operator.', updatedAt: expect.any(String) }]);
  });

  it('queues and summarizes a market overview through the jobs manager', async () => {
    const result = {
      universe: 'NIFTY_50', coverage: { requested: 2, succeeded: 2, unavailable: 0 }, status: 'complete',
      trends: [{ ticker: 'AAA', changePercent: 2, trendLabel: 'Bullish' }, { ticker: 'BBB', changePercent: -1, trendLabel: 'Bearish' }],
      sourceCoverage: { DEMO: 2 }, warnings: [],
    };
    const { get } = await setup({ jobs: jobsOf({ id: 'm1', kind: 'market', status: 'succeeded', result }).jobs as never });
    const queued = await get('market_overview').execute({ universe: 'NIFTY_50' }, context());
    expect(queued.output).toMatchObject({ status: 'queued', jobId: 'job1' });
    const summary = await get('get_market_result').execute({ jobId: 'job1' }, context());
    expect(summary.output?.status).toBe('succeeded');
    expect(summary.output?.topGainers[0]).toMatchObject({ ticker: 'AAA' });
    expect(summary.output?.breadth).toMatchObject({ advances: 1, declines: 1 });
  });

  it('queues a scan and summarizes coverage, matches and near-misses', async () => {
    const scanResult = {
      universe: 'NIFTY_50', matched: 1, requested: 3, succeeded: 3, unavailable: 0, failed: 0, status: 'complete',
      matches: [{ ticker: 'TCS', lastDate: '2026-09-30', lastClose: 100, changePercent: 1, score: 1, matchedRules: [{ rule: 'rsi2 < 30' }] }],
      nearMatches: [{ ticker: 'INFY', lastClose: 200, changePercent: -1, unmatchedRules: [{ rule: 'rsi2 < 30' }] }],
      warnings: ['Partial coverage note'], observationDates: { earliest: '2026-01-01', latest: '2026-09-30', staleSymbols: 0 },
    };
    const enqueue = vi.fn(() => ({ id: 'scan9', kind: 'scan', status: 'queued' }));
    const { get } = await setup({ jobs: { enqueue, get: () => ({ id: 'scan9', kind: 'scan', status: 'succeeded', result: scanResult }) } });
    const queued = await get('scan_market').execute({ universe: 'NIFTY_50', strategy }, context());
    expect(queued.output).toMatchObject({ status: 'queued', jobId: 'scan9', universe: 'NIFTY_50' });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'scan', universe: 'NIFTY_50', mode: 'demo' }));
    const result = await get('get_scan_result').execute({ jobId: 'scan9' }, context());
    expect(result.output).toMatchObject({ status: 'succeeded', matched: 1, coverage: { requested: 3, succeeded: 3 } });
    expect(result.output?.nearMatches[0]).toMatchObject({ ticker: 'INFY' });
  });

  it('reads the staged workspace strategy and lists built-in templates', async () => {
    const contexts = new EngineContextStore();
    contexts.setContext('s1', { currentStrategy: strategy });
    const { get } = await setup({ contexts });
    const current = await get('get_current_strategy').execute({}, context());
    expect(current.output).toMatchObject({ status: 'ok' });
    expect(current.output?.strategy.name).toBe(strategy.name);
    const templates = await get('list_strategy_templates').execute({}, context());
    expect(templates.output?.status).toBe('ok');
    expect(templates.output?.templates.length).toBeGreaterThan(0);
    expect(templates.output?.templates[0]).toHaveProperty('strategy');
  });

  it('summarizes a finished backtest and remembers the run', async () => {
    const remembered = vi.fn(async () => undefined);
    const metrics = { totalReturnPercent: 4.2, netPnl: 4200, cagr: 2, sharpeRatio: 0.8, maxDrawdownPercent: 6, totalTrades: 12, winRate: 50, profitFactor: 1.4, benchmarkReturnPercent: 1, alpha: 3 };
    const result = { metrics, symbol: { ticker: 'TCS', name: 'TCS' }, executedAt: '2026-09-30T00:00:00.000Z', warnings: [], provenance: { source: 'DEMO', mode: 'demo', actualRange: { start: '2024-01-01', end: '2026-09-30' } } };
    const { get } = await setup({
      jobs: { enqueue: vi.fn(), get: () => ({ id: 'bt2', kind: 'backtest', status: 'succeeded', result }) },
      rememberRun: remembered,
    });
    const summary = await get('get_backtest_result').execute({ jobId: 'bt2' }, context());
    expect(summary.output).toMatchObject({ status: 'succeeded', kind: 'backtest', metrics: { totalReturnPercent: 4.2, totalTrades: 12 } });
    expect(remembered).toHaveBeenCalledTimes(1);
  });

  it('accepts a JSON-string strategy for an approved backtest and consumes the token once', async () => {
    const enqueue = vi.fn(() => ({ id: 'bt1', kind: 'backtest', status: 'queued' }));
    const { get, deps } = await setup({
      jobs: { enqueue, get: () => undefined },
      prepareBacktest: async () => ({ kind: 'backtest', strategy, bars: [] } as unknown as ResearchPayload),
    });
    const run = get('run_backtest');
    const first = await run.execute({ strategy: JSON.stringify(strategy), initialCapital: 100000 }, context());
    expect(first.output?.status).toBe('approval_required');
    deps.approvals.decide(String(first.output?.approvalId), 'approve');
    const second = await run.execute({ strategy: JSON.stringify(strategy), initialCapital: 100000 }, context());
    expect(second.output?.status).toBe('queued');
    expect(enqueue).toHaveBeenCalledTimes(1);
    const third = await run.execute({ strategy: JSON.stringify(strategy), initialCapital: 100000 }, context());
    expect(third.output?.status).toBe('approval_required');
  });
});
