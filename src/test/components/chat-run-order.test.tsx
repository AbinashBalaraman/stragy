// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AiCopilotDock } from '../../components/chat/AiCopilotDock';
import { validStrategy } from '../../server/ai/testFixtures';
import { resetEngineHarness, engineReply } from '../../test/support/engineMock';
import { requestScan } from '../../client/api';
import type { BacktestResponse } from '../../shared/strategy/types';

vi.mock('../../client/engine', async () => await import('../../test/support/engineMock'));
vi.mock('../../client/api', () => ({ requestScan: vi.fn() }));
vi.mock('../../client/featureSetup', () => ({ requestFeatureSetup: vi.fn() }));

const symbol = { id: 7, ticker: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE' as const, sector: 'Energy', currentPrice: 2900, changePercent: 0.5 };

const resultFor = (strategy: unknown): BacktestResponse => ({
  backtestId: 'run-1',
  strategy,
  symbol,
  metrics: { initialCapital: 100000, finalEquity: 101031.32, netPnl: 1031.32, totalReturnPercent: 1.03, cagr: 0.34, sharpeRatio: 0.39, maxDrawdownPercent: 1.17, totalTrades: 13, unavailableReasons: {} },
  equityCurve: [{ date: '2025-01-01', timestamp: 1, equity: 100000, drawdown: 0, drawdownPercent: 0, benchmarkEquity: 100000 }, { date: '2025-02-01', timestamp: 2, equity: 101031, drawdown: 0, drawdownPercent: 0, benchmarkEquity: 100000 }],
  trades: [],
  bars: [{ date: '2025-01-01' }, { date: '2025-02-01' }],
  provenance: { mode: 'real', source: 'ANGEL_SMARTAPI', asOf: '2025-02-01', actualRange: { start: '2025-01-01', end: '2025-02-01' } },
  warnings: [],
} as unknown as BacktestResponse);

const conversation = (text: string) => ({
  schemaVersion: 1, kind: 'conversation', originatingRevision: 1, message: text,
  method: 'local_heuristic', provider: { name: 'none', model: null, aiGenerated: false }, warnings: [],
} as never);

let dom: JSDOM;

beforeEach(() => {
  resetEngineHarness();
  dom = new JSDOM('', { url: 'https://run-order.test' });
  vi.stubGlobal('localStorage', dom.window.localStorage);
});

afterEach(() => {
  cleanup();
  dom.window.close();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function completedRun() {
  render(
    <AiCopilotDock
      strategy={validStrategy()}
      symbols={[symbol]}
      onResearchBacktest={async candidate => resultFor(candidate)}
    />
  );
  fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'Backtest RELIANCE with my current strategy' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
  await screen.findByRole('article', { name: 'Backtest review' });
  fireEvent.click(screen.getByRole('button', { name: 'Use these assumptions and run' }));
  expect(await screen.findByRole('article', { name: 'Backtest result' })).toBeTruthy();
  expect(screen.getByText(/Backtest completed/)).toBeTruthy();
}

describe('a run that has already completed', () => {
  it('is not set aside when the next question arrives', async () => {
    engineReply(conversation('A trailing stop follows the price and closes the position when it falls.'));
    await completedRun();

    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'What is a trailing stop? One sentence.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    expect(await screen.findByText(/A trailing stop follows the price/)).toBeTruthy();
    expect(screen.queryByText(/set aside the backtest review/i)).toBeNull();
    // The review is spent: the result card is the record of the run.
    expect(screen.queryByRole('article', { name: 'Backtest review' })).toBeNull();
  });

  it('keeps its result card right after the completion line, above later messages', async () => {
    engineReply(conversation('A trailing stop follows the price and closes the position when it falls.'));
    await completedRun();

    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'What is a trailing stop? One sentence.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    const answer = await screen.findByText(/A trailing stop follows the price/);

    const done = screen.getByText(/Backtest completed/);
    const card = screen.getByRole('article', { name: 'Backtest result' });
    expect(done.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The question that came later is below the result, not above it.
    const question = screen.getByText('What is a trailing stop? One sentence.');
    expect(card.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('still sets aside a review that is only waiting for approval', async () => {
    engineReply(conversation('Sure.'));
    render(<AiCopilotDock strategy={validStrategy()} symbols={[symbol]} onResearchBacktest={async candidate => resultFor(candidate)} />);
    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'Backtest RELIANCE with my current strategy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('article', { name: 'Backtest review' });

    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'What is RSI?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText(/set aside the backtest review that was waiting for approval/i)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Backtest review' })).toBeNull());
  });

  it('shows a plain failure line with Retry and never sets a failed run aside', async () => {
    engineReply(conversation('A trailing stop follows the price and closes the position when it falls.'));
    const rateLimit = Object.assign(new Error('Angel One rate limit reached; the request will be retried after a short backoff'), { code: 'RATE_LIMITED', status: 429 });
    const run = vi.fn().mockRejectedValue(rateLimit);
    render(<AiCopilotDock strategy={validStrategy()} symbols={[symbol]} onResearchBacktest={run} />);
    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'Backtest RELIANCE with my current strategy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('article', { name: 'Backtest review' });
    fireEvent.click(screen.getByRole('button', { name: 'Use these assumptions and run' }));

    const plain = "The backtest didn't finish: Angel One is busy. Try again in a minute.";
    expect(await screen.findByText(plain)).toBeTruthy();
    // Raw provider text and the appended reassurance never reach the transcript.
    expect(screen.queryByText(/rate limit reached/i)).toBeNull();
    expect(screen.queryByText(/No results were invented/i)).toBeNull();
    // One Retry: on the review card, not also in the message action row.
    const retry = within(screen.getByRole('article', { name: 'Backtest review' })).getByRole('button', { name: 'Retry' });

    // Retry reruns the same reviewed assumptions.
    fireEvent.click(retry);
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));

    // A later question must not claim the failed review was "waiting for approval".
    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'What is a trailing stop? One sentence.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText(/A trailing stop follows the price/)).toBeTruthy();
    expect(screen.queryByText(/set aside the backtest review/i)).toBeNull();
    expect(screen.getByRole('article', { name: 'Backtest review' })).toBeTruthy();
  });

  it('maps a timeout to the same plain failure line', async () => {
    const timeout = Object.assign(new Error('Research request deadline exceeded. Results are unavailable.'), { code: 'CLIENT_DEADLINE' });
    render(<AiCopilotDock strategy={validStrategy()} symbols={[symbol]} onResearchBacktest={vi.fn().mockRejectedValue(timeout)} />);
    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'Backtest RELIANCE with my current strategy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('article', { name: 'Backtest review' });
    fireEvent.click(screen.getByRole('button', { name: 'Use these assumptions and run' }));
    expect(await screen.findByText("The backtest didn't finish in time. Try again in a minute.")).toBeTruthy();
    expect(screen.queryByText(/deadline exceeded/i)).toBeNull();
  });

  it('shows the queued-run line instead of the running skeleton', async () => {
    let finish!: (value: BacktestResponse) => void;
    const run = vi.fn(() => new Promise<BacktestResponse>(resolve => { finish = resolve; }));
    render(<AiCopilotDock strategy={validStrategy()} symbols={[symbol]} onResearchBacktest={run} runPhase="waiting" />);
    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'Backtest RELIANCE with my current strategy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('article', { name: 'Backtest review' });
    fireEvent.click(screen.getByRole('button', { name: 'Use these assumptions and run' }));

    expect(await screen.findByText('Waiting for the current scan to finish…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Waiting…' })).toBeTruthy();
    // The card owns the progress line while the job is queued.
    expect(screen.queryByText(/Backtest running on the reviewed assumptions/)).toBeNull();
    finish(resultFor(validStrategy()));
  });

  it('accepts a run whose data ends before the reviewed cutoff', async () => {
    // The screen says "cutoff 17 Nov"; the newest bar is 16 Nov.
    vi.mocked(requestScan).mockResolvedValue({
      mode: 'real', universe: 'NIFTY_50', scanned: 50, matched: 1, scannedAt: '2026-11-17T12:00:00Z',
      dataSource: 'PROVENANCE_PER_SYMBOL', requested: 50, attempted: 50, succeeded: 50, unavailable: 0, failed: 0,
      offset: 0, limit: 100, errors: [], sourceCoverage: { ANGEL_SMARTAPI: 50 }, warnings: [],
      observationDates: { earliest: '2024-11-18', latest: '2026-11-17', staleSymbols: 0 },
      matches: [{
        symbolId: 7, ticker: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy',
        // The screen's cutoff is the session date (today); the newest bar is yesterday.
        lastDate: '2026-11-17', lastClose: 2900, changePercent: 0.5, matchedRules: [], indicatorValues: {},
        provenance: { mode: 'real', source: 'ANGEL_SMARTAPI', symbolId: 7, asOf: '2026-11-17', fetchedAt: '2026-11-17T12:00:00Z', requestedRange: {}, actualRange: { start: '2024-11-18', end: '2026-11-16' }, adjustment: 'split', checksum: 'fixture', coverage: 'full', freshness: 'FRESH', warnings: [], calendarVersion: 'v1' },
      }],
      nearMatches: [],
    } as never);
    engineReply({
      schemaVersion: 1, kind: 'screen', originatingRevision: 1, message: 'Screen planned.',
      method: 'rule_parser', provider: { name: 'none', model: null, aiGenerated: false }, warnings: [],
      universe: 'NIFTY_50', strategy: validStrategy(), assumptions: [], missingBacktestRules: ['exits'], backtestReady: false,
      __engineTool: {
        name: 'scan_market',
        run: async () => ({ result: await vi.mocked(requestScan)({ universe: 'NIFTY_50', strategy: validStrategy() }) }),
      },
    } as never);

    const withYesterday = (candidate: unknown) => ({
      ...resultFor(candidate),
      provenance: { mode: 'real', source: 'ANGEL_SMARTAPI', asOf: '2026-11-16', actualRange: { start: '2024-11-18', end: '2026-11-16' } },
      bars: [{ date: '2024-11-18' }, { date: '2026-11-16' }],
    } as unknown as BacktestResponse);

    render(<AiCopilotDock strategy={validStrategy()} symbols={[symbol]} onResearchBacktest={async candidate => withYesterday(candidate)} />);
    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'Screen Nifty 50 for RSI below 30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('article', { name: 'Research screen' });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare backtest for RELIANCE' }));
    await screen.findByRole('article', { name: 'Backtest review' });
    fireEvent.click(screen.getByRole('button', { name: 'Use these assumptions and run' }));

    expect(await screen.findByRole('article', { name: 'Backtest result' })).toBeTruthy();
    expect(screen.queryByText(/did not return a current validated result/)).toBeNull();
  });
});
