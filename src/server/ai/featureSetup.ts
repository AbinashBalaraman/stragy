import type { RuleNode, StrategyAST } from '../../shared/strategy/types';
import { validateStrategy } from '../../shared/strategy/schema';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import { ALL_SYMBOLS } from '../../shared/data/symbols';
import {
  DEFAULT_USER_PREFERENCES, FeatureSetupRequestSchema, FeatureSetupResponseSchema,
  MarketScannerInputSchema, StrategyTesterInputSchema, UserPreferencesSchema,
  featureForMessage,
  type FeatureSetupResponse, type FeatureId, type UserPreferences,
} from '../../shared/contracts/featureRegistry';

/**
 * Deterministic copilot setup planner.
 *
 * It reads the feature registry's schemas, fills only fields the user actually
 * supplied plus remembered preferences, validates the complete request against
 * the same schema the runner uses, and asks exactly one question when something
 * required is missing. It never invents a symbol, rule, date or field.
 */

export interface FeatureSetupOptions {
  now?: Date;
}

interface Resolved {
  featureId: FeatureId;
  strategy: StrategyAST;
  symbolId: number;
  ticker: string;
  entry: number;
  exit: number | null;
  rsiPeriod: number;
  assumptions: string[];
}

function pickFeature(message: string): FeatureId {
  return featureForMessage(message)?.id ?? 'strategy_tester';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tickerMatches(message: string): string[] {
  return ALL_SYMBOLS
    .filter(symbol => !symbol.ticker.startsWith('^') && new RegExp('\\b' + escapeRegExp(symbol.ticker) + '\\b', 'i').test(message))
    .map(symbol => symbol.ticker)
    .sort((a, b) => b.length - a.length);
}

function resolveSymbol(message: string, preferences: UserPreferences): { symbolId: number; ticker: string } | null {
  const exact = tickerMatches(message);
  if (exact.length > 0) {
    const ticker = exact[0];
    const symbol = ALL_SYMBOLS.find(candidate => candidate.ticker === ticker);
    if (symbol) return { symbolId: symbol.id, ticker: symbol.ticker };
  }
  if (preferences.lastSymbolId) {
    const remembered = ALL_SYMBOLS.find(symbol => symbol.id === preferences.lastSymbolId);
    if (remembered) return { symbolId: remembered.id, ticker: remembered.ticker };
  }
  return null;
}

function ambiguousSymbol(message: string): string | null {
  if (tickerMatches(message).length > 1) return null;
  const lower = message.toLowerCase();
  const candidates = ALL_SYMBOLS
    .filter(symbol => !symbol.ticker.startsWith('^'))
    .filter(symbol => {
      const firstWord = symbol.name.split(/[\s,]+/)[0]?.toLowerCase();
      return firstWord && firstWord.length >= 3 && lower.includes(firstWord);
    })
    .map(symbol => symbol.ticker);
  const unique = [...new Set(candidates)];
  return unique.length > 1 ? unique.slice(0, 3).join(', ') : null;
}

function rsiThresholds(message: string): { entry: number | null; exit: number | null; period: number } {
  const period = Number(/\brsi\s*\(?\s*(\d{1,3})\s*\)?/i.exec(message)?.[1] ?? 14);
  const entry = Number(
    /\brsi\b[^.;\n]{0,40}?(?:below|under|less\s+than|<)\s*(\d{1,3})/i.exec(message)?.[1]
    ?? /(?:below|under|less\s+than|<)\s*(\d{1,3})[^.;\n]{0,30}?\b(?:buy|enter|long)\b/i.exec(message)?.[1]
    ?? Number.NaN,
  );
  const exit = Number(
    /\brsi\b[^.;\n]{0,40}?(?:above|over|greater\s+than|>)\s*(\d{1,3})/i.exec(message)?.[1]
    ?? /(?:above|over|greater\s+than|>)\s*(\d{1,3})[^.;\n]{0,30}?\b(?:sell|exit|close|short)\b/i.exec(message)?.[1]
    ?? /(?:sell|exit|close)[^.;\n]{0,30}?(?:above|over|greater\s+than|>)\s*(\d{1,3})/i.exec(message)?.[1]
    ?? Number.NaN,
  );
  return {
    entry: Number.isFinite(entry) ? Math.min(99, Math.max(1, Math.trunc(entry))) : null,
    exit: Number.isFinite(exit) ? Math.min(99, Math.max(1, Math.trunc(exit))) : null,
    period: Number.isFinite(period) ? Math.min(100, Math.max(2, Math.trunc(period))) : 14,
  };
}

function cloneStrategy(strategy: StrategyAST): StrategyAST {
  return JSON.parse(JSON.stringify(strategy)) as StrategyAST;
}

function applyPreferences(strategy: StrategyAST, preferences: UserPreferences): StrategyAST {
  const next = cloneStrategy(strategy);
  next.risk = {
    ...next.risk,
    stopLoss: next.risk.stopLoss?.type === 'percent'
      ? { ...next.risk.stopLoss, value: preferences.riskPercent }
      : { type: 'percent', value: preferences.riskPercent },
  };
  if (preferences.costPreset === 'indian-delivery' || preferences.costPreset === 'indian-intraday') {
    next.costs = {
      slippageBps: 5,
      brokerageFlat: 20,
      tradeType: preferences.costPreset === 'indian-intraday' ? 'INTRADAY' : 'DELIVERY',
      applyIndianTaxes: true,
    };
  }
  return next;
}

function buildRsiStrategy(
  base: StrategyAST,
  symbol: { symbolId: number; ticker: string },
  rules: { entry: number; exit: number; period: number },
  preferences: UserPreferences,
): { strategy: StrategyAST; assumptions: string[] } {
  const next = applyPreferences(base, preferences);
  next.name = 'RSI (' + rules.period + ') below ' + rules.entry + ' entry / above ' + rules.exit + ' exit';
  next.description = 'Chat-filled strategy tester setup: buy when RSI(' + rules.period + ') is below ' + rules.entry + ', sell when RSI(' + rules.period + ') is above ' + rules.exit + '.';
  next.universe = {
    ...next.universe,
    symbolId: symbol.symbolId,
    instrumentId: 'legacy:' + symbol.symbolId,
    ticker: symbol.ticker,
    timeframe: '1D',
  };
  let rsiId = 'rsi' + rules.period;
  const existing = next.indicators.find(indicator => indicator.id === rsiId);
  if (existing && (existing.type !== 'RSI' || existing.params.period !== rules.period)) {
    let suffix = 2;
    while (next.indicators.some(indicator => indicator.id === rsiId + '_' + suffix)) suffix++;
    rsiId = rsiId + '_' + suffix;
  }
  if (!next.indicators.some(indicator => indicator.id === rsiId)) {
    next.indicators.push({ id: rsiId, type: 'RSI', params: { period: rules.period } });
  }
  const entry: RuleNode = { leftIndicator: rsiId, operator: 'lt', rightValue: rules.entry };
  const exit: RuleNode = { leftIndicator: rsiId, operator: 'gt', rightValue: rules.exit };
  next.rules = { entry: [entry], exit: [exit] };
  const assumptions = [
    'Entry: RSI(' + rules.period + ') is below ' + rules.entry + ' on the current completed daily bar.',
    'Exit: RSI(' + rules.period + ') is above ' + rules.exit + ' on the current completed daily bar.',
    'Risk: ' + preferences.riskPercent + '% stop loss; your workspace sizing and execution settings are preserved.',
    preferences.costPreset === 'custom'
      ? 'Costs: the workspace custom cost model is preserved.'
      : 'Costs: Indian ' + (preferences.costPreset === 'indian-intraday' ? 'intraday' : 'delivery') + ' preset (5 bps slippage, ₹20 flat brokerage, taxes on).',
  ];
  return { strategy: next, assumptions };
}

function dateWindow(preferences: UserPreferences, now: Date): { start: string; end: string; label: string } {
  const end = now.toISOString().slice(0, 10);
  if (preferences.dateRange === 'custom' && preferences.customStart && preferences.customEnd) {
    return { start: preferences.customStart, end: preferences.customEnd, label: 'Custom window ' + preferences.customStart + ' to ' + preferences.customEnd + '.' };
  }
  const years = preferences.dateRange === 'last-1y' ? 1 : preferences.dateRange === 'last-5y' ? 5 : 3;
  const startDate = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() + 1));
  return {
    start: startDate.toISOString().slice(0, 10),
    end,
    label: 'Window: last ' + years + ' year' + (years === 1 ? '' : 's') + ' (' + startDate.toISOString().slice(0, 10) + ' to ' + end + ').',
  };
}

function needsInput(featureId: FeatureId, question: string, assumptions: string[] = []): FeatureSetupResponse {
  return FeatureSetupResponseSchema.parse({ status: 'needs-input', featureId, setup: null, assumptions, question });
}

function ready(featureId: FeatureId, setup: unknown, assumptions: string[]): FeatureSetupResponse {
  return FeatureSetupResponseSchema.parse({ status: 'ready', featureId, setup, assumptions, question: null });
}

export function resolveFeatureSetup(raw: unknown, options: FeatureSetupOptions = {}): FeatureSetupResponse {
  const parsed = FeatureSetupRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return FeatureSetupResponseSchema.parse({
      status: 'needs-input', featureId: 'strategy_tester', setup: null, assumptions: [],
      question: 'What should I set up? Describe the strategy and the NSE stock.',
    });
  }
  const input = parsed.data;
  const message = input.message;
  const featureId = pickFeature(message);
  const preferences = UserPreferencesSchema.parse({ ...DEFAULT_USER_PREFERENCES, ...input.preferences });
  const now = options.now ?? new Date();

  if (featureId === 'chart_reading') {
    return needsInput(featureId, 'Attach the chart image (PNG, JPEG or WebP up to 5 MB) and I will extract the conditions.', []);
  }
  if (featureId === 'live_quotes') {
    return needsInput(featureId, 'Which NSE symbols should I quote? List up to ten tickers.', []);
  }
  if (featureId === 'saved_strategies') {
    return needsInput(featureId, 'Which exact strategy should I save, and under what name?', []);
  }
  if (featureId === 'comparison_robustness') {
    return needsInput(featureId, 'Which completed backtest should be the baseline, and which run should I compare it with?', []);
  }
  if (featureId === 'provider_settings') {
    return needsInput(featureId, 'Which AI provider and model should I configure, and is it free or explicitly approved as paid?', []);
  }

  const thresholds = rsiThresholds(message);
  if (thresholds.entry === null && thresholds.exit === null) {
    return needsInput(featureId, 'Which exact entry and exit rules should I fill in? For example: RSI below 30 to buy, above 70 to sell.', []);
  }
  if (thresholds.entry === null) {
    return needsInput(featureId, 'What exact entry rule should I use? For example: RSI below 30 to buy.', []);
  }
  if (thresholds.exit === null) {
    return needsInput(featureId, 'What exact exit rule should I use with the entry you described?', []);
  }
  const symbol = resolveSymbol(message, preferences);
  if (!symbol) {
    const ambiguous = ambiguousSymbol(message);
    return needsInput(featureId, ambiguous
      ? 'Which exact NSE ticker did you mean: ' + ambiguous + '?'
      : 'Which NSE stock should I test this on? Reply with one ticker such as RELIANCE.', []);
  }

  const base = input.currentStrategy ?? STRATEGY_TEMPLATES[0].strategy;
  const built = buildRsiStrategy(base, symbol, { entry: thresholds.entry, exit: thresholds.exit, period: thresholds.period }, preferences);
  const validated = validateStrategy(built.strategy);
  if (!validated.success || !validated.data) {
    return needsInput(featureId, 'The filled strategy did not pass validation: ' + (validated.errors?.[0] ?? 'unknown rule error') + '. What should I change?', built.assumptions);
  }
  const strategy = validated.data;
  const window = dateWindow(preferences, now);
  const assumptions = [...built.assumptions, window.label];

  if (featureId === 'market_scanner') {
    const scanInput = { universe: 'NIFTY_50' as const, strategy, limit: 100 };
    const checked = MarketScannerInputSchema.safeParse(scanInput);
    if (!checked.success) {
      return needsInput(featureId, 'The scan setup is missing a valid field: ' + checked.error.issues[0].message + '. Which value should I use?', assumptions);
    }
    return ready(featureId, {
      feature: 'market_scanner' as const,
      ...checked.data,
      source: 'chat' as const,
      assumptions,
    }, assumptions);
  }

  const testerInput = {
    strategy,
    start: window.start,
    end: window.end,
    initialCapital: 100_000,
    robustness: false,
  };
  const checked = StrategyTesterInputSchema.safeParse(testerInput);
  if (!checked.success) {
    return needsInput(featureId, 'The tester setup is missing a valid field: ' + checked.error.issues[0].message + '. Which value should I use?', assumptions);
  }
  return ready(featureId, {
    feature: 'strategy_tester' as const,
    ...checked.data,
    source: 'chat' as const,
    assumptions,
  }, assumptions);
}
