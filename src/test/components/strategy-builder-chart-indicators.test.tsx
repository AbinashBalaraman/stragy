// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrategyBuilder } from '../../components/strategy/StrategyBuilder';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import type { StrategyAST } from '../../shared/strategy/types';

const chartTemplate = () => {
  const template = STRATEGY_TEMPLATES.find(item => item.id === 'rsi_trendline_breakout_near_lows');
  if (!template) throw new Error('Chart template missing');
  return template.strategy;
};

const Harness = () => {
  const [strategy, setStrategy] = useState<StrategyAST>(() => chartTemplate());
  return <StrategyBuilder strategy={strategy} onChange={setStrategy} onRunBacktest={vi.fn()} isLoading={false} />;
};

afterEach(cleanup);

describe('new chart indicator types in the builder', () => {
  it('renders chart-generated indicators and their registry parameters without crashing', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    expect(screen.getByText(/RSI_TRENDLINE, unit: oscillator/)).toBeTruthy();
    expect(screen.getByText(/PCT_ABOVE_LOW, unit: percent/)).toBeTruthy();
    expect((screen.getByLabelText('rsi_tl minSpan') as HTMLInputElement).value).toBe('30');
    expect((screen.getByLabelText('low250 period') as HTMLInputElement).value).toBe('250');

    const select = screen.getByLabelText('New indicator type');
    for (const type of ['RSI_SMA', 'RSI_TRENDLINE', 'PCT_ABOVE_LOW', 'PCT_CHANGE']) {
      expect(within(select).getByRole('option', { name: type })).toBeTruthy();
    }
    fireEvent.change(select, { target: { value: 'RSI_TRENDLINE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add indicator' }));

    expect(screen.getAllByText(/RSI_TRENDLINE, unit: oscillator/)).toHaveLength(2);
    expect((screen.getByLabelText('rsi_trendline1 rsiPeriod') as HTMLInputElement).value).toBe('14');
    expect((screen.getByLabelText('rsi_trendline1 maxSpan') as HTMLInputElement).value).toBe('180');
    expect((screen.getByLabelText('rsi_trendline1 anchorMin') as HTMLInputElement).value).toBe('60');
  });
});
