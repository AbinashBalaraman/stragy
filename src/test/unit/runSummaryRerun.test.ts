import { describe, expect, it } from 'vitest';
import { rerunRequestOptions } from '../../client/rerun';
import type { BacktestResponse } from '../../shared/strategy/types';

const result = (overrides: Record<string, unknown> = {}) => ({
  metrics: { initialCapital: 250000 },
  provenance: {},
  ...overrides,
} as unknown as BacktestResponse);

describe('re-run request options', () => {
  it('reuses the displayed run request window and capital', () => {
    expect(rerunRequestOptions(result({
      metrics: { initialCapital: 250000 },
      provenance: { requestWindow: { start: '2024-01-01', end: '2025-12-31', asOf: '2025-12-31' } },
    }))).toEqual({ initialCapital: 250000, start: '2024-01-01', end: '2025-12-31', asOf: '2025-12-31' });
  });

  it('falls back to manifest options, including seed and robustness', () => {
    expect(rerunRequestOptions(result({
      manifest: { options: { initialCapital: 100000, seed: 7, robustness: false, requestWindow: { start: '2024-02-01', end: '2024-12-31' } } },
    }))).toEqual({ initialCapital: 100000, start: '2024-02-01', end: '2024-12-31', seed: 7, robustness: false });
  });

  it('prefers the response provenance window over a stale manifest window', () => {
    expect(rerunRequestOptions(result({
      provenance: { requestWindow: { end: '2025-06-30', asOf: '2025-06-30' } },
      manifest: { options: { requestWindow: { end: '2030-01-01' } } },
    }))).toEqual({ initialCapital: 250000, end: '2025-06-30', asOf: '2025-06-30' });
  });

  it('never invents a window when none was recorded', () => {
    expect(rerunRequestOptions(result())).toEqual({ initialCapital: 250000 });
  });
});
