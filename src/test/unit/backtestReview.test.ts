import { describe, expect, it } from 'vitest';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import { canonicalStrategySignature, describeBacktestAssumptions, exitRuleCompatibility } from '../../shared/strategy/backtestReview';
import { validateStrategy } from '../../shared/strategy/schema';
import type { StrategyAST } from '../../shared/strategy/types';

const base = STRATEGY_TEMPLATES[0].strategy;

describe('plain-English backtest assumption review', () => {
  it('states exits, risk, sizing, execution, capital and costs before consent', () => {
    const review = describeBacktestAssumptions(base, { sourceLabel: 'Read-only screen “test”', asOf: '2026-10-15' });

    expect(review.sourceLabel).toBe('Read-only screen “test”');
    expect(review.entrySummary.length).toBeGreaterThan(0);
    expect(review.exitSummary.length).toBeGreaterThan(0);
    expect(review.riskSummary.join(' ')).toMatch(/Stop loss/i);
    expect(review.riskSummary.join(' ')).toMatch(/Take profit|none/i);
    expect(review.sizingSummary.length).toBeGreaterThan(0);
    expect(review.executionSummary).toMatch(/never sends a broker order/i);
    expect(review.capitalSummary).toContain('₹1,00,000');
    expect(review.capitalSummary).toMatch(/engine default/i);
    expect(review.costSummary).toMatch(/slippage/i);
    expect(review.costSummary).toMatch(/brokerage/i);
    expect(review.dataWindow).toContain('2026-10-15');
    expect(review.defaults.join(' ')).toContain('data cutoff');
    expect(review.limitations.join(' ')).toMatch(/not investment advice/i);
    expect(review.limitations.join(' ')).toMatch(/statutory fee accuracy are not verified/i);
  });

  it('marks explicitly supplied capital as explicit, not as an engine default', () => {
    const review = describeBacktestAssumptions(base, { sourceLabel: 'Draft', initialCapital: 250000 });

    expect(review.capitalSummary).toContain('₹2,50,000');
    expect(review.capitalSummary).toMatch(/explicitly supplied/i);
    expect(review.defaults.join(' ')).not.toMatch(/Starting capital defaults/);
  });

  it('does not invent a take profit when none is configured', () => {
    const strategy = { ...base, risk: { ...base.risk, takeProfit: null, trailingStop: null } };
    const review = describeBacktestAssumptions(strategy, { sourceLabel: 'Draft' });

    expect(review.riskSummary.join(' ')).toMatch(/Take profit: none/i);
    expect(review.riskSummary.join(' ')).toMatch(/Trailing stop: none/i);
    expect(review.dataWindow).toMatch(/latest completed daily session/i);
  });

  it('describes the exact stop distance and position-sizing modes in plain English', () => {
    const percent = describeBacktestAssumptions({
      ...base,
      risk: { ...base.risk, stopLoss: { type: 'percent', value: 3 }, positionSizing: { type: 'fixedFraction', fraction: 0.1 } },
    }, { sourceLabel: 'Draft' });
    expect(percent.riskSummary[0]).toBe('Stop loss: 3% below the entry price.');
    expect(percent.sizingSummary).toContain('10%');

    const quantity = describeBacktestAssumptions({
      ...base,
      risk: { ...base.risk, stopLoss: { type: 'points', value: 25 }, positionSizing: { type: 'fixedQty', quantity: 4 } },
    }, { sourceLabel: 'Draft' });
    expect(quantity.riskSummary[0]).toBe('Stop loss: 25 price points below the entry price.');
    expect(quantity.sizingSummary).toContain('4 whole units');
    expect(quantity.sizingSummary).toMatch(/run fails/i);

    const riskSized = describeBacktestAssumptions({
      ...base,
      risk: { ...base.risk, positionSizing: { type: 'fixedRisk', riskPerTrade: 0.01 } },
    }, { sourceLabel: 'Draft' });
    expect(riskSized.sizingSummary).toMatch(/risks 1%/);
    expect(riskSized.sizingSummary).toContain('available cash');
    expect(riskSized.sizingSummary).not.toContain('current equity');
  });

  it('describes the engine as long-only daily market orders and does not claim short, limit or intraday support', () => {
    const review = describeBacktestAssumptions({
      ...base,
      execution: { ...base.execution, allowShort: true, orderType: 'LIMIT', intradaySquareOffTime: '15:15', liquidateAtEnd: false },
    }, { sourceLabel: 'Draft' });

    expect(review.executionSummary).toMatch(/long-only/i);
    expect(review.executionSummary).toMatch(/short entries are not executed/i);
    expect(review.executionSummary).toMatch(/LIMIT order settings are not executed/i);
    expect(review.executionSummary).toMatch(/Intraday square-off at 15:15 is not supported/i);
    expect(review.executionSummary).toMatch(/End-of-data liquidation is disabled/i);
    expect(review.executionSummary).toMatch(/marked to the final close/i);
    expect(review.executionSummary).not.toMatch(/short entries are also allowed/i);
    expect(review.executionSummary).not.toMatch(/squared off at/i);
  });

  it('states the default end-of-data liquidation and drawdown break behaviour, including gap and fee limits', () => {
    const review = describeBacktestAssumptions({
      ...base,
      risk: { ...base.risk, maxDrawdownCutoff: 10 },
      execution: { ...base.execution, liquidateAtEnd: undefined },
    }, { sourceLabel: 'Draft' });

    expect(review.executionSummary).toMatch(/liquidated at the final close \(the default\)/i);
    const risk = review.riskSummary.join(' ');
    expect(risk).toMatch(/drawdown.*10%/i);
    expect(risk).toMatch(/new entries are paused/i);
    expect(risk).toMatch(/closed at the next available open/i);
    expect(risk).toMatch(/Gaps and fees can push the realized loss beyond/i);
    expect(review.limitations.join(' ')).toMatch(/gap through the stop fills at the open/i);
    expect(review.limitations.join(' ')).toMatch(/touches both stop and target.*stop first/i);
    expect(review.limitations.join(' ')).toMatch(/realized losses exceed the configured stop or drawdown threshold/i);
  });

  it('does not pretend the included flat brokerage is excluded', () => {
    const review = describeBacktestAssumptions(base, { sourceLabel: 'Draft' });
    expect(review.costSummary).toMatch(/flat brokerage.*included/i);
    expect(review.costSummary).toMatch(/DP charges.*not included/i);
    expect(review.costSummary).not.toMatch(/broker\/DP charges are excluded/i);
    expect(review.costSummary).toMatch(/statutory rates are not certified/i);
  });
});

describe('canonical review identity', () => {
  it('matches a reviewed legacy strategy to the engine-normalized response with execution defaults', () => {
    const reviewed = { ...base, version: 2, execution: { allowLong: true as const, allowShort: false as const, orderType: 'MARKET' as const } };
    const returned = validateStrategy(reviewed).data!;
    expect(returned.execution).toMatchObject({ executionPolicy: 'next_open_long_cash_v1', liquidateAtEnd: true });
    expect(canonicalStrategySignature(returned)).toBe(canonicalStrategySignature(reviewed));
  });

  it('still distinguishes genuinely different rules and symbols', () => {
    const returned = validateStrategy(base).data!;
    const changedRules = validateStrategy({
      ...base,
      rules: { ...base.rules, entry: base.rules.entry.map((rule, index) => index === 0 ? { ...rule, rightValue: (rule.rightValue ?? 0) + 1 } : rule) },
    }).data!;
    const changedSymbol = validateStrategy({ ...base, universe: { ...base.universe, symbolId: 8 } }).data!;
    expect(canonicalStrategySignature(changedRules)).not.toBe(canonicalStrategySignature(returned));
    expect(canonicalStrategySignature(changedSymbol)).not.toBe(canonicalStrategySignature(returned));
  });
});

describe('screen exit compatibility', () => {
  const screen = [
    { id: 'sma_fast', type: 'SMA' as const, params: { period: 10 } },
    { id: 'sma_slow', type: 'SMA' as const, params: { period: 30 } },
  ];
  const exits = [
    { id: 'x1', leftIndicator: 'sma_fast', operator: 'crossesBelow' as const, rightIndicator: 'sma_slow' },
  ];

  it('accepts exact matching indicator definitions, including an intentionally empty exit set', () => {
    expect(exitRuleCompatibility(exits, screen, screen)).toBeNull();
    expect(exitRuleCompatibility([], screen, screen)).toBeNull();
  });

  it('refuses exits whose indicator settings differ from the screen', () => {
    const changed = [{ ...screen[0], params: { period: 5 } }, screen[1]];
    expect(exitRuleCompatibility(exits, screen, changed)).toMatch(/different settings from the screen/i);
    expect(exitRuleCompatibility(exits, screen, changed)).toMatch(/Nothing was run/i);
  });

  it('refuses exits that reference an indicator absent from the screen', () => {
    expect(exitRuleCompatibility(exits, [screen[1]], screen)).toMatch(/not part of this screen/i);
  });

  it('compares indicator settings by meaning, not object key order', () => {
    const workspace = [{ id: 'st', type: 'SUPERTREND', params: { period: 10, multiplier: 3 } }] as StrategyAST['indicators'];
    const onScreen = [{ id: 'st', type: 'SUPERTREND', params: { multiplier: 3, period: 10 } }] as StrategyAST['indicators'];
    const rules = [{ id: 'x', leftIndicator: 'close', operator: 'gt', rightIndicator: 'st' }] as StrategyAST['rules']['exit'];
    expect(exitRuleCompatibility(rules, onScreen, workspace)).toBeNull();
  });
});
