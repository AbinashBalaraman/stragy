// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AiCopilotDock } from '../../components/chat/AiCopilotDock';
import { validStrategy } from '../../server/ai/testFixtures';
import {
  createEngineSession, deleteEngineSession, exportEngineSession, getEngineMessages, getEngineUsage,
  getJobStatus, getMarketCache, getProviderStatus, listEngineSessions, listJobs, postEngineMessage,
  refreshMarketCache, renameEngineSession, switchEngineModel, cancelJob, resumeJob,
} from '../../client/engine';
import {
  engineReply, engineReplyDefault, resetEngineHarness, setEngineSessions, setStoredEngineSession,
} from '../../test/support/engineMock';

vi.mock('../../client/engine', async () => await import('../../test/support/engineMock'));
vi.mock('../../client/api', () => ({
  requestScan: vi.fn(),
  checkScanJob: vi.fn(),
  checkBacktestJob: vi.fn(),
  cancelResearchJob: vi.fn(),
}));
vi.mock('../../client/featureSetup', () => ({ requestFeatureSetup: vi.fn() }));

const symbol = { id: 7, ticker: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE' as const, sector: 'Energy', currentPrice: 2900, changePercent: 0.5 };

const conversation = (text: string) => ({
  schemaVersion: 1 as const,
  kind: 'conversation' as const,
  originatingRevision: 1,
  message: text,
  method: 'local_heuristic' as const,
  provider: { name: 'none', model: null, aiGenerated: false },
  warnings: [],
});

const usageWith = (overrides: Record<string, unknown> = {}) => ({
  stats: { sessions: 3, prompts: 12, steps: 40, tokens: { input: 1200, output: 340 }, cost: 0.42, models: [] },
  warnings: [] as string[],
  limits: null,
  sessions: [],
  ...overrides,
});

let dom: JSDOM;

beforeEach(() => {
  resetEngineHarness();
  dom = new JSDOM('', { url: 'https://management.test/' });
  vi.stubGlobal('localStorage', dom.window.localStorage);
  window.history.replaceState({}, '', '/');
  vi.mocked(getEngineMessages).mockResolvedValue({ messages: [], lastSeq: 0 } as never);
  vi.mocked(getEngineUsage).mockResolvedValue(usageWith() as never);
  vi.mocked(getProviderStatus).mockResolvedValue({
    ai: { ready: true, models: ['hy4-flash-free', 'deepseek-v4.1-flash'], modelChain: ['hy4-flash-free → deepseek-v4.1-flash'] },
    market: { configured: true, connected: true },
    voice: { configured: true, model: 'whisper-large-v3' },
  } as never);
  vi.mocked(getMarketCache).mockResolvedValue({
    symbols: 2051, bars: 1_245_000, firstDate: '2021-11-18', lastDate: '2026-11-17',
    dbBytes: 1_258_291, hits: 412, misses: 38, incrementalFetches: 9, lastFetchAt: '2026-11-18T04:00:00Z', dbPath: '.data/market/candles.db',
  } as never);
  vi.mocked(listJobs).mockResolvedValue([] as never);
  vi.mocked(refreshMarketCache).mockResolvedValue({ status: 'done', refreshed: 2051, failed: 0 } as never);
});

afterEach(() => {
  cleanup();
  dom.window.close();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const openHistory = async () => {
  fireEvent.click(screen.getByTestId('chat-history-toggle'));
  await screen.findByTestId('history-panel');
};

const send = (text: string) => {
  fireEvent.change(screen.getByLabelText('Research request'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
};

describe('engine chat history', () => {
  it('lists title, relative time and model, and uses a neutral fallback for a missing title', async () => {
    setEngineSessions([
      { sessionId: 'ses_old', title: 'NSE RSI scan', updatedAt: new Date(Date.now() - 3_600_000).toISOString(), model: { providerID: 'opencode-go', id: 'hy4-flash-free' } },
      { sessionId: 'ses_untitled', updatedAt: new Date(Date.now() - 60_000).toISOString() },
    ]);
    render(<AiCopilotDock strategy={validStrategy()} symbols={[symbol]} />);
    await openHistory();
    expect(await screen.findByText('NSE RSI scan')).toBeTruthy();
    expect(screen.getByText('Untitled chat')).toBeTruthy();
    expect(screen.queryByText(/undefined/)).toBeNull();
    const rows = screen.getAllByTestId('session-row');
    const untitled = rows.find(row => row.textContent?.includes('Untitled chat'));
    expect(untitled && within(untitled).getByText('1m ago')).toBeTruthy();
    const titled = rows.find(row => row.textContent?.includes('NSE RSI scan'));
    expect(titled && within(titled).getByText(/hy4-flash-free/)).toBeTruthy();
  });

  it('renames, exports and deletes with explicit confirmations', async () => {
    setEngineSessions([{ sessionId: 'ses_old', title: 'Old title', updatedAt: new Date().toISOString() }]);
    render(<AiCopilotDock strategy={validStrategy()} />);
    await openHistory();
    await screen.findByText('Old title');

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Old title' }));
    fireEvent.click(screen.getByTestId('session-rename'));
    const input = screen.getByLabelText('Chat title') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Renamed chat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(renameEngineSession).toHaveBeenCalledWith('ses_old', 'Renamed chat'));
    expect(await screen.findByText('Renamed chat')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Renamed chat' }));
    fireEvent.click(screen.getByTestId('export-session'));
    await waitFor(() => expect(exportEngineSession).toHaveBeenCalledWith('ses_old', 'md'));

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Renamed chat' }));
    fireEvent.click(screen.getByTestId('session-delete'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteEngineSession).toHaveBeenCalledWith('ses_old'));
    await waitFor(() => expect(screen.queryByText('Renamed chat')).toBeNull());
  });

  it('debounces the search, queries the server, and never reloads the active chat', async () => {
    setEngineSessions([{ sessionId: 'ses_active', title: 'Current scan', updatedAt: new Date().toISOString() }]);
    vi.mocked(getEngineMessages).mockResolvedValue({
      messages: [{ id: 'm1', role: 'user', text: 'Current question', seq: 1 }],
      lastSeq: 1,
    } as never);
    setStoredEngineSession({ sessionId: 'ses_active', lastSeq: 1 });
    render(<AiCopilotDock strategy={validStrategy()} />);
    await screen.findByText('Current question');
    const restoreCalls = vi.mocked(getEngineMessages).mock.calls.length;
    await openHistory();
    const panel = await screen.findByTestId('history-panel');
    await within(panel).findByText('Current scan');
    vi.mocked(listEngineSessions).mockClear();

    const search = screen.getByTestId('history-search');
    fireEvent.change(search, { target: { value: 'RSI breakout' } });
    expect(listEngineSessions).not.toHaveBeenCalledWith('RSI breakout');
    await waitFor(() => expect(listEngineSessions).toHaveBeenCalledWith('RSI breakout'), { timeout: 1_500 });
    expect(within(panel).getByText('Current scan')).toBeTruthy();
    expect(getEngineMessages).toHaveBeenCalledTimes(restoreCalls);
    expect(screen.getByText('Current question')).toBeTruthy();
  });

  it('shows the empty search state and clears the query', async () => {
    setEngineSessions([{ sessionId: 'ses_old', title: 'Old title', updatedAt: new Date().toISOString() }]);
    render(<AiCopilotDock strategy={validStrategy()} />);
    await openHistory();
    await screen.findByText('Old title');
    vi.mocked(listEngineSessions).mockResolvedValue([] as never);
    fireEvent.change(screen.getByTestId('history-search'), { target: { value: 'nothing' } });
    // The 250 ms debounce plus the server call can be slow under whole-suite load.
    await waitFor(() => expect(listEngineSessions).toHaveBeenCalledWith('nothing'), { timeout: 3_000 });
    expect(await screen.findByText('No conversations match', undefined, { timeout: 3_000 })).toBeTruthy();
    expect(within(screen.getByTestId('history-search').parentElement as HTMLElement).getByRole('button', { name: 'Clear search' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect((screen.getByTestId('history-search') as HTMLInputElement).value).toBe('');
  });
});

describe('deep links', () => {
  it('prefers ?session= over the stored browser session', async () => {
    window.history.replaceState({}, '', '/?session=ses_linked');
    setStoredEngineSession({ sessionId: 'ses_stored', lastSeq: 9 });
    vi.mocked(getEngineMessages).mockResolvedValue({
      messages: [{ id: 'm1', role: 'user', text: 'Linked chat', seq: 1 }],
      lastSeq: 1,
    } as never);
    render(<AiCopilotDock strategy={validStrategy()} />);
    expect(await screen.findByText('Linked chat')).toBeTruthy();
    expect(getEngineMessages).toHaveBeenCalledWith('ses_linked');
    expect(getEngineMessages).not.toHaveBeenCalledWith('ses_stored');
  });
});

describe('model switcher', () => {
  it('lists only server models, marks paid ones, and carries the choice into first create', async () => {
    engineReplyDefault(() => conversation('Model answer.'));
    render(<AiCopilotDock strategy={validStrategy()} />);
    fireEvent.click(screen.getByTestId('model-select'));
    const paid = await screen.findByRole('menuitemradio', { name: /DeepSeek V4.1 Flash \(paid\)/ });
    expect(within(paid).getByText('paid')).toBeTruthy();
    expect(screen.getByText(/each run can cost money/)).toBeTruthy();
    fireEvent.click(paid);
    send('Which model am I using?');
    await screen.findByText('Model answer.');
    expect(createEngineSession).toHaveBeenCalledWith(undefined, { providerID: 'opencode-go', model: 'deepseek-v4.1-flash' });
  });

  it('switches the model on the existing session through the server route', async () => {
    setStoredEngineSession({ sessionId: 'ses_live', lastSeq: 1 });
    render(<AiCopilotDock strategy={validStrategy()} />);
    await waitFor(() => expect(getEngineMessages).toHaveBeenCalledWith('ses_live'));
    fireEvent.click(screen.getByTestId('model-select'));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /DeepSeek V4.1 Flash \(paid\)/ }));
    await waitFor(() => expect(switchEngineModel).toHaveBeenCalledWith('ses_live', { providerID: 'opencode-go', model: 'deepseek-v4.1-flash' }));
    expect(screen.getByText(/Model changed to DeepSeek V4.1 Flash \(paid\)/)).toBeTruthy();
  });
});

describe('usage and data panels', () => {
  it('shows reported session and server usage, and no invented cost when absent', async () => {
    vi.mocked(getEngineUsage).mockResolvedValue(usageWith({
      stats: { sessions: 3, prompts: 12, steps: 40, tokens: { input: 1200, output: 340 }, cost: null, models: [] },
      sessions: [{ sessionId: 'ses_live', title: 'Live', cost: 0.12, tokens: { input: 900, output: 100 } }],
    }) as never);
    setStoredEngineSession({ sessionId: 'ses_live', lastSeq: 1 });
    render(<AiCopilotDock strategy={validStrategy()} />);
    await waitFor(() => expect(getEngineMessages).toHaveBeenCalledWith('ses_live'));
    fireEvent.click(screen.getByRole('button', { name: 'System status' }));
    const panel = await screen.findByTestId('usage-panel');
    expect(within(panel).getByText('1.2k in · 340 out')).toBeTruthy();
    expect(within(panel).getByText('1,540 total')).toBeTruthy();
    expect(within(panel).getAllByText('$0.12').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('Not reported').length).toBeGreaterThan(0);
  });

  it('shows "Usage is not available" with the server warning when stats is null', async () => {
    vi.mocked(getEngineUsage).mockResolvedValue({ stats: null, warnings: ['stats_unavailable'], limits: null, sessions: [] } as never);
    render(<AiCopilotDock strategy={validStrategy()} />);
    fireEvent.click(screen.getByRole('button', { name: 'System status' }));
    const panel = await screen.findByTestId('usage-panel');
    expect(within(panel).getByText('Usage is not available.')).toBeTruthy();
    expect(within(panel).getByText('stats_unavailable')).toBeTruthy();
    expect(within(panel).queryByText('Chats')).toBeNull();
    expect(within(panel).queryByText('0')).toBeNull();
  });

  it('shows the market cache summary and posts the current universe for refresh', async () => {
    render(<AiCopilotDock strategy={validStrategy()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Market data' }));
    const panel = await screen.findByTestId('data-cache-panel');
    expect(within(panel).getByText('2,051')).toBeTruthy();
    expect(within(panel).getByText('1.2 MB')).toBeTruthy();
    expect(within(panel).getByText('2021-11-18 → 2026-11-17')).toBeTruthy();
    expect(within(panel).getByText(/Cached candles are reused/)).toBeTruthy();
    fireEvent.click(within(panel).getByTestId('cache-refresh'));
    await waitFor(() => expect(refreshMarketCache).toHaveBeenCalledWith('NIFTY_50'));
    expect(await screen.findByText(/2,051 symbols updated|2051 symbols updated/)).toBeTruthy();
  });

  it('shows provider status without secrets or raw JSON', async () => {
    render(<AiCopilotDock strategy={validStrategy()} />);
    fireEvent.click(screen.getByRole('button', { name: 'System status' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Providers' }));
    const panel = await screen.findByTestId('provider-status');
    expect(within(panel).getAllByText('Ready').length).toBeGreaterThan(0);
    expect(within(panel).getByText('hy4-flash-free → deepseek-v4.1-flash')).toBeTruthy();
    expect(within(panel).getAllByText('Configured').length).toBeGreaterThan(0);
    expect(within(panel).getByText('Connected')).toBeTruthy();
    expect(within(panel).getByText('whisper-large-v3')).toBeTruthy();
    expect(within(panel).queryByText(/\{/)).toBeNull();
  });
});

describe('jobs list', () => {
  beforeEach(() => {
    vi.mocked(listJobs).mockResolvedValue([
      { id: 'job_scan', kind: 'scan', status: 'running', universe: 'NIFTY_50', createdAt: new Date().toISOString(), progress: { processed: 120, total: 200 }, resumable: false },
      { id: 'job_chart', kind: 'chart', status: 'interrupted', createdAt: new Date().toISOString(), resumable: true },
    ] as never);
  });

  it('shows kind, status and server progress, and cancels or resumes honestly', async () => {
    render(<AiCopilotDock strategy={validStrategy()} />);
    fireEvent.click(screen.getByRole('button', { name: 'System status' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Jobs' }));
    const panel = await screen.findByTestId('jobs-panel');
    expect(await within(panel).findByText('Scan')).toBeTruthy();
    expect(within(panel).getByText('120 of 200')).toBeTruthy();
    expect(within(panel).getByText('Chart')).toBeTruthy();
    fireEvent.click(within(panel).getByTestId('job-cancel'));
    await waitFor(() => expect(cancelJob).toHaveBeenCalledWith('job_scan'));
    expect(await within(panel).findByText(/Cancel requested for Scan/)).toBeTruthy();
    fireEvent.click(within(panel).getByTestId('job-resume'));
    await waitFor(() => expect(resumeJob).toHaveBeenCalledWith('job_chart'));
    expect(await within(panel).findByText(/Resume requested for Chart/)).toBeTruthy();
  });

  it('shows the honest empty state', async () => {
    vi.mocked(listJobs).mockResolvedValue([] as never);
    render(<AiCopilotDock strategy={validStrategy()} />);
    fireEvent.click(screen.getByRole('button', { name: 'System status' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Jobs' }));
    expect(await screen.findByText('No jobs yet.')).toBeTruthy();
  });
});
