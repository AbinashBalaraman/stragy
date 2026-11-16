import { describe, expect, it } from 'vitest';
import { survivorshipBasis } from '../../components/results/survivorship';
import type { BacktestResponse } from '../../shared/strategy/types';

const run = (overrides: Partial<BacktestResponse> = {}): BacktestResponse => ({
  backtestId: 'run',
  strategy: { name: 'Reliance Supertrend + EMA', universe: { symbolId: 1, timeframe: '1D' } },
  provenance: {},
  manifest: {},
  ...overrides,
} as unknown as BacktestResponse);

describe('survivorship note context', () => {
  it('stays hidden for a plain single-symbol run', () => {
    expect(survivorshipBasis(run())).toBeNull();
  });

  it('detects an index-named screen strategy', () => {
    expect(survivorshipBasis(run({
      strategy: { name: 'Nifty 50 RSI14 oversold after recently overbought', universe: { symbolId: 1, timeframe: '1D' } },
    } as unknown as Partial<BacktestResponse>))).toEqual({ basis: 'NIFTY 50' });
  });

  it('detects explicit membership provenance', () => {
    expect(survivorshipBasis(run({
      provenance: { membership: { universe: 'NIFTY 50', source: 'official feed' } },
    }))).toEqual({ basis: 'NIFTY 50' });
  });
});
