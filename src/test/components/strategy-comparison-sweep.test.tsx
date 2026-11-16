// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrategyComparisonView } from '../../components/results/StrategyComparisonView';
import { requestBacktest } from '../../client/api';
import { simulate } from '../../server/backtest/engine';
import { strategy, bars } from '../fixtures/research';
import type { BacktestResponse } from '../../shared/strategy/types';

vi.mock('recharts', async () => {
  const Empty = () => null;
  return {
    ResponsiveContainer: Empty,
    LineChart: Empty,
    AreaChart: Empty,
    Line: Empty,
    Area: Empty,
    XAxis: Empty,
    YAxis: Empty,
    Tooltip: Empty,
    CartesianGrid: Empty,
    Legend: Empty,
  };
});
vi.mock('../../client/api', () => ({ requestBacktest: vi.fn() }));

function run(id = 'run-a'): BacktestResponse {
  const result = simulate(strategy(), bars([[100, 101, 99, 100], [110, 112, 109, 111], [120, 121, 119, 120]]), { initialCapital: 10000, robustness: false });
  result.backtestId = id;
  result.strategy.id = 'same-strategy';
  result.provenance = {
    source: 'FIXTURE',
    checksum: 'fixed-checksum',
    mode: 'demo',
    symbolId: result.symbol.id,
    actualRange: { start: result.bars[0].date, end: result.bars.at(-1)!.date },
    adjustment: 'unadjusted',
    calendarVersion: 'fixture',
  };
  result.manifest = {
    engineVersion: result.engineVersion,
    executionPolicy: result.executionPolicy,
    initialCapital: 10000,
    feeSchedule: 'illustrative-unverified',
    feeVerified: false,
  };
  return result;
}
function copy(result: BacktestResponse, id: string) {
  const clone = structuredClone(result);
  clone.backtestId = id;
  return clone;
}

type ListUpdate = BacktestResponse[] | ((current: BacktestResponse[]) => BacktestResponse[]);
function Harness({ initial, onUpdate }: { initial: BacktestResponse[]; onUpdate?: (update: ListUpdate) => void }) {
  const [list, setList] = useState(initial);
  return (
    <>
      <output data-testid="ids">{list.map(item => item.backtestId).join(',')}</output>
      <StrategyComparisonView
        activeResult={initial[0]}
        comparisonResults={list}
        onUpdateComparisonList={update => {
          onUpdate?.(update);
          setList(current => typeof update === 'function' ? update(current) : update);
        }}
        onSelectActiveResult={() => {}}
        onApplyStrategy={() => {}}
      />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('comparison sweeps', () => {
  it('merges results with the latest list so a run removed during a sweep stays removed', async () => {
    const baseline = run('run-a');
    const removable = copy(baseline, 'run-removed');
    let resolveBatch!: (value: BacktestResponse) => void;
    const pending = new Promise<BacktestResponse>(resolve => { resolveBatch = resolve; });
    vi.mocked(requestBacktest).mockReturnValue(pending);

    render(<Harness initial={[baseline, removable]} />);
    fireEvent.click(screen.getByRole('button', { name: /Stop-Loss Sweep/ }));
    await waitFor(() => expect(requestBacktest).toHaveBeenCalled());
    fireEvent.click(screen.getByTitle('Remove variation from matrix'));
    await waitFor(() => expect(screen.getByTestId('ids').textContent).toBe('run-a'));

    resolveBatch(copy(baseline, 'run-sweep'));
    await waitFor(() => expect(screen.getByTestId('ids').textContent).toContain('run-sweep'));
    expect(screen.getByTestId('ids').textContent).not.toContain('run-removed');
  });

  it('varies the existing indicator periods instead of loading unrelated templates', async () => {
    const baseline = run('run-a');
    baseline.strategy.indicators = [
      { id: 'sma_fast', type: 'SMA', params: { period: 20 } },
      { id: 'rsi_14', type: 'RSI', params: { period: 14 } },
    ];
    let count = 0;
    vi.mocked(requestBacktest).mockImplementation(async () => copy(baseline, 'run-sweep-' + (++count)));

    render(<Harness initial={[baseline]} />);
    fireEvent.click(screen.getByRole('button', { name: /Indicator Period Sweep/ }));
    await waitFor(() => expect(requestBacktest).toHaveBeenCalledTimes(2));

    const candidates = vi.mocked(requestBacktest).mock.calls.map(call => call[0]);
    expect(candidates.map(candidate => candidate.indicators.map(indicator => indicator.params.period))).toEqual([[16, 11], [25, 18]]);
    expect(candidates.every(candidate => candidate.indicators.map(indicator => indicator.id).join(',') === 'sma_fast,rsi_14')).toBe(true);
    expect(candidates.every(candidate => /Indicator period x/.test(candidate.name))).toBe(true);
  });

  it('reports a sweep that cannot be validated instead of throwing from the click handler', async () => {
    const baseline = run('run-a');
    baseline.strategy.risk.stopLoss.value = -5;
    vi.mocked(requestBacktest).mockResolvedValue(copy(baseline, 'run-sweep'));

    render(<Harness initial={[baseline]} />);
    fireEvent.click(screen.getByRole('button', { name: /Stop-Loss Sweep/ }));
    expect(await screen.findByText(/sweep could not be prepared/i)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Nothing was run');
    expect(requestBacktest).not.toHaveBeenCalled();
  });
});
