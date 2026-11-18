// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AiCopilotDock } from '../../components/chat/AiCopilotDock';
import { validStrategy } from '../../server/ai/testFixtures';
import {
  createEngineSession, getEngineMessages, getJobStatus, interruptEngineSession, isEngineUnavailable, listEngineSessions,
  postEngineApproval, postEngineMessage, readStoredEngineSession, resumeInterruptedJob, subscribeEngineEvents,
} from '../../client/engine';
import { cancelSpeech, createVoiceInput } from '../../client/voice';

vi.mock('../../client/api', () => ({
  requestScan: vi.fn(),
  checkScanJob: vi.fn(),
  checkBacktestJob: vi.fn(),
  cancelResearchJob: vi.fn(),
}));
vi.mock('../../client/featureSetup', () => ({ requestFeatureSetup: vi.fn() }));
vi.mock('../../client/engine', () => ({
  createEngineSession: vi.fn(),
  getEngineMessages: vi.fn(),
  getJobStatus: vi.fn(),
  getEngineUsage: vi.fn(async () => ({ stats: { sessions: 0, prompts: 0, steps: 0, tokens: {}, cost: null, models: [] }, limits: null, sessions: [] })),
  listEngineModels: vi.fn(async () => ({ models: [], default: null })),
  getProviderStatus: vi.fn(async () => ({ ai: { ready: false, models: [] }, market: { configured: false, connected: false }, voice: { configured: false } })),
  getMarketCache: vi.fn(async () => ({ symbols: 0, bars: 0, firstDate: null, lastDate: null, dbBytes: 0, hits: 0, misses: 0, incrementalFetches: 0, lastFetchAt: null, dbPath: '' })),
  listJobs: vi.fn(async () => []),
  interruptEngineSession: vi.fn(),
  isEngineUnavailable: vi.fn((error: { status?: number } | null) => error?.status === 404),
  listEngineSessions: vi.fn(),
  normalizeEngineTodos: vi.fn((input: unknown) => Array.isArray(input) ? input : []),
  normalizeToolActivities: vi.fn((input: unknown) => Array.isArray(input) ? input : input ? [input] : []),
  postEngineApproval: vi.fn(),
  postEngineMessage: vi.fn(),
  deleteEngineSession: vi.fn(),
  renameEngineSession: vi.fn(),
  switchEngineModel: vi.fn(),
  exportEngineSession: vi.fn(),
  refreshMarketCache: vi.fn(),
  cancelJob: vi.fn(),
  resumeJob: vi.fn(),
  readStoredEngineSession: vi.fn(() => null),
  rememberEngineCursor: vi.fn(),
  resumeInterruptedJob: vi.fn(),
  subscribeEngineEvents: vi.fn(),
  writeStoredEngineSession: vi.fn(),
  clearStoredEngineSession: vi.fn(),
}));
vi.mock('../../client/voice', () => ({
  cancelSpeech: vi.fn(),
  createVoiceInput: vi.fn(),
  mediaRecorderSupported: vi.fn(() => false),
  readVoicePreferences: vi.fn(() => ({ voiceMode: false })),
  speak: vi.fn(),
  speechRecognitionSupported: vi.fn(() => true),
  speechSynthesisSupported: vi.fn(() => true),
  writeVoicePreferences: vi.fn(),
}));

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

const zeroScan = {
  mode: 'real', universe: 'NSE', scanned: 50, matched: 0, scannedAt: '2026-11-18T12:17:45Z',
  dataSource: 'PROVENANCE_PER_SYMBOL', matches: [], nearMatches: [], requested: 50, attempted: 50,
  succeeded: 50, unavailable: 0, failed: 0, offset: 0, limit: 50, errors: [],
  sourceCoverage: { ANGEL_SMARTAPI: 50 }, warnings: ['Evaluated the first 50 of 2051 configured symbols.'],
  observationDates: { earliest: '2023-11-15', latest: '2026-11-18', staleSymbols: 0 },
};

const screenPayload = () => ({
  schemaVersion: 1,
  kind: 'screen',
  originatingRevision: 1,
  message: 'I planned a Nifty 50 screen. The scan is running.',
  method: 'external_ai',
  provider: { name: 'opencode-go:hy4-flash-free', model: 'hy4-flash-free', aiGenerated: true },
  warnings: [],
  universe: 'NIFTY_50',
  strategy: validStrategy(),
  assumptions: ['Daily bars, split-adjusted.'],
  missingBacktestRules: ['exits'],
  backtestReady: false,
});

const conversationPayload = (message: string) => ({
  schemaVersion: 1,
  kind: 'conversation',
  originatingRevision: 1,
  message,
  method: 'rule_parser',
  provider: { name: 'none', model: null, aiGenerated: false },
  warnings: [],
});

let dom: JSDOM;
let onEvent: ((event: unknown) => void) | null = null;

beforeEach(() => {
  dom = new JSDOM('', { url: 'https://chat-engine.test' });
  vi.stubGlobal('localStorage', dom.window.localStorage);
  window.history.replaceState({}, '', '/');
  onEvent = null;
  vi.mocked(readStoredEngineSession).mockReturnValue(null);
  vi.mocked(isEngineUnavailable).mockImplementation((error: unknown) => (error as { status?: number } | null)?.status === 404);
  vi.mocked(subscribeEngineEvents).mockImplementation((_sessionId, afterSeq, options) => {
    onEvent = options.onEvent as (event: unknown) => void;
    return { close: vi.fn(), cursor: () => afterSeq, transport: () => 'sse' };
  });
  vi.mocked(createEngineSession).mockResolvedValue('ses_new');
  vi.mocked(postEngineMessage).mockResolvedValue(undefined);
  vi.mocked(interruptEngineSession).mockResolvedValue(undefined);
  vi.mocked(listEngineSessions).mockResolvedValue([]);
  vi.mocked(getJobStatus).mockResolvedValue({ id: 'job-1', status: 'interrupted' });
  vi.mocked(resumeInterruptedJob).mockResolvedValue(undefined);
  vi.mocked(postEngineApproval).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  dom.window.close();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const restoredPage = (messages: unknown[]) => ({ messages, lastSeq: 12 });

const renderRestored = async (messages: unknown[]) => {
  vi.mocked(readStoredEngineSession).mockReturnValue({ sessionId: 'ses_restore', lastSeq: 7 });
  vi.mocked(getEngineMessages).mockResolvedValue(restoredPage(messages) as never);
  render(<AiCopilotDock strategy={validStrategy()} symbols={[symbol]} />);
  await waitFor(() => expect(getEngineMessages).toHaveBeenCalledWith('ses_restore'));
};

const send = (text: string) => {
  fireEvent.change(screen.getByLabelText('Research request'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
};

describe('engine session restore', () => {
  it('renders the durable messages and resubscribes from the stored cursor', async () => {
    await renderRestored([
      { id: 'm1', role: 'user', text: 'Screen Nifty 50 for oversold RSI', seq: 1 },
      { id: 'm2', role: 'assistant', text: 'I planned a Nifty 50 screen.', payload: screenPayload(), seq: 2 },
      { id: 'm3', role: 'tool', tool: 'scan_market', result: scanResult, seq: 3 },
      { id: 'm4', role: 'assistant', text: 'One match: Reliance.', seq: 4 },
    ]);
    expect(await screen.findByText('One match: Reliance.')).toBeTruthy();
    expect(screen.getByText('Screen Nifty 50 for oversold RSI')).toBeTruthy();
    const card = screen.getByRole('article', { name: 'Research screen' });
    expect(within(card).getByText('RELIANCE')).toBeTruthy();
    expect(subscribeEngineEvents).toHaveBeenCalledWith('ses_restore', 12, expect.any(Object));
    expect(localStorage.getItem('stragy.engine.session')).toBeNull();
  });

  it('restores the scan card when the tool result precedes the screen payload', async () => {
    await renderRestored([
      { id: 'm1', role: 'user', text: 'Screen Nifty 50 for oversold RSI', seq: 1 },
      { id: 'm2', role: 'tool', tool: 'get_scan_result', result: scanResult, seq: 2 },
      { id: 'm3', role: 'assistant', text: 'One match: Reliance.', payload: screenPayload(), seq: 3 },
    ]);
    expect(await screen.findByText('One match: Reliance.')).toBeTruthy();
    const card = screen.getByRole('article', { name: 'Research screen' });
    expect(within(card).getByText('RELIANCE')).toBeTruthy();
    expect(within(card).getByText('1 match')).toBeTruthy();
  });

  it('never duplicates a replayed message id', async () => {
    await renderRestored([]);
    act(() => {
      onEvent?.({ seq: 1, type: 'message', message: { id: 'same', role: 'assistant', text: 'Only once.' } });
      onEvent?.({ seq: 2, type: 'message', message: { id: 'same', role: 'assistant', text: 'Only once.' } });
    });
    expect(await screen.findAllByText('Only once.')).toHaveLength(1);
  });

  it('offers Resume for a scan interrupted by the restart and calls the durable resume', async () => {
    await renderRestored([
      { id: 'm1', role: 'user', text: 'Scan Nifty 50', seq: 1 },
      { id: 'm2', role: 'tool', tool: 'scan_market', job: { id: 'job-1', kind: 'scan', status: 'interrupted' }, seq: 2 },
    ]);
    expect(await screen.findByText(/The server restarted mid-scan/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(getJobStatus).toHaveBeenCalledWith('job-1'));
    await waitFor(() => expect(resumeInterruptedJob).toHaveBeenCalledWith('job-1'));
  });

  it('sends approval to the engine approval route, then the confirm message', async () => {
    await renderRestored([
      { id: 'm1', role: 'user', text: 'Backtest the screen on Reliance', seq: 1 },
      { id: 'm2', role: 'tool', tool: 'run_backtest', approval: { id: 'appr_1', status: 'pending', title: 'Run the reviewed backtest?', summary: ['Stop loss 3%', 'Target 6%'] }, seq: 2 },
    ]);
    expect(await screen.findByText('Run the reviewed backtest?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use these assumptions and run' }));
    await waitFor(() => expect(postEngineApproval).toHaveBeenCalledWith({ sessionId: 'ses_restore', approvalId: 'appr_1', decision: 'approve' }));
    await waitFor(() => expect(postEngineMessage).toHaveBeenCalledWith('ses_restore', { text: 'Use these assumptions and run' }));
  });

  it('lists saved engine sessions from the header history and can switch to one', async () => {
    await renderRestored([{ id: 'm1', role: 'user', text: 'One match' }]);
    vi.mocked(listEngineSessions).mockResolvedValue([{ sessionId: 'ses_old', title: 'Earlier RSI scan', messageCount: 4 }]);
    fireEvent.click(screen.getByTestId('chat-history-toggle'));
    expect(await screen.findByText('Earlier RSI scan')).toBeTruthy();
    fireEvent.click(screen.getByText('Earlier RSI scan'));
    await waitFor(() => expect(getEngineMessages).toHaveBeenCalledWith('ses_old'));
  });

  it('restores a scan result that arrived before the screen payload', async () => {
    await renderRestored([
      { id: 'u1', role: 'user', text: 'Scan Nifty 50', seq: 1 },
      { id: 't1', role: 'tool', tool: 'scan_market', result: scanResult, seq: 2 },
      { id: 'a1', role: 'assistant', text: 'One match.', payload: screenPayload(), seq: 3 },
    ]);
    await screen.findByText('One match.');
    const results = screen.getByLabelText('Screen results');
    expect(within(results).getByText('RELIANCE')).toBeTruthy();
    expect(within(results).getByText(/1 match/)).toBeTruthy();
  });

  it('shows a read-only scan card when the transcript has a result but no screen plan (real session shape)', async () => {
    await renderRestored([
      { id: 'u1', role: 'user', text: 'Scan NSE for RSI oversold stocks', seq: 1 },
      { id: 't1', role: 'tool', tool: 'scan_market', result: zeroScan, seq: 2 },
      { id: 'a1', role: 'assistant', text: 'The scan finished. No RSI-oversold stocks matched.', seq: 3 },
    ]);
    await screen.findByText(/The scan finished/);
    const card = screen.getByTestId('engine-scan-result');
    expect(within(card).getByText('0 matches')).toBeTruthy();
    expect(within(card).getByText('50 of 50 checked')).toBeTruthy();
    expect(within(card).getByText(/No stock met the scanned conditions/)).toBeTruthy();
  });

  it('shows the scan card live when only the tool result arrives', async () => {
    await renderRestored([]);
    act(() => onEvent?.({ seq: 1, type: 'message', message: { id: 't1', role: 'tool', tool: 'get_scan_result', result: zeroScan } }));
    const card = await screen.findByTestId('engine-scan-result');
    expect(within(card).getByText('0 matches')).toBeTruthy();
  });

  it('keeps a live scan result when the screen payload arrives after the tool message', async () => {
    await renderRestored([]);
    act(() => onEvent?.({ seq: 1, type: 'message', message: { id: 't1', role: 'tool', tool: 'get_scan_result', result: scanResult } }));
    act(() => onEvent?.({
      seq: 2,
      type: 'message',
      message: { id: 'a1', role: 'assistant', text: 'Scan finished.', payload: screenPayload() },
    }));
    const results = await screen.findByLabelText('Screen results');
    expect(within(results).getByText('RELIANCE')).toBeTruthy();
    expect(within(results).getByText(/1 match/)).toBeTruthy();
    expect(screen.queryByText('Results are pending, not zero matches.')).toBeNull();
  });

  it('sends an attached chart image through the engine message, not the legacy route', async () => {
    await renderRestored([{ id: 'm1', role: 'user', text: 'Earlier turn', seq: 1 }]);
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'chart.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Chart image file'), { target: { files: [file] } });
    expect(await screen.findByText('chart.png')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'Read this chart' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(postEngineMessage).toHaveBeenCalled());
    const [sessionId, input] = vi.mocked(postEngineMessage).mock.calls.at(-1)!;
    expect(sessionId).toBe('ses_restore');
    expect(input.text).toBe('Read this chart');
    expect(input.image?.name).toBe('chart.png');
    expect(input.image?.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });
});

describe('engine activity timeline', () => {
  it('streams tool activity + plan into the turn, and Stop interrupts the session', async () => {
    await renderRestored([]);
    act(() => onEvent?.({ seq: 1, type: 'status', status: 'working' }));
    act(() => onEvent?.({
      seq: 2,
      type: 'tool',
      activity: { type: 'tool', name: 'scan_market', status: 'running', summary: 'Scanning NIFTY 50 · 20 of 50', durationMs: 420 },
    }));
    act(() => onEvent?.({
      seq: 3,
      type: 'todo',
      todos: [
        { content: 'Check the RSI rule on RELIANCE', status: 'completed' },
        { content: 'Scan NIFTY 50', status: 'in_progress' },
        { content: 'Review the matches', status: 'pending' },
      ],
    }));
    const activity = await screen.findByTestId('agent-activity');
    // The strip owns the running step; the timeline row is not repeated.
    expect(within(activity).getByText(/Scanning NIFTY 50 · 20 of 50/)).toBeTruthy();
    expect(screen.getByTestId('agent-todo-list')).toBeTruthy();
    expect(screen.getByText('Scan NIFTY 50')).toBeTruthy();
    // The timeline is the loading state: no skeleton while tools report.
    expect(screen.queryByTestId('assistant-pending')).toBeNull();
    // One stop control for an engine turn: the activity strip, not the composer.
    expect(screen.queryByRole('button', { name: 'Cancel research' })).toBeNull();
    expect(screen.getAllByText(/Conversation saved on the server/).length).toBeGreaterThan(0);
    fireEvent.click(within(activity).getByRole('button', { name: 'Stop the current step' }));
    expect(interruptEngineSession).toHaveBeenCalledWith('ses_restore');

    act(() => onEvent?.({ seq: 4, type: 'message', message: { id: 'm9', role: 'assistant', text: 'The scan is running; I will report the matches.' } }));
    await screen.findByText('The scan is running; I will report the matches.');
    const header = within(screen.getByTestId('agent-activity')).getByRole('button', { name: /1 step/ });
    expect(header.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(header);
    expect(within(screen.getByTestId('agent-activity')).getAllByText(/Scanning NIFTY 50 · 20 of 50/).length).toBeGreaterThan(0);
  });

  it('renders activity and the plan restored from a durable assistant message', async () => {
    await renderRestored([
      { id: 'r1', role: 'user', text: 'Check TCS then scan', seq: 1 },
      {
        id: 'r2',
        role: 'assistant',
        text: 'I checked TCS first, then ran the scan.',
        seq: 2,
        activity: [
          { type: 'tool', name: 'check_symbol', status: 'success', summary: 'Checked TCS against 3 conditions', durationMs: 180 },
          { type: 'tool', name: 'scan_market', status: 'success', summary: 'Scanned NIFTY 50 · 50 of 50', durationMs: 4100 },
        ],
        todos: [
          { content: 'Check TCS conditions', status: 'completed' },
          { content: 'Scan NIFTY 50', status: 'completed' },
        ],
      },
    ]);
    await screen.findByText('I checked TCS first, then ran the scan.');
    const activity = screen.getByTestId('agent-activity');
    fireEvent.click(within(activity).getByRole('button', { name: /2 steps/ }));
    expect(within(activity).getByText('Checked TCS against 3 conditions')).toBeTruthy();
    expect(within(activity).getByText('Scanned NIFTY 50 · 50 of 50')).toBeTruthy();
    expect(screen.getByText('Check TCS conditions')).toBeTruthy();
    expect(screen.getByTestId('agent-todo-list')).toBeTruthy();
  });
});

describe('typed engine failures', () => {
  it('shows a retryable engine error card with the code and never calls another chat route', async () => {
    vi.mocked(createEngineSession).mockRejectedValueOnce(Object.assign(new Error('The engine is unavailable right now.'), { code: 'ENGINE_UNAVAILABLE', status: 503 }));
    render(<AiCopilotDock strategy={validStrategy()} />);
    send('What is RSI?');
    const card = await screen.findByTestId('engine-error-card');
    expect(card.textContent).toContain('ENGINE_UNAVAILABLE');
    expect(card.textContent).toContain('503');
    expect(within(card).getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(postEngineMessage).not.toHaveBeenCalled();
    expect(screen.getByText('What is RSI?')).toBeTruthy();
  });

  it('retries the same turn without duplicating the user message or the error card', async () => {
    vi.mocked(createEngineSession)
      .mockRejectedValueOnce(Object.assign(new Error('Engine unreachable.'), { code: 'ENGINE_UNREACHABLE', status: 0 }))
      .mockResolvedValue('ses_retry');
    vi.mocked(postEngineMessage).mockResolvedValue(undefined);
    render(<AiCopilotDock strategy={validStrategy()} />);
    send('Scan Nifty 50');
    const card = await screen.findByTestId('engine-error-card');
    fireEvent.click(within(card).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(postEngineMessage).toHaveBeenCalledWith('ses_retry', expect.objectContaining({ text: 'Scan Nifty 50' })));
    await waitFor(() => expect(screen.queryByTestId('engine-error-card')).toBeNull());
    expect(screen.getAllByText('Scan Nifty 50')).toHaveLength(1);
  });
});

describe('long engine turns', () => {
  it('keeps the turn and cursor at 90 s, then stops the spinner honestly at 20 minutes', async () => {
    await renderRestored([{ id: 'm1', role: 'user', text: 'Scan the NSE for RSI oversold', seq: 1 }]);
    vi.useFakeTimers();
    try {
      act(() => onEvent?.({ seq: 2, type: 'status', status: 'working' }));
      await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
      const note = screen.getByTestId('long-turn-note');
      expect(note.textContent).toContain('Still working on the server');
      expect(note.textContent).toContain('reconnecting');
      expect(within(note).getByRole('button', { name: 'Stop' })).toBeTruthy();
      expect(screen.getByRole('log').getAttribute('aria-busy')).toBe('true');
      expect(createEngineSession).not.toHaveBeenCalled();

      await act(async () => { await vi.advanceTimersByTimeAsync(20 * 60_000); });
      const expired = screen.getByTestId('long-turn-note');
      expect(expired.textContent).toContain('Still running on the server');
      expect(expired.textContent).toContain('reload to resync');
      expect(within(expired).getByRole('button', { name: 'Reload' })).toBeTruthy();
      expect(screen.getByRole('log').getAttribute('aria-busy')).toBeNull();
      expect(screen.getByText('Scan the NSE for RSI oversold')).toBeTruthy();
      expect(screen.queryByTestId('engine-error-card')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('collapses ten get_scan_result polls into one row with an attempt count', async () => {
    await renderRestored([{ id: 'm1', role: 'user', text: 'Scan NSE', seq: 1 }]);
    act(() => onEvent?.({ seq: 2, type: 'status', status: 'working' }));
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      act(() => onEvent?.({
        seq: 2 + attempt,
        type: 'tool',
        activity: { type: 'tool', name: 'get_scan_result', status: attempt === 10 ? 'success' : 'running', summary: 'Scanning NIFTY_50 · ' + (attempt * 20) + ' of 200' },
      }));
    }
    const activity = screen.getByTestId('agent-activity');
    const rows = within(activity).getByRole('list', { name: 'Tool calls' });
    expect(within(rows).getAllByRole('listitem')).toHaveLength(1);
    expect(within(rows).getByText('attempt 10')).toBeTruthy();
  });

  it('disables send with an explicit Stop first while an engine turn is running', async () => {
    await renderRestored([{ id: 'm1', role: 'user', text: 'Earlier turn', seq: 1 }]);
    act(() => onEvent?.({ seq: 2, type: 'status', status: 'working' }));
    expect(screen.getByText(/The engine is still working/)).toBeTruthy();
    const stopFirst = screen.getByRole('button', { name: /Stop first/ }) as HTMLButtonElement;
    expect(stopFirst.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Send request' })).toBeNull();
  });
});

describe('voice composer', () => {
  it('renders mic and speaker controls and never auto-sends a transcript', async () => {
    let callbacks: { onTranscript: (text: string, final: boolean) => void; onState?: (state: string) => void } | null = null;
    const start = vi.fn(async () => { callbacks?.onState?.('listening'); return true; });
    vi.mocked(createVoiceInput).mockImplementation(options => {
      callbacks = options as unknown as typeof callbacks;
      return { start, stop: vi.fn(), toggle: vi.fn(), dispose: vi.fn(), listening: () => false, transport: () => 'browser' };
    });
    render(<AiCopilotDock strategy={validStrategy()} />);
    const mic = screen.getByRole('button', { name: 'Start voice input' });
    expect(mic.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Turn voice replies on' })).toBeTruthy();
    fireEvent.click(mic);
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: 'Stop voice input' })).toBeTruthy();
    expect(screen.getByText(/Listening…/)).toBeTruthy();
    act(() => callbacks?.onTranscript('set my trailing stop to 2%', true));
    const textarea = screen.getByLabelText('Research request') as HTMLTextAreaElement;
    expect(textarea.value).toBe('set my trailing stop to 2%');
    // The user reviews and sends the transcript explicitly; sending stops speech.
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(postEngineMessage).toHaveBeenCalledWith('ses_new', expect.objectContaining({ text: 'set my trailing stop to 2%' })));
    // debug
    expect(cancelSpeech).toHaveBeenCalled();
  });
});
