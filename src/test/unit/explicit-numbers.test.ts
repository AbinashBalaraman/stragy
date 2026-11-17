import { describe, expect, it } from 'vitest';
import { applyExplicitNumbers, mergeExplicitAssumptions } from '../../server/ai/explicitNumbers';
import { resolveFeatureSetup } from '../../server/ai/featureSetup';
import { validateStrategy } from '../../shared/strategy/schema';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import type { StrategyAST } from '../../shared/strategy/types';

const NOW = new Date('2026-11-16T12:00:00.000Z');

function draft(): StrategyAST {
  return JSON.parse(JSON.stringify(validateStrategy(STRATEGY_TEMPLATES[0].strategy).data!)) as StrategyAST;
}

function withRsi(strategy = draft()): StrategyAST {
  strategy.indicators.push({ id: 'rsi14', type: 'RSI', params: { period: 14 } });
  strategy.rules.entry = [{ leftIndicator: 'rsi14', operator: 'lt', rightValue: 30 }];
  strategy.rules.exit = [{ leftIndicator: 'rsi14', operator: 'gt', rightValue: 70 }];
  return strategy;
}

describe('explicit numbers override drafts', () => {
  it.each([
    ['5% stop loss', 5],
    ['5% SL', 5],
    ['stop at 5%', 5],
    ['stop-loss 5 percent', 5],
    ['stop loss of 5%', 5],
  ])('reads the stop in "%s"', (message, value) => {
    const result = applyExplicitNumbers(draft(), `Backtest RELIANCE with RSI below 30, ${message}`);
    expect(result.strategy.risk.stopLoss).toMatchObject({ type: 'percent', value });
    expect(result.assumptions.join(' ')).toContain('Stop loss: ' + value + '%');
  });

  it.each([
    ['target 10%', 10],
    ['10% target', 10],
    ['take profit 10 percent', 10],
    ['take-profit of 10%', 10],
    ['TP 10%', 10],
  ])('reads the target in "%s"', (message, value) => {
    const result = applyExplicitNumbers(draft(), `Backtest RELIANCE with RSI below 30, ${message}`);
    expect(result.strategy.risk.takeProfit).toEqual({ type: 'percent', value });
    expect(result.assumptions.join(' ')).toContain('Target: ' + value + '%');
  });

  it('reads a trailing-stop percentage in either order', () => {
    const first = applyExplicitNumbers(draft(), 'Backtest RELIANCE with a 2% trailing stop');
    expect(first.strategy.risk.trailingStop).toMatchObject({ type: 'percent', value: 2 });
    const second = applyExplicitNumbers(draft(), 'Backtest RELIANCE with trailing stop at 2 percent');
    expect(second.strategy.risk.trailingStop).toMatchObject({ type: 'percent', value: 2 });
  });

  it('does not mistake an RSI level for a stop or target', () => {
    const result = applyExplicitNumbers(draft(), 'Backtest RELIANCE with RSI below 30 entry');
    expect(result.strategy.risk.stopLoss.value).toBe(3.5);
    expect(result.strategy.risk.takeProfit?.value).toBe(14);
  });

  it('overrides a model draft and removes the invented Supertrend exit', () => {
    const result = applyExplicitNumbers(
      draft(),
      'Backtest RELIANCE with RSI below 30 entry, 5% stop loss, 10% target',
      { dropUnrequestedExits: true, clearUnrequestedTrailing: true },
    );
    expect(result.strategy.risk.stopLoss).toEqual({ type: 'percent', value: 5 });
    expect(result.strategy.risk.takeProfit).toEqual({ type: 'percent', value: 10 });
    expect(result.strategy.risk.trailingStop).toBeNull();
    expect(result.strategy.rules.exit).toEqual([]);
    expect(result.removedExitRules).toBe(true);
    expect(result.riskChanged).toBe(true);
    expect(result.assumptions).toEqual(expect.arrayContaining([
      'Stop loss: 5% below entry (from your message).',
      'Target: 10% above entry (from your message).',
    ]));
    expect(result.assumptions.join(' ')).toMatch(/no indicator exit rule/i);
  });

  it('keeps an exit indicator the user actually named', () => {
    const result = applyExplicitNumbers(
      draft(),
      'Backtest RELIANCE with RSI below 30 entry, supertrend exit, 5% stop loss, 10% target',
      { dropUnrequestedExits: true, clearUnrequestedTrailing: true },
    );
    expect(result.strategy.rules.exit).toHaveLength(1);
    expect(result.strategy.rules.exit[0]).toMatchObject({ leftIndicator: 'close', rightIndicator: 'st1' });
  });

  it('applies an RSI period and both RSI levels to the draft', () => {
    const result = applyExplicitNumbers(
      withRsi(),
      'Backtest RELIANCE when RSI(21) is below 25 entry, exit when RSI is above 75, 5% stop loss',
    );
    expect(result.strategy.indicators.find(indicator => indicator.id === 'rsi14')?.params.period).toBe(21);
    expect(result.strategy.rules.entry[0]).toMatchObject({ operator: 'lt', rightValue: 25 });
    expect(result.strategy.rules.exit[0]).toMatchObject({ operator: 'gt', rightValue: 75 });
    expect(result.assumptions).toEqual(expect.arrayContaining([
      'RSI period 21 (from your message).',
      'RSI below 25 (from your message).',
      'RSI above 75 (from your message).',
    ]));
  });

  it('applies stated moving-average periods to the referenced indicators', () => {
    const strategy = draft();
    strategy.indicators = [
      { id: 'sma20', type: 'SMA', params: { period: 20 } },
      { id: 'sma50', type: 'SMA', params: { period: 50 } },
    ];
    strategy.rules.entry = [{ leftIndicator: 'sma20', operator: 'crossesAbove', rightIndicator: 'sma50' }];
    strategy.rules.exit = [{ leftIndicator: 'sma20', operator: 'crossesBelow', rightIndicator: 'sma50' }];
    const result = applyExplicitNumbers(strategy, 'Backtest RELIANCE when SMA 30 crosses above SMA 90, 5% stop loss');
    expect(result.strategy.indicators.find(indicator => indicator.id === 'sma20')?.params.period).toBe(30);
    expect(result.strategy.indicators.find(indicator => indicator.id === 'sma50')?.params.period).toBe(90);
  });

  it('merges explicit assumptions without leaving the old template risk line', () => {
    const existing = [
      'Entry: RSI(14) is below 30 on the current completed daily bar.',
      'Exit: the workspace exit rules are preserved.',
      'Risk: 3.5% stop loss; your workspace sizing and execution settings are preserved.',
    ];
    const result = applyExplicitNumbers(draft(), 'RSI below 30, 5% stop loss, 10% target', {
      dropUnrequestedExits: true,
      clearUnrequestedTrailing: true,
    });
    const merged = mergeExplicitAssumptions(existing, result);
    expect(merged.join(' ')).not.toMatch(/3\.5% stop loss/);
    expect(merged.join(' ')).not.toMatch(/workspace exit rules are preserved/);
    expect(merged.join(' ')).toContain('Stop loss: 5% below entry');
    expect(merged.join(' ')).toContain('Target: 10% above entry');
  });

  it('fills the reported RELIANCE sentence with the requested risk and no invented exit', () => {
    const response = resolveFeatureSetup({
      message: 'Backtest RELIANCE with RSI below 30 entry, 5% stop loss, 10% target',
    }, { now: NOW });
    expect(response.status).toBe('ready');
    if (response.status !== 'ready' || response.setup.feature !== 'strategy_tester') throw new Error('Expected tester prefill');
    const setup = response.setup;
    expect(setup.strategy.risk.stopLoss).toEqual({ type: 'percent', value: 5 });
    expect(setup.strategy.risk.takeProfit).toEqual({ type: 'percent', value: 10 });
    expect(setup.strategy.risk.trailingStop).toBeNull();
    expect(setup.strategy.rules.exit).toEqual([]);
    expect(setup.assumptions.join(' ')).toContain('Target: 10% above entry');
    expect(validateStrategy(setup.strategy).success).toBe(true);
  });
});
