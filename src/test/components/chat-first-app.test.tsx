// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import type { BacktestResponse, StrategyAST } from '../../shared/strategy/types';

vi.mock('../../components/strategy/StrategyBuilder', () => ({
  StrategyBuilder: ({ onRunBacktest }: { onRunBacktest: () => void }) => (
    <div data-testid="builder-view">
      Strategy builder view
      <button type="button" onClick={() => void onRunBacktest()}>Run builder backtest</button>
    </div>
  ),
}));
vi.mock('../../components/results/ResultsDashboard', () => ({
  ResultsDashboard: ({ result, onReRun }: { result: BacktestResponse | null; onReRun: (result?: BacktestResponse) => void }) => (
    <div data-testid="results-view">
      Results view · <span data-testid="results-id">{result?.backtestId ?? 'none'}</span>
      {result && <button type="button" onClick={() => void onReRun(result)}>Re-run displayed</button>}
    </div>
  ),
}));
vi.mock('../../components/scanner/MarketScannerView', () => ({
  MarketScannerView: () => <div data-testid="scanner-view">Scanner view</div>,
}));
vi.mock('../../components/library/StrategyLibraryView', () => ({
  StrategyLibraryView: () => <div data-testid="library-view">Library view</div>,
}));
vi.mock('../../client/engine', async () => await import('../../test/support/engineMock'));
vi.mock('../../client/api', () => ({
  requestScan: vi.fn(),
  requestBacktest: vi.fn(),
}));

import { resetEngineHarness, engineReplyDefault, engineReplyOnce } from '../../test/support/engineMock';
import { requestBacktest, requestScan } from '../../client/api';

let storageDom: JSDOM | undefined;

const chatResponse = {
  schemaVersion: 1,
  kind: 'conversation',
  originatingRevision: 1,
  message: 'Validated reply only.',
  method: 'rule_parser',
  provider: { name: 'none', model: null, aiGenerated: false },
  warnings: [],
};

const withScan = (plan: ReturnType<typeof screenPlan>) => ({
  ...plan,
  __engineTool: {
    name: 'scan_market',
    run: async () => {
      try { return { result: await vi.mocked(requestScan)({ universe: 'NIFTY_50', strategy: plan.strategy }) }; }
      catch (error) { return { error: { message: (error as Error).message } }; }
    },
  },
});

const screenPlan = () => ({
  schemaVersion: 1,
  kind: 'screen',
  originatingRevision: 1,
  message: 'Scanning Nifty 50 for RSI oversold. Nothing is changed or run.',
  method: 'rule_parser',
  provider: { name: 'none', model: null, aiGenerated: false },
  warnings: [],
  universe: 'NIFTY_50',
  strategy: STRATEGY_TEMPLATES[0].strategy,
  assumptions: [],
  missingBacktestRules: ['exits'],
  backtestReady: false,
});

const reliant = { id: 7, ticker: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE' as const, sector: 'Energy', currentPrice: 2900, changePercent: 0.5 };
const matchedScan = {
  mode: 'real' as const, universe: 'NIFTY_50', scanned: 50, matched: 1, scannedAt: '2026-10-15T12:00:00Z',
  dataSource: 'PROVENANCE_PER_SYMBOL', requested: 50, attempted: 50, succeeded: 50, unavailable: 0, failed: 0,
  offset: 0, limit: 100, errors: [], sourceCoverage: { YAHOO_PUBLIC_CHART: 50 }, warnings: [],
  matches: [{
    symbolId: 7, ticker: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy', lastDate: '2026-10-15',
    lastClose: 2900, changePercent: 0.5, matchedRules: [], indicatorValues: {},
    provenance: {
      mode: 'real' as const, source: 'YAHOO_PUBLIC_CHART', symbolId: 7, asOf: '2026-10-15',
      fetchedAt: '2026-10-15T12:00:00Z', requestedRange: {}, actualRange: { start: '2024-10-15', end: '2026-10-15' },
      adjustment: 'split', checksum: 'fixture', coverage: 'full', freshness: 'FRESH', warnings: [], calendarVersion: 'v1',
    },
  }],
};
const resultFor = (strategy: StrategyAST) => ({
  backtestId: 'run-chat-' + strategy.id,
  strategy,
  symbol: reliant,
  metrics: { initialCapital: 100000, finalEquity: 101000, netPnl: 1000, totalReturnPercent: 1, cagr: null, sharpeRatio: null, maxDrawdownPercent: 1, totalTrades: 1, unavailableReasons: {} },
  equityCurve: [], trades: [], costs: {}, robustness: {}, indicatorsData: [], bars: [], executedAt: '2026-10-15T12:00:00Z', warnings: [],
  provenance: { mode: 'real', source: 'YAHOO_PUBLIC_CHART', asOf: '2026-10-15' },
} as unknown as BacktestResponse);

beforeEach(() => {
  storageDom = new JSDOM('', { url: 'https://app.test/' });
  vi.stubGlobal('localStorage', storageDom.window.localStorage);
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_name: string, callback: () => Promise<unknown>) => callback() },
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      mode: 'real',
      symbols: [{ id: 7, ticker: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE', sector: 'Energy', currentPrice: 2900, changePercent: 0.5 }],
    }),
  })));
  resetEngineHarness();
  engineReplyDefault(chatResponse);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  storageDom?.window.close();
  storageDom = undefined;
});

const sidebar = () => within(screen.getByRole('complementary', { name: 'Workspace navigation' }));

describe('chat-first application shell', () => {
  it('opens on the conversation with the research rail visible', async () => {
    render(<App />);
    expect(await screen.findByText('Test a trading idea before you trust it.')).toBeTruthy();
    expect(screen.getByLabelText('Research conversation')).toBeTruthy();
    expect(sidebar().getByRole('button', { name: 'Chat' })).toBeTruthy();
    expect(sidebar().getByRole('button', { name: 'Strategy tester' })).toBeTruthy();
    expect(screen.queryByTestId('builder-view')).toBeNull();
    expect(screen.queryByTestId('results-view')).toBeNull();
    expect(screen.queryByTestId('scanner-view')).toBeNull();
    expect(screen.queryByRole('button', { name: /Run current workspace/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open scanner/i })).toBeNull();
    // Mounting the unchanged initial workspace no longer writes a new revision,
    // and a settled save state stays out of the rail.
    expect(window.localStorage.getItem('stragy_workspace_v1')).toBeNull();
    expect(screen.queryByText(/Workspace unchanged/)).toBeNull();
  });

  it('keeps the conversation mounted and its history intact while another rail view is open', async () => {
    render(<App />);
    await screen.findByText('Test a trading idea before you trust it.');

    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'Which assumptions are you using?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Validated reply only.')).toBeTruthy();

    fireEvent.click(sidebar().getByRole('button', { name: 'Strategy tester' }));
    expect(await screen.findByTestId('builder-view')).toBeTruthy();

    const conversation = screen.getByLabelText('Research conversation');
    expect(conversation.closest('[hidden]')).toBeTruthy();
    expect(screen.getByText('Validated reply only.')).toBeTruthy();

    fireEvent.click(sidebar().getByRole('button', { name: 'Chat' }));
    await waitFor(() => expect(screen.queryByTestId('builder-view')).toBeNull());
    expect(screen.getByLabelText('Research conversation').closest('[hidden]')).toBeNull();
    expect(screen.getByText('Validated reply only.')).toBeTruthy();
    expect(screen.queryByText(/A previous conversation is saved/)).toBeNull();

  });

  it('hides the conversation headline on New chat while retaining advanced analytics history', async () => {
    let retainedId = '';
    const plan = screenPlan();
    engineReplyOnce(withScan(plan));
    vi.mocked(requestScan).mockResolvedValue(matchedScan as never);
    vi.mocked(requestBacktest).mockImplementation(async (input: StrategyAST) => {
      const result = resultFor(input);
      retainedId = result.backtestId;
      return result;
    });

    render(<App />);
    await screen.findByText('Test a trading idea before you trust it.');
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'Find Nifty 50 RSI oversold now after recently overbought' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByLabelText('Screen results');

    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'backtest this on RELIANCE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('article', { name: 'Backtest review' });
    fireEvent.click(screen.getByRole('button', { name: 'Use these assumptions and run' }));

    expect(await screen.findByText(/Backtest completed/)).toBeTruthy();
    expect(await screen.findByRole('article', { name: 'Backtest result' })).toBeTruthy();

    fireEvent.click(sidebar().getByRole('button', { name: 'New chat' }));
    expect(await screen.findByText('Test a trading idea before you trust it.')).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'Backtest result' })).toBeNull();

    fireEvent.click(sidebar().getByRole('button', { name: 'Backtest results' }));
    expect(await screen.findByTestId('results-view')).toBeTruthy();
    expect(screen.getByTestId('results-id').textContent).toBe(retainedId);

    fireEvent.click(sidebar().getByRole('button', { name: 'Chat' }));
    await waitFor(() => expect(screen.queryByTestId('results-view')).toBeNull());
    expect(await screen.findByText('Test a trading idea before you trust it.')).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'Backtest result' })).toBeNull();
  });

  it('puts the market scanner inside a vertical scroll container', async () => {
    render(<App />);
    await screen.findByText('Test a trading idea before you trust it.');
    fireEvent.click(sidebar().getByRole('button', { name: 'Market scanner' }));
    const scanner = await screen.findByTestId('scanner-view');
    expect(scanner.parentElement?.className).toContain('overflow-y-auto');
  });

  it('opens analytics on the chat result retained in the conversation, not a later builder run', async () => {
    const plan = screenPlan();
    engineReplyOnce(withScan(plan));
    vi.mocked(requestScan).mockResolvedValue(matchedScan as never);
    let runNumber = 0;
    vi.mocked(requestBacktest).mockImplementation(async (input: StrategyAST) => ({
      ...resultFor(input),
      backtestId: 'run-' + (++runNumber),
    } as BacktestResponse));

    render(<App />);
    await screen.findByText('Test a trading idea before you trust it.');
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'Find Nifty 50 RSI oversold now after recently overbought' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByLabelText('Screen results');
    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'backtest this on RELIANCE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('article', { name: 'Backtest review' });
    fireEvent.click(screen.getByRole('button', { name: 'Use these assumptions and run' }));
    expect(await screen.findByText(/Backtest completed/)).toBeTruthy();

    // A builder run replaces the App's selected result with a different run.
    fireEvent.click(sidebar().getByRole('button', { name: 'Strategy tester' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Run builder backtest' }));
    expect(await screen.findByTestId('results-view')).toBeTruthy();
    expect((await screen.findByTestId('results-id')).textContent).toBe('run-2');

    // View details must select the conversation's validated run (run-1).
    fireEvent.click(sidebar().getByRole('button', { name: 'Chat' }));
    fireEvent.click(await screen.findByRole('button', { name: 'View details' }));
    expect(await screen.findByTestId('results-view')).toBeTruthy();
    expect(screen.getByTestId('results-id').textContent).toBe('run-1');

    // Re-Simulate must re-run that retained result and its request context,
    // not the current builder draft.
    fireEvent.click(screen.getByRole('button', { name: 'Re-run displayed' }));
    await waitFor(() => expect(requestBacktest).toHaveBeenCalledTimes(3));
    const calls = vi.mocked(requestBacktest).mock.calls;
    expect(calls[2][0]).toEqual(calls[0][0]);
    expect(calls[2][2]).toMatchObject({ initialCapital: 100000 });
  });
});
