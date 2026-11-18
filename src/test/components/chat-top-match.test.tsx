// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AiCopilotDock } from '../../components/chat/AiCopilotDock';
import { requestScan, type ScanResult } from '../../client/api';
import { resetEngineHarness, engineReplyDefault } from '../../test/support/engineMock';
import { validStrategy } from '../../server/ai/testFixtures';
import type { StrategyAST } from '../../shared/strategy/types';

vi.mock('../../client/engine', async () => await import('../../test/support/engineMock'));
vi.mock('../../client/api', () => ({ requestScan: vi.fn() }));
vi.mock('../../client/featureSetup', () => ({ requestFeatureSetup: vi.fn() }));

let dom: JSDOM;

const reliant = { id: 7, ticker: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE' as const, sector: 'Energy', currentPrice: 2900, changePercent: 0.5 };
const tcs = { id: 5, ticker: 'TCS', name: 'Tata Consultancy Services', exchange: 'NSE' as const, sector: 'IT', currentPrice: 3800, changePercent: 0.2 };

const provenance = (symbolId: number) => ({
  mode: 'real' as const, source: 'YAHOO_PUBLIC_CHART', symbolId, asOf: '2026-10-15',
  fetchedAt: '2026-10-15T12:00:00Z', requestedRange: {}, actualRange: { start: '2024-10-15', end: '2026-10-15' },
  adjustment: 'split', checksum: 'fixture', coverage: 'full', freshness: 'FRESH', warnings: [], calendarVersion: 'v1',
});
const row = (symbolId: number, ticker: string, name: string, lastDate = '2026-10-15') => ({
  symbolId, ticker, name, sector: 'Energy', lastDate, lastClose: 2900, changePercent: 0.5,
  matchedRules: [], indicatorValues: {}, provenance: provenance(symbolId),
});
const scanOf = (matches: ScanResult['matches']): ScanResult => ({
  mode: 'real', universe: 'NIFTY_50', scanned: 50, matched: matches.length, scannedAt: '2026-10-15T12:00:00Z',
  dataSource: 'PROVENANCE_PER_SYMBOL', matches, requested: 50, attempted: 50, succeeded: 50,
  unavailable: 0, failed: 0, offset: 0, limit: 100, errors: [], sourceCoverage: { YAHOO_PUBLIC_CHART: 50 }, warnings: [],
});

const send = (text: string) => {
  fireEvent.change(screen.getByLabelText('Research request'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
};

const screenPlan = () => ({
  schemaVersion: 1,
  kind: 'screen',
  originatingRevision: 1,
  message: 'Scanning Nifty 50 for RSI above 60. Nothing is changed or run.',
  method: 'rule_parser',
  provider: { name: 'none', model: null, aiGenerated: false },
  warnings: [],
  universe: 'NIFTY_50',
  strategy: validStrategy(),
  assumptions: [],
  missingBacktestRules: ['exits'],
  backtestReady: false,
});

beforeEach(() => {
  resetEngineHarness();
  dom = new JSDOM('', { url: 'https://top-match.test' });
  vi.stubGlobal('localStorage', dom.window.localStorage);
  window.history.replaceState({}, '', '/');
  engineReplyDefault(() => {
    const plan = screenPlan();
    return {
      ...plan,
      __engineTool: {
        name: 'scan_market',
        run: async () => {
          try { return { result: await vi.mocked(requestScan)({ universe: 'NIFTY_50', strategy: plan.strategy }) }; }
          catch (error) { return { error: { message: (error as Error).message } }; }
        },
      },
    };
  });
});

afterEach(() => {
  cleanup();
  dom.window.close();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/**
 * "Backtest the top match" is a follow-up about the scan the user just ran, so
 * it must open the first row's review instead of asking for a ticker they can
 * already see on screen.
 */
describe('backtest the top match', () => {
  it('opens the review for the first match of the finished screen', async () => {
    vi.mocked(requestScan).mockResolvedValue(scanOf([row(7, 'RELIANCE', 'Reliance Industries'), row(5, 'TCS', 'Tata Consultancy Services')]));
    const run = vi.fn().mockResolvedValue(undefined);
    render(<AiCopilotDock strategy={validStrategy()} symbols={[reliant, tcs]} onResearchBacktest={run} />);
    send('Screen Nifty 50 for RSI above 60');
    await screen.findByLabelText('Screen results');

    send('Backtest the top match');
    const review = await screen.findByRole('article', { name: 'Backtest review' });
    expect(within(review).getByText(/Backtest RELIANCE/)).toBeTruthy();
    expect(review.textContent).not.toContain('TCS');
    // Nothing runs on its own: the review is still a question.
    expect(run).not.toHaveBeenCalled();
    expect(within(review).getByRole('button', { name: 'Use these assumptions and run' })).toBeTruthy();

    fireEvent.click(within(review).getByRole('button', { name: 'Use these assumptions and run' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect((run.mock.calls[0][0] as StrategyAST).universe.symbolId).toBe(7);
  });

  it('says a screen with no matches has nothing to backtest, without asking for a ticker', async () => {
    vi.mocked(requestScan).mockResolvedValue(scanOf([]));
    render(<AiCopilotDock strategy={validStrategy()} symbols={[reliant, tcs]} onResearchBacktest={vi.fn()} />);
    send('Screen Nifty 50 for RSI above 60');
    await screen.findByLabelText('Screen results');

    send('Backtest the top match');
    expect(await screen.findByText('This screen found no matches, so there is nothing to backtest. Widen a condition or run a new screen.')).toBeTruthy();
    expect(screen.queryByText(/Which stock should I test/)).toBeNull();
    expect(screen.queryByRole('article', { name: 'Backtest review' })).toBeNull();
  });

  it('still asks for a stock when there is no finished scan', async () => {
    render(<AiCopilotDock strategy={validStrategy()} symbols={[reliant, tcs]} onResearchBacktest={vi.fn()} />);
    send('Backtest the top match');
    expect(await screen.findByText(/Which stock should I test/)).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'Backtest review' })).toBeNull();
  });

  it('lets a named ticker win over the row number', async () => {
    vi.mocked(requestScan).mockResolvedValue(scanOf([row(7, 'RELIANCE', 'Reliance Industries'), row(5, 'TCS', 'Tata Consultancy Services')]));
    const run = vi.fn().mockResolvedValue(undefined);
    render(<AiCopilotDock strategy={validStrategy()} symbols={[reliant, tcs]} onResearchBacktest={run} />);
    send('Screen Nifty 50 for RSI above 60');
    await screen.findByLabelText('Screen results');

    send('Backtest the top match on TCS');
    const review = await screen.findByRole('article', { name: 'Backtest review' });
    expect(within(review).getByText(/Backtest TCS/)).toBeTruthy();
    fireEvent.click(within(review).getByRole('button', { name: 'Use these assumptions and run' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect((run.mock.calls[0][0] as StrategyAST).universe.symbolId).toBe(5);
  });
});
