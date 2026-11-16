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
    expect(within(near).getByText('4/5 conditions')).toBeTruthy();
    expect(within(near).getByText(/Reliance Power/)).toBeTruthy();
    expect(within(near).queryByText(/Reliance Industries/)).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Prepare backtest for RELIANCE' })).toHaveLength(1);

    fireEvent.click(within(near).getByRole('button', { name: 'Prepare backtest for RELIANCEPOWER' }));
    expect(onPrepare).toHaveBeenCalledWith(8, '2026-10-15');
  });
});
