// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ScreenResultCard } from '../../components/chat/ScreenResultCard';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import type { ResearchScreenPlan } from '../../shared/contracts/research-chat';
import type { ScanResult } from '../../client/api';
import type { StrategyAST } from '../../shared/strategy/types';

const chartTemplate = () => {
  const template = STRATEGY_TEMPLATES.find(item => item.id === 'rsi_trendline_breakout_near_lows');
  if (!template) throw new Error('Chart template missing');
  return template.strategy;
};
const fiveRuleStrategy = (): StrategyAST => ({
  ...chartTemplate(),
  rules: { ...chartTemplate().rules, entry: chartTemplate().rules.entry.slice(0, 5) },
});
const plan = (): ResearchScreenPlan => ({
  schemaVersion: 1,
  kind: 'screen',
  originatingRevision: 1,
  message: 'Chart read.',
  method: 'external_ai',
  provider: { name: 'vision', model: 'vision', aiGenerated: true },
  warnings: [],
  universe: 'NIFTY_50',
  strategy: fiveRuleStrategy() as unknown as ResearchScreenPlan['strategy'],
  assumptions: [],
  missingBacktestRules: ['exits', 'positionSizing', 'executionAndCosts'],
  backtestReady: false,
});

const match = (symbolId: number, ticker: string, name: string, score?: number) => ({
  symbolId,
  ticker,
  name,
  sector: 'Energy',
  lastDate: '2026-10-15',
  lastClose: 2900,
  changePercent: 0.5,
  ...(score === undefined ? {} : { score }),
  matchedRules: [],
  indicatorValues: {},
  provenance: {
    mode: 'real' as const, source: 'YAHOO_PUBLIC_CHART', symbolId, asOf: '2026-10-15',
    fetchedAt: '2026-10-15T12:00:00Z', requestedRange: {}, actualRange: { start: '2024-10-15', end: '2026-10-15' },
    adjustment: 'split', checksum: 'fixture', coverage: 'full', freshness: 'FRESH', warnings: [], calendarVersion: 'v1',
  },
});
const result = (): ScanResult => ({
  mode: 'real', universe: 'NIFTY_50', scanned: 50, matched: 1, scannedAt: '2026-10-15T12:00:00Z',
  dataSource: 'PROVENANCE_PER_SYMBOL', requested: 50, attempted: 50, succeeded: 50, unavailable: 0, failed: 0,
  offset: 0, limit: 100, errors: [], sourceCoverage: { YAHOO_PUBLIC_CHART: 50 }, warnings: [],
  matches: [match(7, 'RELIANCE', 'Reliance Industries')],
  nearMatches: [match(8, 'RELIANCEPOWER', 'Reliance Power', 0.8), match(7, 'RELIANCE', 'Reliance Industries', 0.8)],
});

afterEach(cleanup);

describe('screen near matches', () => {
  it('separates close matches from full matches, shows scores and filters duplicates', () => {
    const onPrepare = vi.fn();
    render(<ScreenResultCard plan={plan()} result={result()} pending={false} error="" onPrepareBacktest={onPrepare} />);

    expect(screen.getByLabelText('Screen results')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Prepare backtest for RELIANCE' })).toBeTruthy();
    const near = screen.getByLabelText('Close matches');
    expect(within(near).getByText('Close matches (missing one condition)')).toBeTruthy();
    // The score sits under the "Conditions" header of the near-match table.
    expect(within(near).getByText('4/5')).toBeTruthy();
    expect(within(near).getByText(/Reliance Power/)).toBeTruthy();
    expect(within(near).queryByText(/Reliance Industries/)).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Prepare backtest for RELIANCE' })).toHaveLength(1);

    fireEvent.click(within(near).getByRole('button', { name: 'Prepare backtest for RELIANCEPOWER' }));
    expect(onPrepare).toHaveBeenCalledWith(8, '2026-10-15');
  });

  it('drops the conditions column when the screen has a single rule', () => {
    const base = plan();
    const single: ResearchScreenPlan = {
      ...base,
      strategy: {
        ...base.strategy,
        rules: { ...base.strategy.rules, entry: base.strategy.rules.entry.slice(0, 1) },
      } as unknown as ResearchScreenPlan['strategy'],
    };
    const one = { ...result(), matched: 1, matches: [{ ...match(7, 'RELIANCE', 'Reliance Industries'), indicatorValues: {} }], nearMatches: [] };
    render(<ScreenResultCard plan={single} result={one as unknown as ScanResult} pending={false} error="" onPrepareBacktest={() => {}} />);
    expect(screen.queryByRole('columnheader', { name: 'Conditions' })).toBeNull();
    // The mobile summary keeps the indicator line but drops a meaningless "· 1/1".
    expect(screen.queryByText(/· 1\/1/)).toBeNull();
  });

  it('states the count once, in rupees, and keeps coverage behind one warn line', () => {
    const heavy = {
      ...result(),
      matched: 12,
      requested: 50,
      succeeded: 47,
      failed: 3,
      unavailable: 0,
      matches: Array.from({ length: 12 }, (_, index) => match(100 + index, 'TCS' + index, 'Tata Consultancy ' + index)),
      nearMatches: [],
      errors: [{ symbolId: 9, ticker: 'BAJAJ-AUTO', code: 'NO_DATA', message: 'No daily bars returned' }],
    };
    render(<ScreenResultCard plan={plan()} result={heavy as unknown as ScanResult} pending={false} error="" onPrepareBacktest={() => {}} />);
    expect(screen.getByText('12 matches')).toBeTruthy();
    expect(screen.getByText('· 47 of 50 checked')).toBeTruthy();
    expect(screen.getByText('3 stocks could not be checked')).toBeTruthy();
    expect(screen.getByText('Which stocks, and why (1)')).toBeTruthy();
    expect(screen.getAllByText('₹2,900.00').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Every condition held/)).toBeNull();
    expect(screen.queryByText(/Partial coverage/)).toBeNull();
  });

  it('renders one table row per match with each indicator value shown once', () => {
    const strategy = fiveRuleStrategy() as unknown as Record<string, unknown>;
    const dedupePlan: ResearchScreenPlan = {
      ...plan(),
      strategy: {
        ...strategy,
        indicators: [
          { id: 'rsi', type: 'RSI', params: { period: 14 } },
          { id: 'rsi_fast', type: 'RSI', params: { period: 14 } },
          { id: 'sma', type: 'SMA', params: { period: 200 } },
        ],
        rules: {
          ...(strategy.rules as Record<string, unknown>),
          entry: [
            { id: 'e1', leftIndicator: 'rsi', operator: 'lt', rightValue: 30 },
            { id: 'e2', leftIndicator: 'rsi_fast', operator: 'lt', rightValue: 30 },
            { id: 'e3', leftIndicator: 'sma', operator: 'gt', rightValue: 100 },
          ],
        },
      } as unknown as ResearchScreenPlan['strategy'],
    };
    const withIndicators = { ...result(), matches: [{ ...match(7, 'RELIANCE', 'Reliance Industries'), indicatorValues: { rsi: 28, rsi_fast: 28, sma: 210 } }], nearMatches: [] };
    render(<ScreenResultCard plan={dedupePlan} result={withIndicators as unknown as ScanResult} pending={false} error="" onPrepareBacktest={() => {}} />);

    const table = screen.getByRole('table', { name: 'Screen matches, 1 row' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(1);
    // The row action stays pinned to the right edge below 640px (Fix 4).
    expect(table.querySelector('thead th:last-child')?.className).toContain('max-sm:sticky');
    expect(table.querySelector('tbody td:last-child')?.className).toContain('max-sm:sticky');
    // RSI (14) is listed once even though two indicator ids carry the same label.
    expect(within(table).getByText('RSI (14) 28.00 · SMA (200) 210.00')).toBeTruthy();
    expect(screen.getByText('1 match')).toBeTruthy();
    expect(screen.queryByText(/1 matches/)).toBeNull();
  });
});
