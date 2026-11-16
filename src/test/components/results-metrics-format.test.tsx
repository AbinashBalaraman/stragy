// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MetricsGrid } from '../../components/results/MetricsGrid';
import type { BacktestMetrics } from '../../shared/strategy/types';

const metrics = (overrides: Partial<BacktestMetrics> = {}): BacktestMetrics => ({
  initialCapital: 100000,
  finalEquity: 101000,
  netPnl: 1000,
  totalReturnPercent: 1,
  cagr: 1.2,
  sharpeRatio: 0.8,
  sortinoRatio: 1.1,
  calmarRatio: 0.5,
  maxDrawdownPercent: 1.134125124510941,
  maxDrawdownAmount: 874.9138,
  winRate: 62.5,
  profitFactor: 1.18,
  totalTrades: 8,
  winningTrades: 5,
  losingTrades: 3,
  averageTradePnl: 125,
  averageWin: 400,
  averageLoss: -200,
  winLossRatio: 2,
  maxConsecutiveLosses: 1,
  avgHoldingBars: 11,
  benchmarkReturnPercent: 6.26,
  alpha: 0.02,
  beta: 0.81,
  unavailableReasons: {},
  ...overrides,
});

afterEach(cleanup);

describe('results metrics evidence state', () => {
  it('shows the insufficient-evidence banner and rounds raw drawdown floats', () => {
    render(<MetricsGrid metrics={metrics()} />);
    expect(screen.getByRole('status').textContent).toContain('Insufficient evidence: 8 trades (need 30+)');
    expect(screen.getByText('1.13%')).toBeTruthy();
    expect(screen.getByText(/₹1,000\.00/)).toBeTruthy();
    expect(screen.queryByText(/1\.134125/)).toBeNull();
  });

  it('says no losing trades instead of N/A for profit factor', () => {
    render(<MetricsGrid metrics={metrics({ profitFactor: null, losingTrades: 0, winningTrades: 5 })} />);
    expect(screen.getByText('No losing trades')).toBeTruthy();
  });

  it('hides the banner when the sample is large enough', () => {
    render(<MetricsGrid metrics={metrics({ totalTrades: 30 })} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
