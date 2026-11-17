import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OHLCVBar, StrategyAST } from '../../shared/strategy/types';
import { parseScanResult } from '../../shared/contracts/scanner-results';

const barsFor = (lastClose: number): OHLCVBar[] => Array.from({ length: 40 }, (_, i) => {
  const close = i === 39 ? lastClose : 100 + Math.sin(i) * 2;
  const timestamp = Date.UTC(2026, 0, 1) + i * 86_400_000;
  return { date: new Date(timestamp).toISOString().slice(0, 10), timestamp, open: close, high: close * 1.01, low: close * 0.99, close, volume: 100_000 + i };
});

vi.mock('../../server/data/marketSeries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/data/marketSeries')>();
  return {
    ...actual,
    getMarketSeries: vi.fn((id: number) => {
      if (id === 10) throw new actual.MarketDataError('PROVIDER_UNAVAILABLE', 'Fixture provider failure');
      return {
        bars: barsFor(id === 9 ? 100 : 50),
        provenance: {
          mode: 'demo', source: 'OFFLINE_SCANNER_FIXTURE', symbolId: id, asOf: '2026-02-09', fetchedAt: '2026-02-09T10:00:00Z',
          requestedRange: {}, actualRange: { start: '2026-01-01', end: '2026-02-09' }, adjustment: 'unadjusted', checksum: 'fixture',
          coverage: 'available-history', freshness: 'fixture', warnings: [], calendarVersion: 'fixture',
        },
      };
    }),
  };
});

import { NEAR_MATCH_LIMIT, scanUniverse } from '../../server/backtest/scanner';

afterEach(() => vi.unstubAllEnvs());

const strategy: StrategyAST = {
  name: 'Near-match fixture',
  version: 2,
  universe: { symbolId: 1, timeframe: '1D' },
  indicators: [
    { id: 'rsi14', type: 'RSI', params: { period: 14 } },
    { id: 'vol20', type: 'VOLUME_SMA', params: { period: 20 } },
  ],
  rules: {
    entry: [
      { leftIndicator: 'close', operator: 'gt', rightValue: 0 },
      { leftIndicator: 'rsi14', operator: 'gt', rightValue: 0 },
      { leftIndicator: 'close', operator: 'gt', rightValue: 80 },
    ],
    exit: [],
  },
  risk: { stopLoss: { type: 'percent', value: 2 }, takeProfit: null, trailingStop: null, positionSizing: { type: 'fixedQty', quantity: 1 }, maxDrawdownCutoff: null },
  execution: { allowLong: true, allowShort: false, orderType: 'MARKET' },
  costs: { slippageBps: 0, brokerageFlat: 0, tradeType: 'DELIVERY', applyIndianTaxes: false },
};

describe('scanner near-match ranking', () => {
  it('keeps matches as full AND matches, scores them, and ranks capped near-misses separately', () => {
    vi.stubEnv('DATA_MODE', 'demo');
    const result = scanUniverse(strategy, 'nifty50', 35);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ ticker: 'RELIANCE', score: 1, currency: 'INR' });
    expect(result.matched).toBe(1);
    expect(result.nearMatches).toHaveLength(NEAR_MATCH_LIMIT);
    expect(result.nearMatches.every(m => m.score === 2 / 3)).toBe(true);
    expect(result.nearMatches.some(m => m.ticker === 'RELIANCE')).toBe(false);
    // Deterministic tie-break: score descending, then symbol id ascending.
    const ids = result.nearMatches.map(m => m.symbolId);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(result.nearMatches[0].matchedRules).toHaveLength(2);
    expect(result.nearMatches[0].matchedRules.every(r => typeof r.actualLeft === 'number' && Number.isFinite(r.actualLeft))).toBe(true);
    expect(result.nearMatches[0].indicatorValues).toHaveProperty('rsi14');
    expect(result.nearMatches[0].indicatorValues).not.toHaveProperty('vol20');
    expect(result.nearMatches[0].unmatchedRules).toHaveLength(1);
    expect(result.nearMatches[0].unmatchedRules![0]).toMatchObject({ ruleIndex: 2, currentActualLeft: 50 });
    expect(result.errors.some(error => error.ticker === 'HDFCBANK')).toBe(true);
    const parsed = parseScanResult(result);
    expect(parsed.nearMatches).toHaveLength(NEAR_MATCH_LIMIT);
    expect(parsed.nearMatches![0].unmatchedRules![0].ruleIndex).toBe(2);
  });

  it('does not turn single-rule screens into all-near-match noise', () => {
    vi.stubEnv('DATA_MODE', 'demo');
    const single: StrategyAST = { ...strategy, rules: { ...strategy.rules, entry: [{ leftIndicator: 'close', operator: 'gt', rightValue: 1e12 }] } };
    const result = scanUniverse(single, 'nifty50', 35);
    expect(result.matches).toHaveLength(0);
    expect(result.nearMatches).toHaveLength(0);
  });

  it('reports a missing right-hand series value as null instead of an unparsable NaN', () => {
    vi.stubEnv('DATA_MODE', 'demo');
    const missing: StrategyAST = {
      ...strategy,
      rules: {
        ...strategy.rules,
        entry: [...strategy.rules.entry, { id: 'c4', leftIndicator: 'close', operator: 'gt', rightIndicator: 'absent_line' }],
      },
    };
    const result = scanUniverse(missing, 'nifty50', 35);
    const rule = result.nearMatches.flatMap(match => match.unmatchedRules ?? []).find(entry => entry.rule.includes('absent_line'));
    expect(rule).toMatchObject({ actualRight: null, currentActualRight: null });
    const parsed = parseScanResult(result);
    expect(parsed.nearMatches?.some(match => (match.unmatchedRules ?? []).some(entry => entry.actualRight === null))).toBe(true);
  });
});
