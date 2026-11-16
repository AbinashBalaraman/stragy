import { describe, expect, it } from 'vitest';
import {
  AIChainUpdateInputSchema, AIProviderWriteInputSchema, DEFAULT_USER_PREFERENCES, FeatureSetupRequestSchema,
  FeatureSetupResponseSchema, FEATURE_REGISTRY, MarketScannerInputSchema, StrategyTesterInputSchema,
  TesterPrefillSchema, UserPreferencesSchema, buildChatDraft, getFeature, type TesterPrefill,
} from '../../shared/contracts/featureRegistry';
import { UNIVERSE_OPTIONS } from '../../shared/data/symbols';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import { validateStrategy } from '../../shared/strategy/schema';
import { StrategySchema } from '../../shared/strategy/schema';
import { resolveFeatureSetup } from '../../server/ai/featureSetup';
import { readPreferences, rememberPreference, writePreferences, PREFERENCES_STORAGE_KEY } from '../../client/preferences';
import { parseChatDraft, parseFeaturePrefill } from '../../client/featureHandoff';

const NOW = new Date('2026-11-16T12:00:00.000Z');
const base = () => validateStrategy(STRATEGY_TEMPLATES[0].strategy).data!;
const baseInput = () => StrategySchema.parse(STRATEGY_TEMPLATES[0].strategy);

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('feature registry', () => {
  it('describes every feature with schema-derived inputs, setup steps, limits and an API/action', () => {
    expect(new Set(FEATURE_REGISTRY.map(feature => feature.id)).size).toBe(FEATURE_REGISTRY.length);
    for (const feature of FEATURE_REGISTRY) {
      expect(feature.inputs.length).toBeGreaterThan(0);
      expect(feature.setupSteps.length).toBeGreaterThan(0);
      expect(feature.limits.length).toBeGreaterThan(0);
      expect(feature.triggers.length).toBeGreaterThan(0);
      expect(feature.api.kind === 'route' ? !!feature.api.path : !!feature.api.action).toBe(true);
      for (const input of feature.inputs) expect(input.key).not.toBe('');
    }
  });

  it('derives tester defaults and allowed values from the same schemas that validate the hand-off', () => {
    const tester = getFeature('strategy_tester');
    expect(tester.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'strategy', required: true, type: 'object' }),
      expect.objectContaining({ key: 'initialCapital', type: 'number', default: 100_000, minimum: 100 }),
      expect.objectContaining({ key: 'robustness', type: 'boolean', default: false }),
    ]));
    const scanner = getFeature('market_scanner');
    expect(scanner.inputs.find(input => input.key === 'universe')?.allowedValues).toEqual(UNIVERSE_OPTIONS.map(option => option.id));
    expect(scanner.inputs.find(input => input.key === 'limit')).toMatchObject({ type: 'integer', default: 35, minimum: 1, maximum: 100 });
    const provider = getFeature('provider_settings');
    expect(provider.inputs.find(input => input.key === 'enabled')).toMatchObject({ type: 'boolean', default: true });
    expect(AIProviderWriteInputSchema.safeParse({ label: 'Test', baseUrl: 'https://example.invalid' }).success).toBe(true);
    expect(AIChainUpdateInputSchema.safeParse({ entries: [] }).success).toBe(false);
  });

  it('rejects a setup that the runner would reject', () => {
    const setup = { strategy: baseInput(), initialCapital: 100_000, robustness: false };
    expect(StrategyTesterInputSchema.safeParse(setup).success).toBe(true);
    expect(StrategyTesterInputSchema.safeParse({ ...setup, initialCapital: 99 }).success).toBe(false);
    expect(StrategyTesterInputSchema.safeParse({ ...setup, start: '2026-02-30' }).success).toBe(false);
    expect(MarketScannerInputSchema.safeParse({ universe: 'NO_SUCH_UNIVERSE', strategy: baseInput(), limit: 35 }).success).toBe(false);
  });

  it('validates prefill hand-offs and never accepts an unknown field', () => {
    const prefill: TesterPrefill = {
      feature: 'strategy_tester', strategy: baseInput(), start: '2023-11-17', end: '2026-11-16',
      initialCapital: 100_000, robustness: false, source: 'chat', assumptions: [],
    };
    expect(TesterPrefillSchema.safeParse(prefill).success).toBe(true);
    expect(TesterPrefillSchema.safeParse({ ...prefill, invented: true }).success).toBe(false);
    expect(TesterPrefillSchema.safeParse({ ...prefill, strategy: undefined }).success).toBe(false);
    const draft = buildChatDraft({ prompt: 'Review my current strategy', strategy: baseInput(), source: 'strategy_tester' });
    expect(draft).toMatchObject({ feature: 'chat_draft', prompt: 'Review my current strategy', source: 'strategy_tester' });
    expect(() => buildChatDraft({ prompt: '   ', source: 'strategy_tester' })).toThrow();
    expect(parseFeaturePrefill(prefill)).toMatchObject({ feature: 'strategy_tester' });
    expect(parseFeaturePrefill({ ...prefill, invented: true })).toBeNull();
    expect(parseChatDraft(draft)).toMatchObject({ feature: 'chat_draft', prompt: 'Review my current strategy' });
  });
});

describe('copilot feature setup', () => {
  it('fills a complete Strategy tester setup from a real chat sentence', () => {
    const response = resolveFeatureSetup({
      message: 'Backtest RSI below 30 buy, above 70 sell on Reliance',
      currentStrategy: base(),
    }, { now: NOW });
    expect(response.status).toBe('ready');
    if (response.status !== 'ready' || response.setup.feature !== 'strategy_tester') throw new Error('Expected tester prefill');
    const setup = response.setup;
    expect(setup.strategy.universe).toMatchObject({ ticker: 'RELIANCE', timeframe: '1D' });
    expect(setup.strategy.indicators).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'RSI', params: { period: 14 } })]));
    const rsi = setup.strategy.indicators.find(indicator => indicator.type === 'RSI')!;
    expect(setup.strategy.rules.entry).toEqual([expect.objectContaining({ leftIndicator: rsi.id, operator: 'lt', rightValue: 30 })]);
    expect(setup.strategy.rules.exit).toEqual([expect.objectContaining({ leftIndicator: rsi.id, operator: 'gt', rightValue: 70 })]);
    expect(setup.strategy.costs).toMatchObject({ tradeType: 'DELIVERY', applyIndianTaxes: true });
    expect(setup.strategy.risk.stopLoss).toMatchObject({ type: 'percent', value: 3.5 });
    expect(setup.start).toBe('2023-11-17');
    expect(setup.end).toBe('2026-11-16');
    expect(StrategyTesterInputSchema.safeParse({
      strategy: setup.strategy, start: setup.start, end: setup.end,
      initialCapital: setup.initialCapital, robustness: setup.robustness,
    }).success).toBe(true);
    expect(FeatureSetupResponseSchema.safeParse(response).success).toBe(true);
    expect(validateStrategy(setup.strategy).success).toBe(true);
  });

  it('uses remembered preferences without asking again', () => {
    const response = resolveFeatureSetup({
      message: 'Backtest RSI below 25, sell above 65',
      currentStrategy: base(),
      preferences: { ...DEFAULT_USER_PREFERENCES, lastSymbolId: 46, lastTicker: 'NESTLEIND', riskPercent: 2, costPreset: 'indian-intraday', dateRange: 'last-1y' },
    }, { now: NOW });
    expect(response.status).toBe('ready');
    if (response.status !== 'ready' || response.setup.feature !== 'strategy_tester') throw new Error('Expected tester prefill');
    expect(response.setup.strategy.universe.ticker).toBe('NESTLEIND');
    expect(response.setup.strategy.risk.stopLoss).toMatchObject({ value: 2 });
    expect(response.setup.strategy.costs.tradeType).toBe('INTRADAY');
    expect(response.setup.start).toBe('2025-11-17');
  });

  it('asks exactly one clarifying question when a required value is missing', () => {
    const response = resolveFeatureSetup({ message: 'Backtest RSI below 30, sell above 70', currentStrategy: base() }, { now: NOW });
    expect(response.status).toBe('needs-input');
    if (response.status !== 'needs-input') throw new Error('Expected a question');
    expect(response.question.match(/\?/g)).toHaveLength(1);
    expect(response.question).toMatch(/which nse stock/i);
    expect(response.setup).toBeNull();
  });

  it('does not invent rules when the message has none', () => {
    const response = resolveFeatureSetup({ message: 'Backtest this on Reliance', currentStrategy: base() }, { now: NOW });
    expect(response.status).toBe('needs-input');
    if (response.status !== 'needs-input') throw new Error('Expected a question');
    expect(response.question).toMatch(/entry and exit rules/i);
    expect(response.question.match(/\?/g)).toHaveLength(1);
  });

  it('rejects an invalid request shape without inventing a setup', () => {
    expect(FeatureSetupRequestSchema.safeParse({ message: '' }).success).toBe(false);
    const response = resolveFeatureSetup({ message: '' });
    expect(response.status).toBe('needs-input');
    expect(response.setup).toBeNull();
  });
});

describe('preference memory', () => {
  it('defaults, persists and re-reads remembered choices', () => {
    const storage = memoryStorage();
    expect(readPreferences(storage)).toEqual(DEFAULT_USER_PREFERENCES);
    const stored = rememberPreference({ symbolId: 46, ticker: 'NESTLEIND', riskPercent: 2.5, universe: 'NIFTY_50', costPreset: 'indian-delivery' }, storage);
    expect(stored).toMatchObject({ lastSymbolId: 46, lastTicker: 'NESTLEIND', riskPercent: 2.5, universe: 'NIFTY_50' });
    expect(readPreferences(storage)).toMatchObject({ lastSymbolId: 46, lastTicker: 'NESTLEIND', riskPercent: 2.5 });
  });

  it('ignores corrupt storage instead of leaking an invalid setup', () => {
    const storage = memoryStorage({ [PREFERENCES_STORAGE_KEY]: '{"riskPercent":9999,"unexpected":"pii"}' });
    expect(readPreferences(storage)).toEqual(DEFAULT_USER_PREFERENCES);
    expect(writePreferences({ ...DEFAULT_USER_PREFERENCES, riskPercent: 9999 }, storage)).toBe(false);
    expect(UserPreferencesSchema.safeParse({ ...DEFAULT_USER_PREFERENCES, unexpected: 'pii' }).success).toBe(false);
  });
});
