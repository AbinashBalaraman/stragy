import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RunProvenance } from '../../components/results/RunProvenance';
import { EquityCharts } from '../../components/results/EquityCharts';
import type { BacktestResponse, EquityPoint } from '../../shared/strategy/types';
const result = (provenance?: unknown): BacktestResponse => ({ backtestId: 'run-immutable', provenance, bars: [{ date: '2025-01-01' }, { date: '2025-01-02' }], warnings: ['Fees unverified'], manifest: { sourceCommit: 'working-tree', seed: 42 } }) as BacktestResponse;
describe('result source and benchmark labels', () => {
  it('shows actual generated source, cutoff, range, checksum and warnings', () => {
    const html = renderToStaticMarkup(<RunProvenance result={result({ mode: 'demo', source: 'DETERMINISTIC_DEMO_V1', asOf: '2025-01-02', actualRange: { start: '2024-01-01', end: '2025-01-02' }, checksum: 'checksum-exact', warnings: ['Not market observations'] })} />);
    for (const phrase of ['GENERATED DEMO DATA', 'not observed market prices', 'DETERMINISTIC_DEMO_V1', '2025-01-02', 'checksum-exact', 'Fees unverified', 'Not market observations', 'run-immutable']) expect(html).toContain(phrase);
  });
  it('never relabels missing or real provenance as demo or verified', () => {
    expect(renderToStaticMarkup(<RunProvenance result={result()} />)).toContain('Data provenance unavailable');
    const real = renderToStaticMarkup(<RunProvenance result={result({ mode: 'real', source: 'Test provider' })} />);
    expect(real).toContain('verification and entitlement are not implied'); expect(real).not.toContain('GENERATED DEMO DATA');
  });
  it('uses manifest data only when direct provenance is absent', () => {
    const run = result(); run.manifest = { data: { mode: 'demo', source: 'Manifest dataset' } };
    expect(renderToStaticMarkup(<RunProvenance result={run} />)).toContain('Manifest dataset');
    run.provenance = { mode: 'real', source: 'Direct dataset' };
    expect(renderToStaticMarkup(<RunProvenance result={run} />)).not.toContain('Manifest dataset');
  });
  it('shows the real capital and instrument benchmark, without double signs or NIFTY substitution', () => {
    const points = [{ date: '2025-01-01', timestamp: 1, equity: 49000, benchmarkEquity: 50000, drawdown: 1000, drawdownPercent: 2 }, { date: '2025-01-02', timestamp: 2, equity: 45000, benchmarkEquity: 48000, drawdown: 5000, drawdownPercent: 10 }] satisfies EquityPoint[];
    const html = renderToStaticMarkup(<EquityCharts equityCurve={points} initialCapital={50000} benchmarkLabel="RELIANCE buy-and-hold" />);
    expect(html).toContain('RELIANCE buy-and-hold'); expect(html).toContain('50,000'); expect(html).toContain('-10.0%'); expect(html).toContain('-4.0%'); expect(html).not.toMatch(/NIFTY|\+-/);
  });
});
