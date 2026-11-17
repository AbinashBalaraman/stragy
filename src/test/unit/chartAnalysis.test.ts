// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
  it('posts the image, a bounded hint and the current strategy, then parses chart fields', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => screenResponse() });
    const parsed = await requestChartAnalysis({
      image: dataUrl(),
      hint: 'x'.repeat(1005),
      currentStrategy: chartTemplate(),
    });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v2/chart-analysis');
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.image).toBe(dataUrl());
    expect(body.hint).toHaveLength(1000);
    expect(body.currentStrategy.rules.entry).toHaveLength(6);
    expect(parsed.kind).toBe('screen');
    expect(parsed.chartReading?.source).toBe('chart_image');
    expect(parsed.chartReading?.confidence).toBe(0.42);
    expect(parsed.chartReading?.observations).toEqual(observations);
  });

  it('keeps an unavailable conversation response without inventing a chart reading', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        schemaVersion: 1,
        kind: 'conversation',
        originatingRevision: 1,
        message: 'The image could not be analysed. Nothing was run.',
        method: 'unavailable',
        provider: { name: 'none', model: null, aiGenerated: false },
        warnings: [],
      }),
    });
    const parsed = await requestChartAnalysis({ image: dataUrl(), currentStrategy: chartTemplate() });
    expect(parsed.kind).toBe('conversation');
    expect(parsed.chartReading).toBeUndefined();
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
    fetchMock.mockReturnValue(new Promise(resolve => { settle = resolve; }));
    const pending = requestChartAnalysis({ image: dataUrl(), currentStrategy: chartTemplate() });
    await vi.advanceTimersByTimeAsync(209_000);
    // Ten seconds of margin over the server budget: still in flight, not aborted.
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
    settle?.({ ok: true, status: 200, json: async () => screenResponse() });
    expect((await pending).kind).toBe('screen');
  });

  it('bounds a stalled request at 210 seconds and confirms no result', async () => {
    vi.useFakeTimers();
    fetchMock.mockReturnValue(new Promise(() => {}));
    const result = requestChartAnalysis({ image: dataUrl(), currentStrategy: chartTemplate() }).catch(error => error);
    await vi.advanceTimersByTimeAsync(210_001);
    expect(await result).toMatchObject({
      code: 'CLIENT_DEADLINE',
      message: 'Chart analysis deadline exceeded. No result was confirmed.',
    });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('cancels immediately when the caller aborts mid-flight', async () => {
    const controller = new AbortController();
    fetchMock.mockReturnValue(new Promise(() => {}));
    const pending = requestChartAnalysis({ image: dataUrl(), currentStrategy: chartTemplate() }, controller.signal).catch(error => error);
    controller.abort();
    expect(await pending).toMatchObject({ name: 'AbortError' });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('does not upload when the caller already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(requestChartAnalysis({ image: dataUrl(), currentStrategy: chartTemplate() }, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
