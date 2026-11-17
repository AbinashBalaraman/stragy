// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHART_ANALYSIS_DEADLINE_MS,
  CHART_IMAGE_MAX_BYTES,
  parseChartAnalysisResponse,
  prepareChartImage,
  requestChartAnalysis,
} from '../../client/chartAnalysis';
import { STRATEGY_TEMPLATES } from '../../shared/strategy/templates';

const chartTemplate = () => {
  const template = STRATEGY_TEMPLATES.find(item => item.id === 'rsi_trendline_breakout_near_lows');
  if (!template) throw new Error('Chart template missing');
  return template.strategy;
};
const observations = {
  timeframe: '1D',
  indicators: [{ name: 'RSI', params: [14], legendValues: [42.5] }],
  drawnLines: [{ panel: 'rsi', direction: 'down', description: 'Falling resistance line' }],
  priceTrend: 'downtrend',
  nearRange: 'low',
  lastCandle: 'bullish',
  events: ['RSI crossed above the falling trendline'],
};
const screenResponse = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  kind: 'screen',
  originatingRevision: null,
  message: 'Chart read. Nothing has been run.',
  method: 'external_ai',
  provider: { name: 'test-provider', model: 'vision', aiGenerated: true },
  warnings: [],
  universe: 'NIFTY_50',
  strategy: chartTemplate(),
  assumptions: ['The image is used only to propose testable conditions.'],
  missingBacktestRules: ['exits', 'positionSizing', 'executionAndCosts'],
  backtestReady: false,
  source: 'chart_image',
  observations,
  confidence: 0.42,
  summary: 'A falling RSI trendline with price near a 250-bar low.',
  ...overrides,
});

let fetchMock: ReturnType<typeof vi.fn>;
const dataUrl = () => 'data:image/png;base64,' + btoa('chart-bytes');
const JOB_ID = '9e7f4d00-0000-4000-8000-000000000001';
const job = (status: string, extra: Record<string, unknown> = {}) => ({
  id: JOB_ID,
  kind: 'chart',
  status,
  stage: status,
  createdAt: '2026-11-17T10:00:00.000Z',
  ...extra,
});
const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** POST accepts the job; each GET walks the scripted statuses; DELETE cancels. */
function serveChartJob(steps: Array<Record<string, unknown>>) {
  let polls = 0;
  fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
    if (url === '/api/v2/chart-analysis') return reply({ schemaVersion: 2, jobId: JOB_ID, status: 'queued' }, 202);
    if (init.method === 'DELETE') return reply(job('cancelled', { error: { code: 'JOB_CANCELLED', message: 'Cancelled by the requester.' } }));
    const step = steps[Math.min(polls++, steps.length - 1)];
    return reply(job(String(step.status), step));
  });
}
const jobCalls = () => fetchMock.mock.calls.filter(call => String(call[0]).startsWith('/api/v2/jobs/'));
const postCalls = () => fetchMock.mock.calls.filter(call => call[0] === '/api/v2/chart-analysis');

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('chart image preparation', () => {
  it('accepts PNG, JPEG and WebP files and reads them as data URLs without persisting them', async () => {
    const prepared = await prepareChartImage(new File([new Uint8Array([137, 80, 78, 71])], 'chart.png', { type: 'image/png' }));
    expect(prepared.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(prepared.mimeType).toBe('image/png');
    expect(prepared.bytes).toBe(4);
    expect(prepared.downscaled).toBe(false);
  });

  it('rejects unsupported image types', async () => {
    await expect(prepareChartImage(new File(['gif'], 'chart.gif', { type: 'image/gif' })))
      .rejects.toThrow('Attach a PNG, JPEG or WebP chart image.');
  });

  it('rejects images larger than 5 MB before reading them', async () => {
    const large = new File([new Uint8Array(CHART_IMAGE_MAX_BYTES + 1)], 'chart.png', { type: 'image/png' });
    await expect(prepareChartImage(large)).rejects.toThrow('Chart images must be 5 MB or smaller.');
  });
});

describe('chart analysis transport', () => {
  it('posts the image, a bounded hint and the current strategy, then polls the job and parses chart fields', async () => {
    serveChartJob([{ status: 'succeeded', result: screenResponse() }]);
    const parsed = await requestChartAnalysis({
      image: dataUrl(),
      hint: 'x'.repeat(1005),
      currentStrategy: chartTemplate(),
    });
    expect(postCalls()).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v2/chart-analysis');
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.image).toBe(dataUrl());
    expect(body.hint).toHaveLength(1000);
    expect(body.currentStrategy.rules.entry).toHaveLength(6);
    expect(jobCalls().map(call => call[0])).toEqual(['/api/v2/jobs/' + JOB_ID]);
    expect(parsed.kind).toBe('screen');
    expect(parsed.chartReading?.source).toBe('chart_image');
    expect(parsed.chartReading?.confidence).toBe(0.42);
    expect(parsed.chartReading?.observations).toEqual(observations);
  });

  it('keeps polling short job requests until the analysis succeeds', async () => {
    vi.useFakeTimers();
    serveChartJob([
      { status: 'queued', stage: 'waiting' },
      { status: 'running', stage: 'chart_observations' },
      { status: 'succeeded', result: screenResponse() },
    ]);
    const pending = requestChartAnalysis({ image: dataUrl(), currentStrategy: chartTemplate() });
    await vi.advanceTimersByTimeAsync(3_000);
    const parsed = await pending;
    expect(parsed.kind).toBe('screen');
    // One short upload, then only short GETs: no request is held open while models run.
    expect(postCalls()).toHaveLength(1);
    expect(jobCalls()).toHaveLength(3);
    expect(jobCalls().every(call => call[0] === '/api/v2/jobs/' + JOB_ID)).toBe(true);
  });

  it('keeps an unavailable conversation response without inventing a chart reading', async () => {
    serveChartJob([{
      status: 'succeeded',
      result: {
        schemaVersion: 1,
        kind: 'conversation',
        originatingRevision: 1,
        message: 'The image could not be analysed. Nothing was run.',
        method: 'unavailable',
        provider: { name: 'none', model: null, aiGenerated: false },
        warnings: [],
      },
    }]);
    const parsed = await requestChartAnalysis({ image: dataUrl(), currentStrategy: chartTemplate() });
    expect(parsed.kind).toBe('conversation');
    expect(parsed.chartReading).toBeUndefined();
  });

  it('surfaces a failed job with the worker error', async () => {
    serveChartJob([{
      status: 'failed',
      error: { code: 'JOB_TIMEOUT', message: 'The chart analysis took too long and was stopped. Try again.' },
    }]);
    await expect(requestChartAnalysis({ image: dataUrl(), currentStrategy: chartTemplate() })).rejects.toMatchObject({
      code: 'JOB_TIMEOUT',
      message: 'The chart analysis took too long and was stopped. Try again.',
    });
    // A terminal job is never cancelled a second time.
    expect(fetchMock.mock.calls.some(call => call[1]?.method === 'DELETE')).toBe(false);
  });

  it('surfaces a cancelled job with the same cancellation error', async () => {
    serveChartJob([{ status: 'cancelled', error: { code: 'JOB_CANCELLED', message: 'Cancelled by the requester.' } }]);
    await expect(requestChartAnalysis({ image: dataUrl(), currentStrategy: chartTemplate() })).rejects.toMatchObject({
      code: 'JOB_CANCELLED',
      message: 'Cancelled by the requester.',
    });
  });

  it('rides out a transient gateway failure while polling', async () => {
    vi.useFakeTimers();
    let polls = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (url === '/api/v2/chart-analysis') return reply({ schemaVersion: 2, jobId: JOB_ID, status: 'queued' }, 202);
      if (init.method === 'DELETE') return reply(job('cancelled'));
      polls++;
      if (polls === 1) return reply({ success: false, error: { code: 'SERVER_UNAVAILABLE', message: 'Bad gateway.' } }, 502);
      return reply(job('succeeded', { result: screenResponse() }));
    });
    const pending = requestChartAnalysis({ image: dataUrl(), currentStrategy: chartTemplate() });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_500);
    expect((await pending).kind).toBe('screen');
    expect(polls).toBe(2);
  });

  it('rejects a chart reading attached to a non-screen response', () => {
    expect(() => parseChartAnalysisResponse({
      schemaVersion: 1,
      kind: 'conversation',
      originatingRevision: 1,
      message: 'Hello',
      method: 'rule_parser',
      provider: { name: 'none', model: null, aiGenerated: false },
      warnings: [],
      source: 'chart_image',
      observations,
      confidence: 0.5,
      summary: 'Summary',
    })).toThrow(/without a screen plan/);
  });

  it('rejects a malformed data URL before calling the server', async () => {
    await expect(requestChartAnalysis({ image: 'data:text/plain;base64,QQ==', currentStrategy: chartTemplate() }))
      .rejects.toMatchObject({ code: 'CHART_IMAGE_INVALID' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps waiting inside the 200-second server budget', async () => {
    vi.useFakeTimers();
    let settle: ((value: unknown) => void) | undefined;
    let pollSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (url === '/api/v2/chart-analysis') return reply({ schemaVersion: 2, jobId: JOB_ID, status: 'queued' }, 202);
      if (init.method === 'DELETE') return reply(job('cancelled'));
      pollSignal = init.signal as AbortSignal;
      return new Promise(resolve => { settle = resolve; });
    });
    const pending = requestChartAnalysis({ image: dataUrl(), currentStrategy: chartTemplate() });
    await vi.advanceTimersByTimeAsync(209_000);
    // Ten seconds of margin over the server budget: still in flight, not aborted.
    expect(pollSignal?.aborted).toBe(false);
    settle?.(reply(job('succeeded', { result: screenResponse() })));
    expect((await pending).kind).toBe('screen');
  });

  it('bounds a stalled job at 210 seconds, confirms no result and cancels it', async () => {
    vi.useFakeTimers();
    let pollSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (url === '/api/v2/chart-analysis') return reply({ schemaVersion: 2, jobId: JOB_ID, status: 'queued' }, 202);
      if (init.method === 'DELETE') return reply(job('cancelled'));
      pollSignal = init.signal as AbortSignal;
      return new Promise(() => {});
    });
    const result = requestChartAnalysis({ image: dataUrl(), currentStrategy: chartTemplate() }).catch(error => error);
    await vi.advanceTimersByTimeAsync(CHART_ANALYSIS_DEADLINE_MS + 1);
    expect(await result).toMatchObject({
      code: 'CLIENT_DEADLINE',
      message: 'Chart analysis deadline exceeded. No result was confirmed.',
    });
    expect(pollSignal?.aborted).toBe(true);
    const deletes = fetchMock.mock.calls.filter(call => call[1]?.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0]).toBe('/api/v2/jobs/' + JOB_ID);
  });

  it('cancels immediately when the caller aborts mid-flight', async () => {
    const controller = new AbortController();
    let pollSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (url === '/api/v2/chart-analysis') return reply({ schemaVersion: 2, jobId: JOB_ID, status: 'queued' }, 202);
      if (init.method === 'DELETE') return reply(job('cancelled'));
      pollSignal = init.signal as AbortSignal;
      return new Promise(() => {});
    });
    const pending = requestChartAnalysis({ image: dataUrl(), currentStrategy: chartTemplate() }, controller.signal).catch(error => error);
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    expect(await pending).toMatchObject({ name: 'AbortError' });
    expect(pollSignal?.aborted).toBe(true);
    const last = fetchMock.mock.calls.at(-1);
    expect(last?.[0]).toBe('/api/v2/jobs/' + JOB_ID);
    expect(last?.[1]?.method).toBe('DELETE');
  });

  it('does not upload when the caller already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(requestChartAnalysis({ image: dataUrl(), currentStrategy: chartTemplate() }, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
