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
    // Unavailable metrics are an em dash with the reason in the tooltip (never 0).
    const values = screen.getAllByTitle(/annualisation|too few return observations/i);
    expect(values).toHaveLength(2);
    expect(values[0].textContent).toBe('—');
    expect(screen.queryByText('0.00%')).toBeNull();
    expect(screen.getByText(/10\.00%/)).toBeTruthy();
    expect(screen.getAllByText(/Yahoo daily data/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('run-source').textContent).toContain('Observed through: 01 Feb 2025');
    expect(screen.getByText('+₹10,000.00')).toBeTruthy();
    expect(screen.queryByText(/126\.7/)).toBeNull();
  });

  it('uses one human source label in both the badge and the source line', () => {
    render(<BacktestResultCard result={result()} />);
    expect(screen.getAllByText(/Yahoo daily data/).length).toBeGreaterThanOrEqual(2);
    const angel = result({ provenance: { mode: 'real', source: 'ANGEL_SMARTAPI', asOf: '2025-02-01', actualRange: { start: '2025-01-01', end: '2025-02-01' } } });
    cleanup();
    render(<BacktestResultCard result={angel} />);
    expect(screen.getAllByText(/Angel One daily data/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('run-source').textContent).toContain('Source: Angel One daily data');
    expect(screen.queryByText(/Observed public daily data/)).toBeNull();
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

  it('calls method caveats data notes and keeps per-run events as warnings', () => {
    render(<BacktestResultCard result={result({ warnings: ['Current membership survivorship bias', 'Benchmark is this instrument buy-and-hold, not a market index.'] })} />);
    expect(screen.getByText('Data notes (2)')).toBeTruthy();
    cleanup();
    render(<BacktestResultCard result={result({ warnings: ['Entry skipped: unavailable ATR at 2025-01-02'] })} />);
    expect(screen.getByText('Data warnings (1)')).toBeTruthy();
  });

  it('shows the equity curve and the first five trades when the run carries them', () => {
    const trades = Array.from({ length: 8 }, (_, index) => ({
      id: 't' + index,
      entryDate: '2025-01-0' + ((index % 8) + 1),
      exitDate: '2025-01-1' + ((index % 8) + 1),
      entryPrice: 100 + index,
      exitPrice: 102 + index,
      direction: 'LONG' as const,
      quantity: 10,
      pnl: 20,
      pnlPercent: 2,
      holdingDays: 10,
      holdingBars: 10,
      exitReason: 'RULE_EXIT' as const,
      costs: 1,
      netPnl: index % 2 === 0 ? 19 : -11,
    }));
    const withCurve = result({
      equityCurve: [
        { date: '2025-01-01', timestamp: 1, equity: 100000, drawdown: 0, drawdownPercent: 0, benchmarkEquity: 100000 },
        { date: '2025-01-15', timestamp: 2, equity: 101500, drawdown: 0, drawdownPercent: 0, benchmarkEquity: 100000 },
        { date: '2025-02-01', timestamp: 3, equity: 110000, drawdown: 0, drawdownPercent: 0, benchmarkEquity: 100000 },
      ],
      trades,
    });
    render(<BacktestResultCard result={withCurve} />);
    expect(screen.getByRole('img', { name: /Equity curve, 01 Jan 2025/ })).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Executed trades, 8 rows' });
    expect(table).toBeTruthy();
    expect(table.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(screen.getAllByText('Rule exit').length).toBe(5);
    expect(screen.getByRole('button', { name: 'Show all 8' })).toBeTruthy();
  });
});
