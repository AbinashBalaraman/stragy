import type { StrategyAST, BacktestResponse } from '../../shared/strategy/types';

export function validStrategy(overrides: Partial<StrategyAST> = {}): StrategyAST {
  return {
    id: 'strat_fixture',
    name: 'Fixture SMA cross',
    description: 'fixture',
    version: 1,
    universe: { symbolId: 1, timeframe: '1D' },
    indicators: [
      { id: 'sma_fast', type: 'SMA', params: { period: 10 } },
      { id: 'sma_slow', type: 'SMA', params: { period: 30 } },
    ],
    rules: {
      entry: [{ id: 'e1', leftIndicator: 'sma_fast', operator: 'crossesAbove', rightIndicator: 'sma_slow' }],
      exit: [{ id: 'x1', leftIndicator: 'sma_fast', operator: 'crossesBelow', rightIndicator: 'sma_slow' }],
    },
    risk: {
      stopLoss: { type: 'percent', value: 2 },
      takeProfit: { type: 'percent', value: 6 },
      trailingStop: null,
      positionSizing: { type: 'fixedFraction', fraction: 0.1 },
      maxDrawdownCutoff: null,
    },
    execution: { allowLong: true, allowShort: false, orderType: 'MARKET' },
    costs: { slippageBps: 5, brokerageFlat: 20, tradeType: 'DELIVERY', applyIndianTaxes: true },
    ...overrides,
  };
}

/** Fake backtest: deterministic, rewards a smaller stop loss. No bars/engine involved. */
export function fakeBacktest(s: StrategyAST): BacktestResponse {
  const sl = s.risk.stopLoss.value;
  return {
    metrics: {
      netPnl: 1000 - sl * 100, winRate: 50, profitFactor: 1.5, maxDrawdownPercent: sl, sharpeRatio: 1 - sl / 10, totalTrades: 40,
    },
  } as unknown as BacktestResponse;
}

export interface FakeResponseInit { status?: number; body?: unknown; raw?: string }
export function fakeResponse({ status = 200, body, raw }: FakeResponseInit) {
  const text = raw ?? JSON.stringify(body ?? {});
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => text, json: async () => JSON.parse(text) };
}

export function openAIBody(content: string, extra: Record<string, unknown> = {}) {
  return { choices: [{ message: { content, ...extra }, finish_reason: 'stop' }] };
}

export function recordingFetch(handler: (url: string, init: any) => any) {
  const calls: { url: string; init: any }[] = [];
  const fn = async (url: string, init: any) => { calls.push({ url, init }); return handler(url, init); };
  return Object.assign(fn, { calls });
}

export const READY_ENV = { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key-openai-0001', AI_MODEL: 'gpt-test' } as const;
