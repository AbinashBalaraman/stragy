// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BacktestResultCard } from '../../components/chat/BacktestResultCard';
import type { BacktestResponse } from '../../shared/strategy/types';

const result = (overrides: Record<string, unknown> = {}): BacktestResponse => ({
  backtestId: 'run-1',
  strategy: { name: 'RSI mean reversion' },
  symbol: { ticker: 'RELIANCE', name: 'Reliance Industries' },
  metrics: {
    initialCapital: 100000,
    finalEquity: 110000,
    netPnl: 10000,
    totalReturnPercent: 10,
    cagr: null,
    sharpeRatio: null,
    maxDrawdownPercent: 5,
    totalTrades: 3,
    unavailableReasons: { cagr: 'Window too short for annualisation', sharpeRatio: 'Too few return observations' },
  },
  trades: [{}, {}, {}],
  bars: [{ date: '2025-01-01' }, { date: '2025-02-01' }],
  provenance: { mode: 'real', source: 'YAHOO_PUBLIC_CHART', asOf: '2025-02-01', actualRange: { start: '2025-01-01', end: '2025-02-01' } },
  warnings: [],
  ...overrides,
}) as unknown as BacktestResponse;

afterEach(cleanup);

describe('inline backtest headline honesty', () => {
  it('shows null metrics as unavailable and keeps reasons inspectable', () => {
    render(<BacktestResultCard result={result()} />);
    const values = screen.getAllByText('Unavailable');
    expect(values.length).toBe(2);
    expect(screen.queryByText('0.00%')).toBeNull();
    expect(values[0].getAttribute('title')).toMatch(/annualisation/i);
    expect(screen.getByText(/10\.00%/)).toBeTruthy();
    expect(screen.getByText(/Observed public daily data/)).toBeTruthy();
    expect(screen.getByTestId('run-source').textContent).toContain('Observed through: 2025-02-01');
  });

  it('labels demo bars as generated and never as observed', () => {
    render(<BacktestResultCard result={result({ provenance: { mode: 'demo', source: 'DEMO_MODEL', actualRange: { start: '2025-01-01', end: '2025-02-01' } } })} />);
    expect(screen.getAllByText(/Demo data — generated bars, not observed market prices/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Do not read them as observed market prices or live results/)).toBeTruthy();
    expect(screen.queryByText(/Observed public daily data/)).toBeNull();
  });

  it('treats missing provenance as unverified instead of assuming real data', () => {
    render(<BacktestResultCard result={result({ provenance: undefined })} />);
    expect(screen.getByText(/Data mode unavailable — treat results as unverified/)).toBeTruthy();
    expect(screen.getByText(/Treat every headline number as unverified/)).toBeTruthy();
    expect(screen.queryByText(/Observed public daily data/)).toBeNull();
  });

  it('opens verbose details only through the explicit action', () => {
    const open = vi.fn();
    render(<BacktestResultCard result={result()} onOpenDetails={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
