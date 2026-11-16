// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrategyBuilder, windowStartIso } from '../../components/strategy/StrategyBuilder';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import type { StrategyAST } from '../../shared/strategy/types';

const base = () => JSON.parse(JSON.stringify(STRATEGY_TEMPLATES[0].strategy)) as StrategyAST;

const Harness = ({ onRunBacktest = vi.fn(), onDescribeInChat }: { onRunBacktest?: () => void; onDescribeInChat?: () => void }) => {
  const [strategy, setStrategy] = useState<StrategyAST>(base);
  return (
    <StrategyBuilder
      strategy={strategy}
      onChange={setStrategy}
      onRunBacktest={onRunBacktest}
      isLoading={false}
      symbols={[{ id: strategy.universe.symbolId, ticker: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE', sector: 'Energy', currentPrice: 1344.8, changePercent: 0.38 }]}
      onSymbolChange={vi.fn()}
      onDescribeInChat={onDescribeInChat}
    />
  );
};

afterEach(cleanup);

describe('strategy tester summary', () => {
  it('opens on the rule summary with one primary run action and no editor form', () => {
    const onRunBacktest = vi.fn();
    render(<Harness onRunBacktest={onRunBacktest} />);

    expect(screen.getByRole('heading', { level: 1, name: STRATEGY_TEMPLATES[0].name })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /entry · all must match/i })).toBeTruthy();
    expect(screen.getByText('Close above Supertrend (10, 3)')).toBeTruthy();
    expect(screen.getByText('Close above 200-day EMA')).toBeTruthy();
    expect(screen.getByText('Volume above its 20-day average')).toBeTruthy();
    expect(screen.getByText('Close below Supertrend (10, 3)')).toBeTruthy();
    expect(screen.queryByText(/st1/)).toBeNull();
    expect(screen.getByText(/Last 3 years/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Run backtest/ })).toBeTruthy();
    // The heavy editor is closed: no indicator type picker, no JSON textarea.
    expect(screen.queryByLabelText('New indicator type')).toBeNull();
    expect(screen.queryByLabelText('Strategy JSON import')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Run backtest/ }));
    expect(onRunBacktest).toHaveBeenCalledWith({ start: windowStartIso(3) });
  });

  it('reveals the full editor only under Edit details', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Edit details' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('New indicator type')).toBeTruthy();
    expect(screen.getByLabelText('Strategy name')).toBeTruthy();
    expect(screen.getByLabelText('Backtest window')).toBeTruthy();
  });

  it('keeps the current symbol when a template is applied', () => {
    render(<Harness />);
    const other = STRATEGY_TEMPLATES.find(template => template.name !== STRATEGY_TEMPLATES[0].name)!;
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(other.name) }));
    expect(screen.getByRole('heading', { level: 1, name: other.name })).toBeTruthy();
    expect(screen.queryByRole('button', { name: new RegExp(other.name) })).toBeNull();
  });

  it('hands off to the copilot instead of editing fields', () => {
    const onDescribeInChat = vi.fn();
    render(<Harness onDescribeInChat={onDescribeInChat} />);
    fireEvent.click(screen.getByRole('button', { name: 'Describe in chat' }));
    expect(onDescribeInChat).toHaveBeenCalledTimes(1);
  });
});
