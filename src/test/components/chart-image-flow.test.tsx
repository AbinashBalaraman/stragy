// @vitest-environment jsdom
import React from 'react';
import { JSDOM } from 'jsdom';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AiCopilotDock } from '../../components/chat/AiCopilotDock';
import { requestScan, type ScanResult } from '../../client/api';
import { requestResearchChat } from '../../client/researchChat';
import { clearChartReadingCache } from '../../client/chartReadingCache';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';
import type { StrategyAST } from '../../shared/strategy/types';

vi.mock('../../client/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../client/api')>();
  return { ...actual, requestScan: vi.fn() };
});
vi.mock('../../client/researchChat', () => ({ requestResearchChat: vi.fn() }));

// The preview comes from a FileReader and the reading from a mocked fetch; on
// a loaded box both can take longer than the 1 s query default to settle.
configure({ asyncUtilTimeout: 5000 });
// Cold chart reads and the job polling path can exceed the 15 s default under load.
vi.setConfig({ testTimeout: 30_000 });

let dom: JSDOM;
let fetchMock: ReturnType<typeof vi.fn>;
let chartResponse: Record<string, unknown>;

const chartTemplate = () => {
  const template = STRATEGY_TEMPLATES.find(item => item.id === 'rsi_trendline_breakout_near_lows');
  if (!template) throw new Error('Chart template missing');
  return template.strategy;
};
const chartScreen = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  kind: 'screen',
  originatingRevision: null,
  message: 'Chart read. I found testable conditions. Nothing has been run.',
  method: 'external_ai',
  provider: { name: 'test-vision', model: 'vision', aiGenerated: true },
  warnings: [],
  universe: 'NIFTY_50',
  strategy: chartTemplate(),
  assumptions: ['The image only proposes testable conditions.'],
  missingBacktestRules: ['exits', 'positionSizing', 'executionAndCosts'],
  backtestReady: false,
  source: 'chart_image',
  observations: {
    timeframe: '1D',
    indicators: [{ name: 'RSI', params: [14], legendValues: [42.5] }],
    drawnLines: [{ panel: 'rsi', direction: 'down', description: 'Falling resistance line' }],
    priceTrend: 'downtrend',
    nearRange: 'low',
    lastCandle: 'bullish',
    events: ['RSI crossed above the falling trendline'],
  },
  confidence: 0.42,
  summary: 'Price sits near a 250-bar low while RSI holds below a falling trendline.',
  ...overrides,
});
const unavailable = () => ({
  schemaVersion: 1,
  kind: 'conversation',
  originatingRevision: 1,
  message: 'The chart image could not be analysed. Nothing was run.',
  method: 'unavailable',
  provider: { name: 'none', model: null, aiGenerated: false },
  warnings: [],
});
const reliant = { id: 7, ticker: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE' as const, sector: 'Energy', currentPrice: 2900, changePercent: 0.5 };
const scanBase = (overrides: Partial<ScanResult> = {}): ScanResult => ({
  mode: 'real', universe: 'NIFTY_50', scanned: 50, matched: 0, scannedAt: '2026-10-15T12:00:00Z',
  dataSource: 'PROVENANCE_PER_SYMBOL', matches: [], requested: 50, attempted: 50, succeeded: 50,
  unavailable: 0, failed: 0, offset: 0, limit: 100, errors: [], sourceCoverage: { YAHOO_PUBLIC_CHART: 50 }, warnings: [],
  ...overrides,
});
const match = (symbolId = 7) => ({
  symbolId,
  ticker: 'RELIANCE',
  name: 'Reliance Industries',
  sector: 'Energy',
  lastDate: '2026-10-15',
  lastClose: 2900,
  changePercent: 0.5,
  score: 0.8,
  matchedRules: [],
  indicatorValues: {},
  provenance: {
    mode: 'real' as const, source: 'YAHOO_PUBLIC_CHART', symbolId, asOf: '2026-10-15',
    fetchedAt: '2026-10-15T12:00:00Z', requestedRange: {}, actualRange: { start: '2024-10-15', end: '2026-10-15' },
    adjustment: 'split', checksum: 'fixture', coverage: 'full', freshness: 'FRESH', warnings: [], calendarVersion: 'v1',
  },
});
const pngFile = (name = 'chart.png') => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' });
const composer = () => screen.getByTestId('research-composer');
const fileInput = () => screen.getByLabelText('Chart image file') as HTMLInputElement;
const attachFile = (file: File) => fireEvent.change(fileInput(), { target: { files: [file] } });
const historyValue = () => Array.from({ length: localStorage.length }, (_, index) => {
  const key = localStorage.key(index)!;
  return key + '=' + (localStorage.getItem(key) ?? '');
}).join('\n');

beforeEach(() => {
  dom = new JSDOM('', { url: 'https://chart.test/' });
  vi.stubGlobal('localStorage', dom.window.localStorage);
  vi.stubGlobal('crypto', webcrypto);
  clearChartReadingCache();
  chartResponse = chartScreen();
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => chartResponse }));
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(requestScan).mockResolvedValue(scanBase());
});

afterEach(() => {
  cleanup();
  dom.window.close();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('chart image research flow', () => {
  it('attaches from the button, renders the reading, scans, and never persists the image', async () => {
    const applied: StrategyAST[] = [];
    const apply = vi.fn(async (candidate: StrategyAST) => { applied.push(candidate); return true; });
    const run = vi.fn();
    render(<AiCopilotDock strategy={chartTemplate()} symbols={[reliant]} onApplyVariation={apply} onResearchBacktest={run} />);

    const click = vi.spyOn(fileInput(), 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Attach chart image' }));
    expect(click).toHaveBeenCalledTimes(1);
    attachFile(pngFile());

    expect(await screen.findByAltText('Attached chart preview')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'Focus on the RSI breakout' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    const card = await screen.findByRole('article', { name: 'Chart reading' });
    expect(within(card).getByText(/Price sits near a 250-bar low/)).toBeTruthy();
    expect(within(card).getByText('Low confidence — check these conditions')).toBeTruthy();
    expect(within(card).getByText('What the AI saw')).toBeTruthy();
    expect(within(card).getAllByText(/falling trendline/i).length).toBeGreaterThan(0);
    expect(await screen.findByText('[chart image attached]')).toBeTruthy();
    // A chart reading is only a proposal: nothing scans until the user confirms.
    expect(requestScan).not.toHaveBeenCalled();
    expect(within(card).getByRole('button', { name: 'Scan with these' })).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Scan with these' }));
    await waitFor(() => expect(requestScan).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Screen results')).toBeTruthy();
    expect(run).not.toHaveBeenCalled();

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.hint).toBe('Focus on the RSI breakout');
    expect(body.image.startsWith('data:image/png;base64,')).toBe(true);
    expect(requestResearchChat).not.toHaveBeenCalled();
    await waitFor(() => expect(historyValue()).toContain('[chart image attached]'));
    expect(historyValue()).not.toContain('data:image');

    fireEvent.click(within(card).getByRole('button', { name: 'Use as draft' }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(applied[0].rules.entry).toHaveLength(6);
    expect(run).not.toHaveBeenCalled();
  });

  it('shows the charted-stock self-check line on the reading card', async () => {
    chartResponse = chartScreen({
      selfCheck: {
        status: 'checked', symbol: 'RELIANCE', matched: 2, total: 3, repaired: true,
        line: 'Checked against RELIANCE: matches 2 of 3 conditions',
      },
    });
    render(<AiCopilotDock strategy={chartTemplate()} />);
    attachFile(pngFile());
    await screen.findByAltText('Attached chart preview');
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    const card = await screen.findByRole('article', { name: 'Chart reading' });
    expect(within(card).getByText('Checked against RELIANCE: matches 2 of 3 conditions')).toBeTruthy();
    expect(requestScan).not.toHaveBeenCalled();
  });

  it('attaches a pasted image and a dropped image', async () => {
    render(<AiCopilotDock strategy={chartTemplate()} />);
    fireEvent.paste(screen.getByLabelText('Research request'), {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => pngFile('pasted.png') }] },
    });
    expect(await screen.findByAltText('Attached chart preview')).toBeTruthy();
    expect(screen.getByText('pasted.png')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove attached chart image' }));
    expect(screen.queryByAltText('Attached chart preview')).toBeNull();

    fireEvent.drop(composer(), { dataTransfer: { files: [pngFile('dropped.png')], types: ['Files'] } });
    expect(await screen.findByAltText('Attached chart preview')).toBeTruthy();
    expect(screen.getByText('dropped.png')).toBeTruthy();
  });

  it('rejects an unsupported type and an oversized image with visible errors', async () => {
    render(<AiCopilotDock strategy={chartTemplate()} />);
    attachFile(new File(['gif'], 'chart.gif', { type: 'image/gif' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Attach a PNG, JPEG or WebP chart image.');

    attachFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Chart images must be 5 MB or smaller.'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByAltText('Attached chart preview')).toBeNull();
  });

  it('shows an unavailable message without starting a scan or rendering a reading', async () => {
    chartResponse = unavailable();
    render(<AiCopilotDock strategy={chartTemplate()} />);
    attachFile(pngFile());
    await screen.findByAltText('Attached chart preview');
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() => expect(screen.getAllByText(unavailable().message).length).toBeGreaterThan(0));
    expect(requestScan).not.toHaveBeenCalled();
    expect(screen.queryByRole('article', { name: 'Chart reading' })).toBeNull();
    expect(screen.queryByLabelText('Screen results')).toBeNull();
  });

  it('offers Try again that re-reads the same chart image and hint', async () => {
    chartResponse = unavailable();
    render(<AiCopilotDock strategy={chartTemplate()} />);
    attachFile(pngFile());
    await screen.findByAltText('Attached chart preview');
    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'Focus on the RSI breakout' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(screen.getAllByText(unavailable().message).length).toBeGreaterThan(0));
    const retry = await screen.findByRole('button', { name: 'Try again' });
    chartResponse = chartScreen();
    fireEvent.click(retry);
    const card = await screen.findByRole('article', { name: 'Chart reading' });
    expect(within(card).getByText(/Price sits near a 250-bar low/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(String(call[1].body));
      expect(body.hint).toBe('Focus on the RSI breakout');
      expect(body.image.startsWith('data:image/png;base64,')).toBe(true);
    }
  });

  it('shows Try again when an async chart job fails, then re-reads the same image and hint', async () => {
    const jobId = '11111111-1111-4111-8111-111111111111';
    const jobFetch = (failFirst: boolean) => {
      let polls = 0;
      const mock = vi.fn(async (url: string) => {
        if (String(url).includes('/api/v2/chart-analysis')) {
          return { ok: true, status: 202, json: async () => ({ schemaVersion: 2, jobId, status: 'queued' }) };
        }
        if (String(url).includes('/api/v2/jobs/')) {
          polls += 1;
          if (failFirst && polls === 1) {
            return { ok: true, status: 200, json: async () => ({ id: jobId, kind: 'chart', status: 'failed', error: { code: 'CHART_READ_FAILED', message: "I couldn't read this chart. The AI models didn't return a reading. Try again, or describe the setup in words." } }) };
          }
          return { ok: true, status: 200, json: async () => ({ id: jobId, kind: 'chart', status: 'succeeded', result: chartScreen() }) };
        }
        return { ok: true, status: 200, json: async () => chartResponse };
      });
      return mock;
    };
    fetchMock = jobFetch(true);
    vi.stubGlobal('fetch', fetchMock);
    render(<AiCopilotDock strategy={chartTemplate()} />);
    attachFile(pngFile());
    await screen.findByAltText('Attached chart preview');
    fireEvent.change(screen.getByLabelText('Research request'), { target: { value: 'Focus on the RSI breakout' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    const retry = await screen.findByRole('button', { name: 'Try again' });
    fetchMock = jobFetch(false);
    vi.stubGlobal('fetch', fetchMock);
    fireEvent.click(retry);
    const card = await screen.findByRole('article', { name: 'Chart reading' });
    expect(within(card).getByText(/Price sits near a 250-bar low/)).toBeTruthy();
    const posts = fetchMock.mock.calls.filter(call => String(call[0]).includes('/api/v2/chart-analysis'));
    expect(posts).toHaveLength(1);
    const body = JSON.parse(String(posts[0][1].body));
    expect(body.hint).toBe('Focus on the RSI breakout');
    expect(body.image.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('shows close matches with scores and still requires explicit approval before a backtest', async () => {
    const fiveRules: StrategyAST = {
      ...chartTemplate(),
      rules: { ...chartTemplate().rules, entry: chartTemplate().rules.entry.slice(0, 5) },
    };
    chartResponse = chartScreen({ strategy: fiveRules });
    vi.mocked(requestScan).mockResolvedValue(scanBase({ nearMatches: [match()] }));
    const run = vi.fn().mockResolvedValue(undefined);
    render(<AiCopilotDock strategy={chartTemplate()} symbols={[reliant]} onResearchBacktest={run} />);
    attachFile(pngFile());
    await screen.findByAltText('Attached chart preview');
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    const chartCard = await screen.findByRole('article', { name: 'Chart reading' });
    expect(requestScan).not.toHaveBeenCalled();
    fireEvent.click(within(chartCard).getByRole('button', { name: 'Scan with these' }));
    expect(await screen.findByText('Close matches (missing one condition)')).toBeTruthy();
    expect(screen.getByText('4/5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare backtest for RELIANCE' }));
    expect(await screen.findByRole('article', { name: 'Backtest review' })).toBeTruthy();
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use these assumptions and run' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  });

  it('clears an attached image and the chart reading when a new chat starts', async () => {
    const strategy = chartTemplate();
    const view = render(<AiCopilotDock strategy={strategy} newConversationSignal={0} />);
    attachFile(pngFile('first.png'));
    await screen.findByAltText('Attached chart preview');
    view.rerender(<AiCopilotDock strategy={strategy} newConversationSignal={1} />);
    expect(screen.queryByAltText('Attached chart preview')).toBeNull();

    attachFile(pngFile('second.png'));
    await screen.findByAltText('Attached chart preview');
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('article', { name: 'Chart reading' })).toBeTruthy();

    view.rerender(<AiCopilotDock strategy={strategy} newConversationSignal={2} />);
    expect(screen.queryByRole('article', { name: 'Chart reading' })).toBeNull();
    expect(screen.queryByLabelText('Screen results')).toBeNull();
    expect(screen.queryByAltText('Attached chart preview')).toBeNull();
  });

  it('edits and removes conditions, then scans exactly the confirmed setup', async () => {
    render(<AiCopilotDock strategy={chartTemplate()} />);
    attachFile(pngFile());
    await screen.findByAltText('Attached chart preview');
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    const card = await screen.findByRole('article', { name: 'Chart reading' });

    expect(requestScan).not.toHaveBeenCalled();
    fireEvent.change(within(card).getByLabelText('Condition 1 value'), { target: { value: '42' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Remove condition 5' }));
    expect(within(card).getByText('5 confirmed conditions')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Scan with these' }));

    await waitFor(() => expect(requestScan).toHaveBeenCalledTimes(1));
    const scanned = vi.mocked(requestScan).mock.calls[0][0].strategy;
    expect(scanned.rules.entry).toHaveLength(5);
    expect(scanned.rules.entry[0].rightValue).toBe(42);
    expect(scanned.indicators.some(indicator => indicator.id === 'low250')).toBe(true);
  });

  it('caches the reading by image SHA-256 so the same image is not re-read', async () => {
    const strategy = chartTemplate();
    const view = render(<AiCopilotDock strategy={strategy} />);
    attachFile(pngFile('same.png'));
    await screen.findByAltText('Attached chart preview');
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    const first = await screen.findByRole('article', { name: 'Chart reading' });
    fireEvent.click(within(first).getByRole('button', { name: 'Scan with these' }));
    await waitFor(() => expect(requestScan).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    view.rerender(<AiCopilotDock strategy={strategy} newConversationSignal={1} />);
    vi.mocked(requestScan).mockClear();
    attachFile(pngFile('same.png'));
    await screen.findByAltText('Attached chart preview');
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('article', { name: 'Chart reading' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Cached chart reading · same image/)).toBeTruthy();
    expect(requestScan).not.toHaveBeenCalled();
  });
});
