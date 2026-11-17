// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChartReadingCard } from '../../components/chat/ChartReadingCard';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import type { ResearchScreenPlan } from '../../shared/contracts/research-chat';
import type { ChartImageReading } from '../../client/chartAnalysis';
import type { RuleNode, StrategyAST } from '../../shared/strategy/types';

const chartTemplate = (): StrategyAST => {
  const template = STRATEGY_TEMPLATES.find(item => item.id === 'rsi_trendline_breakout_near_lows');
  if (!template) throw new Error('Chart template missing');
  return template.strategy;
};
const plan = (strategy: StrategyAST = chartTemplate()): ResearchScreenPlan => ({
  schemaVersion: 1,
  kind: 'screen',
  originatingRevision: 1,
  message: 'Chart read.',
  method: 'external_ai',
  provider: { name: 'vision', model: 'vision', aiGenerated: true },
  warnings: [],
  universe: 'NIFTY_50',
  strategy,
  assumptions: [],
  missingBacktestRules: ['exits'],
  backtestReady: false,
} as unknown as ResearchScreenPlan);
const reading = (): ChartImageReading => ({ source: 'chart_image', observations: {}, confidence: 0.42, summary: 'Near a low.' } as unknown as ChartImageReading);
const firstValue = () => {
  const input = screen.getByLabelText('Condition 1 value') as HTMLInputElement;
  return Number(input.value);
};

afterEach(cleanup);

/**
 * The dock re-creates the plan object on ordinary re-renders. A user's edit
 * between two events must not be wiped by that alone, or a scan can run the
 * AI's original condition while the card shows the edited one.
 */
describe('chart reading edits', () => {
  it('keeps an edit when the same reading is re-rendered as a new object', () => {
    const onConfirm = vi.fn();
    const first = plan();
    const view = render(<ChartReadingCard plan={first} reading={reading()} onConfirmScan={onConfirm} />);
    expect(firstValue()).toBe(36);

    fireEvent.change(screen.getByLabelText('Condition 1 value'), { target: { value: '42' } });
    expect(firstValue()).toBe(42);

    // Same content, new identity: what every parent re-render looks like.
    view.rerender(<ChartReadingCard plan={{ ...first, strategy: { ...first.strategy } } as ResearchScreenPlan} reading={reading()} onConfirmScan={onConfirm} />);
    expect(firstValue()).toBe(42);

    fireEvent.click(screen.getByRole('button', { name: 'Scan with these' }));
    const confirmed = onConfirm.mock.calls[0][0] as StrategyAST;
    expect((confirmed.rules.entry[0] as RuleNode & { rightValue: number }).rightValue).toBe(42);
  });

  it('resets to the new reading when the plan content really changes', () => {
    const first = plan();
    const view = render(<ChartReadingCard plan={first} reading={reading()} onConfirmScan={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Condition 1 value'), { target: { value: '42' } });
    expect(firstValue()).toBe(42);

    const changed = plan({
      ...chartTemplate(),
      rules: {
        ...chartTemplate().rules,
        entry: chartTemplate().rules.entry.map((rule, index) => index === 0 ? { ...rule, rightValue: 50 } : rule),
      },
    } as StrategyAST);
    view.rerender(<ChartReadingCard plan={changed} reading={reading()} onConfirmScan={vi.fn()} />);
    expect(firstValue()).toBe(50);
  });
});
