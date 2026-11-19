// @vitest-environment jsdom
/**
 * Price chart overlay regressions (2026-11-19 review):
 *  - EMA/SMA/BBANDS series were computed into chartData but never rendered
 *  - ResultsDashboard never passed indicatorsData, so every overlay
 *    (including supertrend) was null even when the server computed it
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { PriceChart } from '../../components/results/PriceChart';
import { ResultsDashboard } from '../../components/results/ResultsDashboard';
import { simulate } from '../../server/backtest/engine';
import { strategy, bars } from '../fixtures/research';
import type { IndicatorConfig } from '../../shared/strategy/types';

vi.mock('recharts', async () => {
  const Empty = () => null;
  const Wrap = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const ComposedStub = ({ children, data }: { children?: React.ReactNode; data?: unknown }) => (
    <div data-chart-points={JSON.stringify(data ?? [])}>{children}</div>
  );
  const LineStub = ({ dataKey, name }: { dataKey?: string; name?: string }) => <div data-line={dataKey} data-name={name} />;
  return {
    ResponsiveContainer: Wrap, ComposedChart: ComposedStub, LineChart: Empty, AreaChart: Empty,
    Line: LineStub, Area: Empty, XAxis: Empty, YAxis: Empty, Tooltip: Empty,
    CartesianGrid: Empty, Legend: Empty, ReferenceDot: Empty,
  };
});
vi.mock('../../client/api', () => ({ requestBacktest: vi.fn() }));

afterEach(cleanup);

const indicators: IndicatorConfig[] = [
  { id: 'ema20', type: 'EMA', params: { period: 20 } },
  { id: 'sma50', type: 'SMA', params: { period: 50 } },
  { id: 'bb20', type: 'BBANDS', params: { period: 20, stddev: 2 } },
  { id: 'st14', type: 'SUPERTREND', params: { period: 14, multiplier: 3 } },
];
const indicatorsData = {
  ema20: [100, 101, 102],
  sma50: [99, 100, 101],
  bb20_upper: [105, 106, 107],
  bb20_lower: [95, 96, 97],
  st14: [98, 99, 100],
};
const threeBars = bars([[100, 101, 99, 100], [101, 102, 100, 101], [102, 103, 101, 102]]);

describe('PriceChart indicator overlays', () => {
  it('renders a line for every configured EMA/SMA/BBANDS/supertrend series', () => {
    const { container } = render(
      <PriceChart bars={threeBars} indicators={indicators} indicatorsData={indicatorsData} />,
    );
    const keys = [...container.querySelectorAll('[data-line]')].map(node => node.getAttribute('data-line'));
    expect(keys).toContain('close');
    expect(keys).toContain('ema20');
    expect(keys).toContain('sma50');
    expect(keys).toContain('bb20_upper');
    expect(keys).toContain('bb20_lower');
    expect(keys).toContain('supertrend');
    const points = JSON.parse(container.querySelector('[data-chart-points]')!.getAttribute('data-chart-points')!);
    expect(points[0].ema20).toBe(100);
    expect(points[0].bb20_upper).toBe(105);
    expect(points[0].supertrend).toBe(98);
  });

  it('keeps warmup nulls as gaps instead of inventing values', () => {
    const { container } = render(
      <PriceChart bars={threeBars} indicators={[indicators[0]]} indicatorsData={{ ema20: [null, null, 102] }} />,
    );
    const points = JSON.parse(container.querySelector('[data-chart-points]')!.getAttribute('data-chart-points')!);
    expect(points[0].ema20).toBeNull();
    expect(points[2].ema20).toBe(102);
  });
});

describe('ResultsDashboard chart wiring', () => {
  it('passes the server-computed indicatorsData through to PriceChart', () => {
    const result = simulate(strategy(), threeBars, { initialCapital: 10000, robustness: false });
    result.strategy.indicators = [...result.strategy.indicators, indicators[0]];
    result.indicatorsData = { ...result.indicatorsData, ema20: [100, 101, 102] };
    const { container } = render(
      <ResultsDashboard result={result} isLoading={false} onReRun={vi.fn()} />,
    );
    const chart = container.querySelector('[data-chart-points]');
    expect(chart).toBeTruthy();
    const points = JSON.parse(chart!.getAttribute('data-chart-points')!);
    // Without the indicatorsData prop every overlay value is null.
    expect(points[0].ema20).toBe(100);
    expect(container.querySelector('[data-line="ema20"]')).toBeTruthy();
  });
});
