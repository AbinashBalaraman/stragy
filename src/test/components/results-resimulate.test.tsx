// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ResultsDashboard } from '../../components/results/ResultsDashboard';
import type { BacktestResponse } from '../../shared/strategy/types';

const displayed = {
  backtestId: 'run-displayed',
  strategy: {
    id: 'displayed-strategy',
    name: 'Displayed strategy',
    version: 2,
    universe: { symbolId: 1, timeframe: '1D' },
    indicators: [],
    rules: { entry: [], exit: [] },
    risk: {
      stopLoss: { type: 'percent', value: 2 },
      takeProfit: null,
      trailingStop: null,
      positionSizing: { type: 'fixedQty', quantity: 1 },
    },
    execution: { allowLong: true, allowShort: false, orderType: 'MARKET' },
    costs: { slippageBps: 0, brokerageFlat: 0, tradeType: 'DELIVERY', applyIndianTaxes: false },
  },
  symbol: { id: 1, ticker: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE', sector: 'Energy', currentPrice: 2900, changePercent: 0.5 },
  metrics: {
    initialCapital: 250000,
    finalEquity: 260000,
    netPnl: 10000,
    totalReturnPercent: 4,
    cagr: 3,
    sharpeRatio: 1.2,
    sortinoRatio: 1.4,
    calmarRatio: 1,
    maxDrawdownPercent: 2,
    maxDrawdownAmount: 5000,
    winRate: 60,
    profitFactor: 1.8,
    totalTrades: 5,
    winningTrades: 3,
    losingTrades: 2,
    averageTradePnl: 2000,
    averageWin: 5000,
    averageLoss: -2000,
    winLossRatio: 2.5,
    maxConsecutiveLosses: 1,
    avgHoldingBars: 4,
    benchmarkReturnPercent: 2,
    alpha: 2,
    beta: 1,
    unavailableReasons: {},
  },
  equityCurve: [],
  trades: [],
  costs: { stt: 0, totalCharges: 0 },
  robustness: {},
  indicatorsData: {},
  bars: [{ date: '2025-01-01' }, { date: '2025-06-30' }],
  executedAt: '2026-01-01T00:00:00Z',
  warnings: [],
  provenance: {
    mode: 'real',
    source: 'YAHOO_PUBLIC_CHART',
    asOf: '2025-06-30',
    actualRange: { start: '2025-01-01', end: '2025-06-30' },
    requestWindow: { start: '2025-01-01', end: '2025-06-30', asOf: '2025-06-30' },
  },
} as unknown as BacktestResponse;

afterEach(cleanup);

describe('results re-simulation ownership', () => {
  it('re-runs the displayed result instead of the current draft', () => {
    const onReRun = vi.fn();
    render(<ResultsDashboard result={displayed} onReRun={onReRun} isLoading={false} initialTab="trades" />);
    fireEvent.click(screen.getByRole('button', { name: /Run again/ }));
    expect(onReRun).toHaveBeenCalledTimes(1);
    expect(onReRun).toHaveBeenCalledWith(displayed);
  });

  it('keeps the empty state pointed at the current draft', () => {
    const onReRun = vi.fn();
    render(<ResultsDashboard result={null} onReRun={onReRun} isLoading={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run the current strategy' }));
    expect(onReRun).toHaveBeenCalledTimes(1);
    expect(onReRun.mock.calls[0]).toEqual([]);
  });
});
