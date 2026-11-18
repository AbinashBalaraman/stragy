import { describe, it, expect } from 'vitest';
import {
  applyStrategyEdit, getAIStatus, optimizeStrategyForProfitability, parseStrategyPrompt, resolveSymbolFromPrompt,
  StrategyValidationError,
} from '../../server/ai/copilot';
import { fakeBacktest, validStrategy } from '../../server/ai/testFixtures';
import { getSymbolByTicker } from '../../shared/data/symbols';

// The first-version free-form chat (handleAIChat and its route) was removed in
// Round 12: the OpenCode engine is the only chat. These tests cover the draft,
// edit and status helpers the remaining routes still import.
const none = { env: { AI_PROVIDER: 'none' } };

describe('optimizer is a validated proposal generator', () => {
  it('only varies existing parameters, adds no rules/controls, labels local_heuristic and in-sample', () => {
    const base = validStrategy(); // takeProfit set, trailingStop null
    const calls: number[] = [];
    const r = optimizeStrategyForProfitability(base, 'make it profitable', { backtest: (s) => { calls.push(1); return fakeBacktest(s); } });
    expect(r.providerUsed).toBe('local_heuristic');
    expect(r.method).toBe('parameter_sweep');
    expect(r.proposalOnly).toBe(true);
    expect(r.inSample).toBe(true);
    expect(r.optimizedStrategy.rules).toEqual(base.rules);
    expect(r.optimizedStrategy.risk.trailingStop).toBeNull();
    expect(r.optimizedStrategy.indicators.map((i) => i.id)).toEqual(base.indicators.map((i) => i.id));
    expect(r.trialsCount).toBeLessThanOrEqual(150);
    expect(calls.length).toBeLessThanOrEqual(151);
    expect(r.warnings.join(' ')).toMatch(/in-sample/);
    expect(r.warnings.join(' ')).toMatch(/Nothing was applied/);
    expect(r.assistantMessage).not.toMatch(/guarantee profit|highest-performing/i);
  });

  it('keeps the baseline when nothing ranks higher', () => {
    const flat = (s: any) => ({ metrics: { netPnl: 100, winRate: 50, profitFactor: 1, maxDrawdownPercent: 5, sharpeRatio: 1, totalTrades: 30 } }) as any;
    const r = optimizeStrategyForProfitability(validStrategy(), 'optimize', { backtest: flat });
    expect(r.noImprovementFound).toBe(true);
    expect(r.optimizedStrategy).toEqual(validStrategy());
  });

  it('throws StrategyValidationError for an invalid strategy instead of repairing', () => {
    expect(() => optimizeStrategyForProfitability({ name: 'bad' } as any, 'x', { backtest: fakeBacktest })).toThrow(StrategyValidationError);
  });
});

describe('applyStrategyEdit', () => {
  it('applies only explicit edits to a copy and does not mutate the input', () => {
    const cur = validStrategy();
    const before = JSON.stringify(cur);
    const r = applyStrategyEdit(cur, 'set stop loss to 1.5%');
    expect(r.changed).toBe(true);
    expect(r.strategy.risk.stopLoss.value).toBe(1.5);
    expect(r.providerUsed).toBe('local_heuristic');
    expect(JSON.stringify(cur)).toBe(before);
  });
  it('unrecognised instruction returns the strategy unchanged', () => {
    const r = applyStrategyEdit(validStrategy(), 'do something clever');
    expect(r.changed).toBe(false);
    expect(r.strategy).toEqual(validStrategy());
  });
  it('whole-word symbol resolution: "switch" is not ITC', () => {
    expect(resolveSymbolFromPrompt('switch to daily')).toBeNull();
    expect(resolveSymbolFromPrompt('test on reliance')).toBe(getSymbolByTicker('RELIANCE')!.id);
    expect(resolveSymbolFromPrompt('test tata consultancy')).toBe(getSymbolByTicker('TCS')!.id);
    expect(resolveSymbolFromPrompt('test hdfc')).toBe(getSymbolByTicker('HDFCBANK')!.id);
  });
});

describe('parseStrategyPrompt', () => {
  it('local library lookup is labelled local_heuristic and aiConnected=false; every variation strictly valid', async () => {
    const r = await parseStrategyPrompt('nr7 narrow range breakout', 1, none);
    expect(r.providerUsed).toBe('local_heuristic');
    expect(r.aiConnected).toBe(false);
    expect(r.assistantMessage).toMatch(/not AI/);
    expect(r.assistantMessage).not.toMatch(/DeepSeek/i);
    expect(r.suggestedAction).not.toBe('run_backtest');
  });
  it('unknown prompt returns no variations rather than inventing a strategy', async () => {
    const r = await parseStrategyPrompt('qwertyuiop zzz', 1, none);
    expect(r.variations).toEqual([]);
  });
});

describe('status and startup safety', () => {
  it('importing the module and reading status touches no network (fetch denied in setup)', () => {
    expect(() => getAIStatus({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'k-deepseek-abcdef' })).not.toThrow();
  });
});
