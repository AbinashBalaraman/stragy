// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AiCopilotDock } from '../../components/chat/AiCopilotDock';
import { validStrategy } from '../../server/ai/testFixtures';
import { requestResearchChat } from '../../client/researchChat';
import { ChartReadingCard } from '../../components/chat/ChartReadingCard';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import type { ResearchScreenPlan } from '../../shared/contracts/research-chat';
import type { BacktestResponse } from '../../shared/strategy/types';

vi.mock('../../client/researchChat', () => ({ requestResearchChat: vi.fn() }));
vi.mock('../../client/api', () => ({ requestScan: vi.fn() }));
vi.mock('../../client/featureSetup', () => ({ requestFeatureSetup: vi.fn() }));

let dom: JSDOM;

beforeEach(() => {
  dom = new JSDOM('', { url: 'https://chat-anatomy.test' });
  vi.stubGlobal('localStorage', dom.window.localStorage);
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

describe('chat message anatomy', () => {
  it('keeps aria-live off the log and announces through one hidden status region', async () => {
    vi.mocked(requestResearchChat).mockReturnValue(new Promise(() => {}) as never);
    render(<AiCopilotDock strategy={validStrategy()} />);
    const log = screen.getByRole('log', { name: 'Conversation' });
    expect(log.getAttribute('aria-live')).toBeNull();
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(document.querySelector('[aria-live="polite"]')?.className).toContain('sr-only');
    send('Explain RSI');
    await waitFor(() => expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('Stragy is working on your request.'));
    expect(log.getAttribute('aria-busy')).toBe('true');
  });

  it('shows one in-flow placeholder instead of a composer status line', async () => {
    vi.mocked(requestResearchChat).mockReturnValue(new Promise(() => {}) as never);
    render(<AiCopilotDock strategy={validStrategy()} />);
    send('Explain RSI');
    // A reply that lands almost immediately never flashes a skeleton.
    expect(screen.queryByTestId('assistant-pending')).toBeNull();
    expect(await screen.findByTestId('assistant-pending')).toBeTruthy();
    expect(screen.queryByText(/Preparing a response/)).toBeNull();
    expect(screen.queryByText(/Scanning actual current daily data/)).toBeNull();
  });

  it('keeps focus in the composer after sending', async () => {
    vi.mocked(requestResearchChat).mockReturnValue(new Promise(() => {}) as never);
    render(<AiCopilotDock strategy={validStrategy()} />);
    send('Explain RSI');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Research request')));
  });

  it('labels only the first assistant turn of a run', () => {
    dom.window.localStorage.setItem('stragy_copilot_review_history_v2', JSON.stringify([
      { id: 'u1', sender: 'user', text: 'First question', timestamp: 1 },
      { id: 'a1', sender: 'assistant', text: 'First answer', timestamp: 2 },
      { id: 'a2', sender: 'assistant', text: 'Second answer in the same run', timestamp: 3 },
      { id: 'u2', sender: 'user', text: 'Second question', timestamp: 4 },
      { id: 'a3', sender: 'assistant', text: 'Third answer', timestamp: 5 },
    ]));
    render(<AiCopilotDock strategy={validStrategy()} />);
    expect(screen.getAllByText('Stragy')).toHaveLength(2);
  });

  it('renders links, headings and fenced code without parsing HTML', () => {
    dom.window.localStorage.setItem('stragy_copilot_review_history_v2', JSON.stringify([
      { id: 'a1', sender: 'assistant', text: '### RSI below 30\n\nRead [the guide](https://example.com/rsi) or https://example.com/docs.\n\n```ts\nconst rsi = 28;\n```\n\n<script>alert(1)</script>', timestamp: 1 },
    ]));
    render(<AiCopilotDock strategy={validStrategy()} />);
    expect(screen.getByRole('heading', { level: 3, name: 'RSI below 30' })).toBeTruthy();
    // The link appears inline and once more as a citation chip.
    const guide = screen.getAllByRole('link', { name: 'the guide' });
    expect(guide[0].getAttribute('href')).toBe('https://example.com/rsi');
    expect(screen.getByRole('link', { name: 'https://example.com/docs' })).toBeTruthy();
    const sources = screen.getByLabelText('Sources');
    expect(within(sources).getByRole('link', { name: 'the guide' })).toBeTruthy();
    expect(within(sources).getByRole('link', { name: 'example.com' })).toBeTruthy();
    expect(screen.getByText('const rsi = 28;')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
    expect(document.body.textContent).toContain('<script>alert(1)</script>');
  });

  it('shows an unavailable reply once, in the conversation, never above the composer', async () => {
    vi.mocked(requestResearchChat).mockResolvedValue({
      schemaVersion: 1,
      kind: 'conversation',
      originatingRevision: 1,
      message: 'The model screen failed full strategy validation.',
      method: 'unavailable',
      provider: { name: 'none', model: null, aiGenerated: false },
      warnings: [],
    } as never);
    render(<AiCopilotDock strategy={validStrategy()} />);
    send('Screen Nifty 50 for a setup');
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1));
    const alert = screen.getByRole('alert');
    expect(within(screen.getByRole('log')).getByRole('alert')).toBe(alert);
    expect(alert.textContent).toContain('The model screen failed full strategy validation.');
  });

  it('copies and retries an answer from its action row', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    vi.mocked(requestResearchChat).mockResolvedValue({
      schemaVersion: 1,
      kind: 'conversation',
      originatingRevision: 1,
      message: 'A plain answer.',
      method: 'local_heuristic',
      provider: { name: 'none', model: null, aiGenerated: false },
      warnings: [],
    } as never);
    render(<AiCopilotDock strategy={validStrategy()} />);
    send('First question');
    await screen.findByText('A plain answer.');

    fireEvent.click(screen.getByRole('button', { name: 'Copy answer' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('A plain answer.'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();

    vi.mocked(requestResearchChat).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(requestResearchChat).toHaveBeenCalledTimes(1));
    expect(vi.mocked(requestResearchChat).mock.calls[0][0]).toMatchObject({ message: 'First question' });
  });

  it('brings a user-triggered result into view even when the reader scrolled away', async () => {
    const runs = {
      backtestId: 'run-1',
      strategy: { name: 'Fixture SMA cross' },
      symbol: { id: 7, ticker: 'RELIANCE', name: 'Reliance Industries' },
      metrics: { initialCapital: 100000, finalEquity: 101000, netPnl: 1000, totalReturnPercent: 1, cagr: null, sharpeRatio: null, maxDrawdownPercent: 1, totalTrades: 1, unavailableReasons: {} },
      equityCurve: [],
      trades: [],
      bars: [{ date: '2025-01-01' }, { date: '2025-02-01' }],
      provenance: { mode: 'real', source: 'ANGEL_SMARTAPI', asOf: '2025-02-01', actualRange: { start: '2025-01-01', end: '2025-02-01' } },
      warnings: [],
    } as unknown as BacktestResponse;

    render(
      <AiCopilotDock
        strategy={validStrategy()}
        symbols={[{ id: 7, ticker: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE', sector: 'Energy', currentPrice: 2900, changePercent: 0.5 }]}
        // The run must return the exact reviewed strategy, as the engine does.
        onResearchBacktest={async candidate => ({ ...runs, strategy: candidate })}
      />
    );
    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'Backtest RELIANCE with my current strategy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('article', { name: 'Backtest review' });

    // A tall conversation the reader has scrolled away from.
    const log = screen.getByRole('log');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 400 });
    let top = 0;
    const setTop = vi.fn((value: number) => { top = value; });
    Object.defineProperty(log, 'scrollTop', { configurable: true, get: () => top, set: setTop });
    fireEvent.scroll(log);
    expect(await screen.findByTestId('jump-to-latest')).toBeTruthy();
    setTop.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Use these assumptions and run' }));
    await screen.findByRole('article', { name: 'Backtest result' });
    await waitFor(() => expect(setTop).toHaveBeenCalled());
  });

  it('follows the answer to a follow-up even when the log is short of the bottom', async () => {
    const reply = (text: string) => ({
      schemaVersion: 1,
      kind: 'conversation',
      originatingRevision: 1,
      message: text,
      method: 'local_heuristic',
      provider: { name: 'none', model: null, aiGenerated: false },
      warnings: [],
    } as never);

    vi.mocked(requestResearchChat).mockResolvedValueOnce(reply('First answer.'));
    render(<AiCopilotDock strategy={validStrategy()} />);
    send('First question');
    await screen.findByText('First answer.');

    // A tall conversation, scrolled away from the bottom (the Esc-from-sheet case).
    const log = screen.getByRole('log');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 400 });
    let top = 0;
    const setTop = vi.fn((value: number) => { top = value; });
    Object.defineProperty(log, 'scrollTop', { configurable: true, get: () => top, set: setTop });
    fireEvent.scroll(log);
    expect(await screen.findByTestId('jump-to-latest')).toBeTruthy();

    let finish!: (value: unknown) => void;
    vi.mocked(requestResearchChat).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }) as never);
    setTop.mockClear();
    send('Why did it lose money? One short paragraph.');
    // The browser reports the new position: still far from the bottom.
    fireEvent.scroll(log);
    await act(async () => { finish(reply('Because the exit came before the bounce.')); });
    await screen.findByText('Because the exit came before the bounce.');
    await waitFor(() => expect(setTop).toHaveBeenCalled());
  });

  it('stops following when the reader scrolls by hand after sending', async () => {
    const reply = (text: string) => ({
      schemaVersion: 1, kind: 'conversation', originatingRevision: 1, message: text,
      method: 'local_heuristic', provider: { name: 'none', model: null, aiGenerated: false }, warnings: [],
    } as never);
    vi.mocked(requestResearchChat).mockResolvedValueOnce(reply('First answer.'));
    render(<AiCopilotDock strategy={validStrategy()} />);
    send('First question');
    await screen.findByText('First answer.');

    const log = screen.getByRole('log');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 400 });
    let top = 1200;
    Object.defineProperty(log, 'scrollTop', { configurable: true, get: () => top, set: value => { top = value; } });

    let finish!: (value: unknown) => void;
    vi.mocked(requestResearchChat).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }) as never);
    send('Second question');
    fireEvent.wheel(log);            // the reader takes over
    fireEvent.scroll(log);
    const before = top;
    await act(async () => { finish(reply('Second answer.')); });
    await screen.findByText('Second answer.');
    expect(top).toBe(before);
  });

  it('labels a live-quote sector answer as Angel One live quotes, not the rule parser', async () => {
    dom.window.localStorage.setItem('stragy_copilot_review_history_v2', JSON.stringify([
      { id: 'a1', sender: 'assistant', text: 'Banks led the session.', timestamp: 1, methodLabel: 'Angel One live quotes · not AI' },
    ]));
    render(<AiCopilotDock strategy={validStrategy()} />);
    expect(screen.getByText('Angel One live quotes · not AI')).toBeTruthy();
  });

  it('clamps a long chart summary to two lines and expands it on request', () => {
    const template = STRATEGY_TEMPLATES.find(item => item.id === 'rsi_trendline_breakout_near_lows');
    if (!template) throw new Error('Chart template missing');
    const plan = {
      schemaVersion: 1,
      kind: 'screen',
      originatingRevision: 1,
      message: 'Chart read.',
      method: 'external_ai',
      provider: { name: 'vision', model: 'vision', aiGenerated: true },
      warnings: [],
      universe: 'NIFTY_50',
      strategy: template.strategy,
      assumptions: [],
      missingBacktestRules: ['exits'],
      backtestReady: false,
    } as unknown as ResearchScreenPlan;
    const summary = 'Oversold RSI recovery with a break above a falling RSI resistance line, RSI back above its signal average, and price still close to the low after a sustained decline. '.repeat(2);
    render(<ChartReadingCard plan={plan} reading={{ source: 'chart_image', observations: {}, confidence: 0.8, summary } as never} />);
    const paragraph = screen.getByText(new RegExp('^Oversold RSI recovery'));
    expect(paragraph.className).toContain('line-clamp-2');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(paragraph.className).not.toContain('line-clamp-2');
    expect(screen.getByRole('button', { name: 'Less' })).toBeTruthy();
  });
});
