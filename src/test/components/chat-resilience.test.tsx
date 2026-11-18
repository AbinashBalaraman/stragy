// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AiCopilotDock, PENDING_SCAN_KEY } from '../../components/chat/AiCopilotDock';
import { validStrategy } from '../../server/ai/testFixtures';
import { cancelResearchJob, checkBacktestJob, checkScanJob, requestScan } from '../../client/api';
import { engineReply, resetEngineHarness } from '../../test/support/engineMock';
import type { BacktestResponse } from '../../shared/strategy/types';
import type { ResearchScreenPlan } from '../../shared/contracts/research-chat';

vi.mock('../../client/engine', async () => await import('../../test/support/engineMock'));
vi.mock('../../client/api', () => ({
  requestScan: vi.fn(),
  checkScanJob: vi.fn(),
  checkBacktestJob: vi.fn(),
  cancelResearchJob: vi.fn(),
}));
vi.mock('../../client/featureSetup', () => ({ requestFeatureSetup: vi.fn() }));

const symbol = { id: 7, ticker: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE' as const, sector: 'Energy', currentPrice: 2900, changePercent: 0.5 };

const scanResult = {
  mode: 'real', universe: 'NIFTY_50', scanned: 50, matched: 1, scannedAt: '2026-11-17T12:00:00Z',
  dataSource: 'PROVENANCE_PER_SYMBOL', requested: 50, attempted: 50, succeeded: 50, unavailable: 0, failed: 0,
  offset: 0, limit: 100, errors: [], sourceCoverage: { ANGEL_SMARTAPI: 50 }, warnings: [],
  observationDates: { earliest: '2024-11-18', latest: '2026-11-16', staleSymbols: 0 },
  matches: [{
    symbolId: 7, ticker: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy',
    lastDate: '2026-11-16', lastClose: 2900, changePercent: 0.5, matchedRules: [], indicatorValues: {},
    provenance: { mode: 'real', source: 'ANGEL_SMARTAPI', symbolId: 7, asOf: '2026-11-16', fetchedAt: '2026-11-17T12:00:00Z', requestedRange: {}, actualRange: { start: '2024-11-18', end: '2026-11-16' }, adjustment: 'split', checksum: 'x', coverage: 'full', freshness: 'FRESH', warnings: [], calendarVersion: 'v1' },
  }],
  nearMatches: [],
};

const plan = (): ResearchScreenPlan => ({
  schemaVersion: 1,
  kind: 'screen',
  originatingRevision: 1,
  message: 'Screen planned.',
  method: 'rule_parser',
  provider: { name: 'none', model: null, aiGenerated: false },
  warnings: [],
  universe: 'NIFTY_50',
  strategy: validStrategy(),
  assumptions: [],
  missingBacktestRules: ['exits'],
  backtestReady: false,
} as unknown as ResearchScreenPlan);

const screenReply = () => ({
  schemaVersion: 1, kind: 'screen', originatingRevision: 1, message: 'Scanning Nifty 50 for RSI above 60.',
  method: 'rule_parser', provider: { name: 'none', model: null, aiGenerated: false }, warnings: [],
  universe: 'NIFTY_50', strategy: validStrategy(), assumptions: [], missingBacktestRules: ['exits'], backtestReady: false,
} as never);

const deadline = (jobId: string) => Object.assign(new Error('Research request deadline exceeded.'), { code: 'CLIENT_DEADLINE', jobId });
const lost = () => Object.assign(new Error('Job not found.'), { code: 'JOB_NOT_FOUND' });

let dom: JSDOM;

beforeEach(() => {
  dom = new JSDOM('', { url: 'https://chat-resilience.test' });
  vi.stubGlobal('localStorage', dom.window.localStorage);
  window.history.replaceState({}, '', '/');
  resetEngineHarness();
  engineReply({
    ...(screenReply() as Record<string, unknown>),
    __engineTool: {
      name: 'scan_market',
      run: async () => {
        try { return { result: await vi.mocked(requestScan)({ universe: 'NIFTY_50', strategy: validStrategy() }) }; }
        catch (error) {
          const failure = error as { code?: string; message?: string; jobId?: string };
          return { error: { ...(failure.code ? { code: failure.code } : {}), ...(failure.message ? { message: failure.message } : {}), ...(failure.jobId ? { jobId: failure.jobId } : {}) } };
        }
      },
    },
  });
  vi.mocked(cancelResearchJob).mockResolvedValue(undefined);
  vi.mocked(checkScanJob).mockResolvedValue({ state: 'running' });
  vi.mocked(checkBacktestJob).mockResolvedValue({ state: 'running' });
});

afterEach(() => {
  cleanup();
  dom.window.close();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const send = (text: string) => {
  fireEvent.change(screen.getByLabelText('Research request'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
};

describe('a scan interrupted by a reload', () => {
  it('restores an actionable card instead of a silent empty turn', () => {
    dom.window.localStorage.setItem(PENDING_SCAN_KEY, JSON.stringify({ plan: plan(), startedAt: Date.now() }));
    render(<AiCopilotDock strategy={validStrategy()} />);
    const card = screen.getByRole('article', { name: 'Research screen' });
    expect(within(card).getByText('The page reloaded while the scan was running. Run the scan again.')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Retry scan' })).toBeTruthy();
  });

  it('forgets a scan that finished, so a reload does not resurrect it', async () => {
    vi.mocked(requestScan).mockResolvedValue(scanResult as never);
    render(<AiCopilotDock strategy={validStrategy()} />);
    send('Screen Nifty 50 for RSI above 60');
    await screen.findByLabelText('Screen results');
    expect(localStorage.getItem(PENDING_SCAN_KEY)).toBeNull();
    cleanup();
    render(<AiCopilotDock strategy={validStrategy()} />);
    expect(screen.queryByRole('article', { name: 'Research screen' })).toBeNull();
  });
});

describe('a scan the client stopped waiting for', () => {
  it('keeps the job, offers Check again, and shows the results when it finishes', async () => {
    vi.mocked(requestScan).mockRejectedValue(deadline('slow-scan'));
    vi.mocked(checkScanJob)
      .mockResolvedValueOnce({ state: 'running', stage: 'scan 6/50' })
      .mockResolvedValueOnce({ state: 'done', result: scanResult as never });
    render(<AiCopilotDock strategy={validStrategy()} />);
    send('Screen Nifty 50 for RSI above 60');
    const card = await screen.findByRole('article', { name: 'Research screen' });
    expect(await within(card).findByText('The scan is still running on the server. Check again.')).toBeTruthy();

    fireEvent.click(within(card).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(checkScanJob).toHaveBeenCalledWith('slow-scan'));
    expect(within(card).getByText('The scan is still running on the server. Check again.')).toBeTruthy();

    fireEvent.click(within(card).getByRole('button', { name: 'Check again' }));
    expect(await screen.findByLabelText('Screen results')).toBeTruthy();
    expect(screen.getByText('1 match')).toBeTruthy();
  });

  it('falls back to the lost-scan copy when the job is gone, with Retry scan', async () => {
    vi.mocked(requestScan).mockRejectedValue(deadline('gone-scan'));
    vi.mocked(checkScanJob).mockRejectedValue(lost());
    render(<AiCopilotDock strategy={validStrategy()} />);
    send('Screen Nifty 50 for RSI above 60');
    const card = await screen.findByRole('article', { name: 'Research screen' });
    fireEvent.click(await within(card).findByRole('button', { name: 'Check again' }));
    expect(await within(card).findByText('The server restarted and the scan was lost. Try again.')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Retry scan' })).toBeTruthy();
  });

  it('cancels a still-running scan on the server', async () => {
    vi.mocked(requestScan).mockRejectedValue(deadline('cancel-scan'));
    render(<AiCopilotDock strategy={validStrategy()} />);
    send('Screen Nifty 50 for RSI above 60');
    const card = await screen.findByRole('article', { name: 'Research screen' });
    fireEvent.click(await within(card).findByRole('button', { name: 'Cancel scan' }));
    await waitFor(() => expect(cancelResearchJob).toHaveBeenCalledWith('cancel-scan'));
    // The cancel deletes the server job, then the card says so in plain words.
    expect(await screen.findByText('Scan cancelled. Nothing was matched.')).toBeTruthy();
    expect(screen.queryByText('The scan is still running on the server. Check again.')).toBeNull();
  });
});

describe('a backtest the client stopped waiting for', () => {
  it('offers Check again and completes from the re-poll', async () => {
    const resultFor = (strategy: unknown) => ({
      backtestId: 'run-1',
      strategy,
      symbol,
      metrics: { initialCapital: 100000, finalEquity: 101000, netPnl: 1000, totalReturnPercent: 1, cagr: 1, sharpeRatio: 1, maxDrawdownPercent: 1, totalTrades: 1, unavailableReasons: {} },
      equityCurve: [],
      trades: [],
      bars: [{ date: '2025-01-01' }, { date: '2025-02-01' }],
      provenance: { mode: 'real', source: 'ANGEL_SMARTAPI', actualRange: { start: '2025-01-01', end: '2025-02-01' } },
      warnings: [],
    } as unknown as BacktestResponse);
    const run = vi.fn().mockRejectedValue(deadline('slow-run'));
    vi.mocked(checkBacktestJob).mockImplementation(async () => ({ state: 'done', result: resultFor(vi.mocked(run).mock.calls[0]?.[0]) }));

    render(<AiCopilotDock strategy={validStrategy()} symbols={[symbol]} onResearchBacktest={run} />);
    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'Backtest RELIANCE with my current strategy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    const card = await screen.findByRole('article', { name: 'Backtest review' });
    fireEvent.click(within(card).getByRole('button', { name: 'Use these assumptions and run' }));
    expect(await within(card).findByText('The backtest is still running. Check again.')).toBeTruthy();

    fireEvent.click(within(card).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(checkBacktestJob).toHaveBeenCalledWith('slow-run'));
    expect(await screen.findByRole('article', { name: 'Backtest result' })).toBeTruthy();
  });
});
