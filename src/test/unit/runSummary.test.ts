import { describe, expect, it } from 'vitest';
import { summarizeRunData } from '../../components/chat/runSummary';
import type { BacktestResponse } from '../../shared/strategy/types';

const response = (overrides: Partial<BacktestResponse>): BacktestResponse => ({
  backtestId: 'run-1',
  strategy: { name: 'Fixture' },
  symbol: { ticker: 'RELIANCE', name: 'Reliance Industries' },
  metrics: {},
  equityCurve: [],
  trades: [],
  costs: {},
  robustness: {},
  indicatorsData: {},
  bars: [],
  executedAt: '2026-10-15T12:00:00Z',
  ...overrides,
}) as unknown as BacktestResponse;

describe('run data provenance summary', () => {
  it('reports only the server-provided observed date and source', () => {
    const summary = summarizeRunData(response({
      provenance: {
        mode: 'real', source: 'YAHOO_PUBLIC_CHART', asOf: '2026-10-14',
        actualRange: { start: '2024-10-14', end: '2026-10-14' },
      },
      bars: [{ date: '2024-10-14' }, { date: '2026-10-14' }] as never,
      warnings: ['Adjusted prices'],
    }));

    expect(summary.mode).toBe('real');
    expect(summary.modeLabel).toBe('Observed public daily data');
    expect(summary.source).toBe('YAHOO_PUBLIC_CHART');
    expect(summary.observedThrough).toBe('2026-10-14');
    expect(summary.datasetRange).toBe('2024-10-14 to 2026-10-14');
    expect(summary.warnings).toEqual(['Adjusted prices']);
  });

  it('never relabels demo bars as observed', () => {
    const summary = summarizeRunData(response({
      provenance: { mode: 'demo', source: 'DEMO_MODEL', actualRange: { start: '2025-01-01', end: '2025-02-01' } },
      bars: [{ date: '2025-01-01' }, { date: '2025-02-01' }] as never,
    }));

    expect(summary.mode).toBe('demo');
    expect(summary.modeLabel).toBe('Demo data — generated bars, not observed market prices');
    expect(summary.modeLabel).not.toMatch(/Observed public/);
    expect(summary.observedThrough).toBe('2025-02-01');
  });

  it('falls back to the manifest and then the last bar without inventing a date', () => {
    const manifest = summarizeRunData(response({
      manifest: { data: { mode: 'real', source: 'NSE_BHAVCOPY', actualRange: { start: '2025-01-01', end: '2025-03-01' } } },
    }));
    expect(manifest.source).toBe('NSE_BHAVCOPY');
    expect(manifest.observedThrough).toBe('2025-03-01');

    const barsOnly = summarizeRunData(response({ bars: [{ date: '2025-04-01' }] as never }));
    expect(barsOnly.observedThrough).toBe('2025-04-01');

    const empty = summarizeRunData(response({}));
    expect(empty.mode).toBe('unknown');
    expect(empty.modeLabel).toBe('Data mode unavailable — treat results as unverified');
    expect(empty.source).toBe('Unavailable');
    expect(empty.observedThrough).toBe('Unavailable');
    expect(empty.datasetRange).toBe('Unavailable');
  });

  it('deduplicates warnings from the response and the data manifest', () => {
    const summary = summarizeRunData(response({
      provenance: { mode: 'real', source: 'S', warnings: ['Shared warning', 'Provider warning'] },
      warnings: ['Shared warning'],
    }));
    expect(summary.warnings).toEqual(['Shared warning', 'Provider warning']);
  });
});
