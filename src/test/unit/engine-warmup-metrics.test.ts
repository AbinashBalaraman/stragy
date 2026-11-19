/**
 * Engine/metric regressions (2026-11-19 review):
 *  - an ATR trailing stop whose warmup is not ready at entry aborted the
 *    ENTIRE run (ATR_NOT_READY) while the equivalent ATR stop-loss only
 *    skips that entry; an order-level condition must not kill a valid run
 *  - CAGR annualization overflow was mislabeled INSUFFICIENT_DURATION
 */
import { describe, expect, it } from 'vitest';
import { simulate } from '../../server/backtest/engine';
import { computeMetrics } from '../../server/backtest/metrics';
import { bars, strategy } from '../fixtures/research';
import type { EquityPoint } from '../../shared/strategy/types';

const flatBars = bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100]]);

function trailStrategy() {
  const s = strategy();
  s.rules.entry = [{ leftIndicator: 'close', operator: 'gt', rightValue: 0 }];
  s.rules.exit = [];
  s.risk.stopLoss = { type: 'percent', value: 5 };
  s.risk.trailingStop = { type: 'atr', value: 2, atrPeriod: 14 };
  return s;
}

describe('trailing ATR warmup at entry', () => {
  it('skips the entry with a warning instead of aborting the whole run', () => {
    // Signal at bar 0 close, entry at bar 1 open; trailingATR[0] is null
    // because ATR(14) cannot be ready on a 3-bar history.
    const result = simulate(trailStrategy(), flatBars, { initialCapital: 10000 });
    expect(result.trades.length).toBe(0);
    expect(result.warnings?.some(w => /trailing ATR/i.test(w))).toBe(true);
    expect(result.reconciliation).toBeTruthy();
    expect(Math.abs(result.reconciliation!.difference)).toBeLessThan(1e-6);
    expect(result.metrics.finalEquity).toBe(10000);
  });

  it('still enters normally with a percent trail (no ATR dependency)', () => {
    const s = trailStrategy();
    s.risk.trailingStop = { type: 'percent', value: 2 };
    const result = simulate(s, flatBars, { initialCapital: 10000 });
    expect(result.trades.length).toBe(1);
    expect(result.trades[0].exitReason).toBe('END_OF_DATA');
  });
});

describe('CAGR unavailable reasons', () => {
  const point = (dayOffset: number, equity: number): EquityPoint => ({
    date: new Date(Date.UTC(2026, 0, 5 + dayOffset, 10)).toISOString().slice(0, 10),
    timestamp: Date.UTC(2026, 0, 5 + dayOffset, 10),
    equity, drawdown: 0, drawdownPercent: 0, benchmarkEquity: 1000,
  });

  it('labels an overflowing annualization NONFINITE_ANNUALIZATION, not INSUFFICIENT_DURATION', () => {
    // 1000x in one day: 1000^365.2425 overflows to Infinity. Duration was
    // sufficient; the annualization itself is non-finite.
    const metrics = computeMetrics([point(0, 1000), point(1, 1_000_000)], [], 1000);
    expect(metrics.cagr).toBeNull();
    expect(metrics.unavailableReasons?.cagr).toBe('NONFINITE_ANNUALIZATION');
  });

  it('keeps INSUFFICIENT_DURATION for a zero-length window', () => {
    const metrics = computeMetrics([point(0, 1000), point(0, 1100)], [], 1000);
    expect(metrics.cagr).toBeNull();
    expect(metrics.unavailableReasons?.cagr).toBe('INSUFFICIENT_DURATION');
  });

  it('keeps NONPOSITIVE_EQUITY for a wiped-out account', () => {
    const metrics = computeMetrics([point(0, 1000), point(1, 0)], [], 1000);
    expect(metrics.cagr).toBeNull();
    expect(metrics.unavailableReasons?.cagr).toBe('NONPOSITIVE_EQUITY');
  });
});
