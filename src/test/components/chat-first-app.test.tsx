// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import { researchChat } from '../../server/ai/researchChat';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import type { BacktestResponse, StrategyAST } from '../../shared/strategy/types';

vi.mock('../../components/strategy/StrategyBuilder', () => ({
  StrategyBuilder: () => <div data-testid="builder-view">Strategy builder view</div>,
}));
vi.mock('../../components/results/ResultsDashboard', () => ({
  ResultsDashboard: ({ result }: { result: { backtestId?: string } | null }) => (
    <div data-testid="results-view">Results view · <span data-testid="results-id">{result?.backtestId ?? 'none'}</span></div>
  ),
}));
vi.mock('../../components/scanner/MarketScannerView', () => ({
  MarketScannerView: () => <div data-testid="scanner-view">Scanner view</div>,
}));
vi.mock('../../components/library/StrategyLibraryView', () => ({
  StrategyLibraryView: () => <div data-testid="library-view">Library view</div>,
}));
vi.mock('../../client/researchChat', () => ({
  requestResearchChat: vi.fn(),
}));
vi.mock('../../client/api', () => ({
  requestScan: vi.fn(),
  requestBacktest: vi.fn(),
}));

import { requestResearchChat } from '../../client/researchChat';
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
  vi.mocked(requestResearchChat).mockResolvedValue(chatResponse as never);
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
  it('opens on the conversation with advanced build tools hidden', async () => {
    render(<App />);
    expect(await screen.findByText('What would you like to research?')).toBeTruthy();
    expect(screen.getByLabelText('Research conversation')).toBeTruthy();
    expect(sidebar().getByRole('button', { name: 'Conversation' })).toBeTruthy();

    expect(screen.queryByRole('button', { name: 'Strategy builder' })).toBeNull();
    expect(screen.queryByTestId('builder-view')).toBeNull();
    expect(screen.queryByTestId('results-view')).toBeNull();
    expect(screen.queryByTestId('scanner-view')).toBeNull();
    expect(screen.queryByRole('button', { name: /Run current workspace/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open scanner/i })).toBeNull();
    await screen.findByText('Saved locally');
  });

  it('keeps the conversation mounted and its history intact while advanced views are open', async () => {
    render(<App />);
    await screen.findByText('What would you like to research?');

    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'Which assumptions are you using?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Validated reply only.')).toBeTruthy();

    fireEvent.click(sidebar().getByRole('button', { name: /Advanced tools/ }));
    fireEvent.click(sidebar().getByRole('button', { name: 'Strategy builder' }));
    expect(await screen.findByTestId('builder-view')).toBeTruthy();

    const conversation = screen.getByLabelText('Research conversation');
    expect(conversation.closest('[hidden]')).toBeTruthy();
    expect(screen.getByText('Validated reply only.')).toBeTruthy();

    fireEvent.click(sidebar().getByRole('button', { name: 'Conversation' }));
    await waitFor(() => expect(screen.queryByTestId('builder-view')).toBeNull());
    expect(screen.getByLabelText('Research conversation').closest('[hidden]')).toBeNull();
    expect(screen.getByText('Validated reply only.')).toBeTruthy();
    expect(screen.queryByText(/A previous conversation is saved/)).toBeNull();

    fireEvent.click(sidebar().getByRole('button', { name: 'New chat' }));
    expect(await screen.findByText('What would you like to research?')).toBeTruthy();
    const restore = await screen.findByRole('button', { name: /Restore previous conversation/ });
    fireEvent.click(restore);
    expect(await screen.findByText('Validated reply only.')).toBeTruthy();
  });

  it('hides the conversation headline on New chat while retaining advanced analytics history', async () => {
    let retainedId = '';
    const plan = await researchChat({
      message: 'Find Nifty 50 RSI oversold now after recently overbought',
      currentStrategy: STRATEGY_TEMPLATES[0].strategy,
      originatingRevision: 1,
      allowLocalFallback: true,
      history: [],
    }, { env: { AI_PROVIDER: 'none' } });
    expect(plan.kind).toBe('screen');
    vi.mocked(requestResearchChat).mockResolvedValueOnce(plan as never);
    vi.mocked(requestScan).mockResolvedValue(matchedScan as never);
    vi.mocked(requestBacktest).mockImplementation(async (input: StrategyAST) => {
      const result = resultFor(input);
      retainedId = result.backtestId;
      return result;
    });

    render(<App />);
    await screen.findByText('What would you like to research?');
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'Find Nifty 50 RSI oversold now after recently overbought' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByText('1 matches in successfully evaluated stocks.');

    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'backtest this on RELIANCE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('article', { name: 'Backtest review' });
    fireEvent.click(screen.getByRole('button', { name: 'Use these assumptions and run' }));

    expect(await screen.findByText(/Backtest completed/)).toBeTruthy();
    expect(await screen.findByRole('article', { name: 'Backtest result' })).toBeTruthy();

    fireEvent.click(sidebar().getByRole('button', { name: 'New chat' }));
    expect(await screen.findByText('What would you like to research?')).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'Backtest result' })).toBeNull();

    fireEvent.click(sidebar().getByRole('button', { name: /Advanced tools/ }));
    fireEvent.click(sidebar().getByRole('button', { name: 'Backtest analytics' }));
    expect(await screen.findByTestId('results-view')).toBeTruthy();
    expect(screen.getByTestId('results-id').textContent).toBe(retainedId);

    fireEvent.click(sidebar().getByRole('button', { name: 'Conversation' }));
    await waitFor(() => expect(screen.queryByTestId('results-view')).toBeNull());
    expect(await screen.findByText('What would you like to research?')).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'Backtest result' })).toBeNull();
  });
});
