// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AiCopilotDock } from '../../components/chat/AiCopilotDock';
import { validStrategy } from '../../server/ai/testFixtures';
import { requestResearchChat } from '../../client/researchChat';
import type { BacktestResponse } from '../../shared/strategy/types';

vi.mock('../../client/researchChat', () => ({ requestResearchChat: vi.fn() }));
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
    vi.mocked(requestResearchChat).mockResolvedValue(conversation('A trailing stop follows the price and closes the position when it falls.'));
    await completedRun();

    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'What is a trailing stop? One sentence.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    expect(await screen.findByText(/A trailing stop follows the price/)).toBeTruthy();
    expect(screen.queryByText(/set aside the backtest review/i)).toBeNull();
    // The review is spent: the result card is the record of the run.
    expect(screen.queryByRole('article', { name: 'Backtest review' })).toBeNull();
  });

  it('keeps its result card right after the completion line, above later messages', async () => {
    vi.mocked(requestResearchChat).mockResolvedValue(conversation('A trailing stop follows the price and closes the position when it falls.'));
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
    vi.mocked(requestResearchChat).mockResolvedValue(conversation('Sure.'));
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
    vi.mocked(requestResearchChat).mockResolvedValue(conversation('A trailing stop follows the price and closes the position when it falls.'));
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
});
