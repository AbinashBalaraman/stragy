import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeChart, parseChartImageDataUrl } from '../../server/ai/chartVision';
import {
  chartReadingCacheSize, clearChartReadingCache, readChartReading, writeChartReading,
} from '../../server/ai/chartReadingCache';
import { fakeResponse, openAIBody, recordingFetch, validStrategy } from '../../server/ai/testFixtures';
import type { ResearchChatResponse } from '../../shared/contracts/research-chat';

const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
const image = parseChartImageDataUrl(png);
const visionEnv = {
  AI_PROVIDER: 'openai', OPENAI_API_KEY: 'fixture-cache-key', AI_MODEL: 'gpt-test', AI_COST_POLICY: 'operator-approved',
} as const;

const observations = {
  timeframe: '1D',
  indicators: [{ name: 'RSI', params: [14], legendValues: [45.76, 31.9], legendRoles: ['current', 'ma'] }],
  drawnLines: [{ panel: 'rsi', direction: 'down', description: 'falling resistance', lastBarRelation: 'crossed_above' }],
  priceTrend: 'downtrend',
  nearRange: 'low',
  lastCandle: 'bullish',
  events: [],
};
const plan = {
  conditions: [
    { type: 'rsi_trendline_breakout', lookbackBars: 3, period: 14 },
    { type: 'rsi_above_signal', period: 14 },
    { type: 'near_period_low', period: 250, value: 15 },
  ],
  confidence: 0.8,
  summary: 'RSI broke a falling trendline near the low. Conditions: RSI (14) is greater than its signal.',
  assumptions: [],
};

function modelFetch() {
  return recordingFetch((_url, init) => {
    const body = JSON.parse(init.body);
    return fakeResponse({ body: openAIBody(JSON.stringify(Array.isArray(body.messages[1].content) ? observations : plan)) });
  });
}

beforeEach(() => clearChartReadingCache());

describe('server chart reading cache', () => {
  it('reuses one reading for the same image bytes and hint', async () => {
    const fetch = modelFetch();
    const first = await analyzeChart({ image, hint: 'same hint', currentStrategy: validStrategy() }, { env: visionEnv, fetch, cache: true });
    const second = await analyzeChart({ image, hint: 'same hint', currentStrategy: validStrategy() }, { env: visionEnv, fetch, cache: true });
    expect(first.kind).toBe('screen');
    expect(second).toEqual(first);
    expect(fetch.calls).toHaveLength(2);
    expect(chartReadingCacheSize()).toBe(1);
  });

  it('deduplicates concurrent identical reads into one model call', async () => {
    const fetch = modelFetch();
    const [first, second] = await Promise.all([
      analyzeChart({ image, hint: 'concurrent', currentStrategy: validStrategy() }, { env: visionEnv, fetch, cache: true }),
      analyzeChart({ image, hint: 'concurrent', currentStrategy: validStrategy() }, { env: visionEnv, fetch, cache: true }),
    ]);
    expect(first).toEqual(second);
    expect(fetch.calls).toHaveLength(2);
  });

  it('keys the cache by hint and expires entries after 24 hours', async () => {
    const fetch = modelFetch();
    await analyzeChart({ image, hint: 'one', currentStrategy: validStrategy() }, { env: visionEnv, fetch, cache: true });
    await analyzeChart({ image, hint: 'two', currentStrategy: validStrategy() }, { env: visionEnv, fetch, cache: true });
    expect(fetch.calls).toHaveLength(4);

    const first = await analyzeChart({ image, hint: 'ttl', currentStrategy: validStrategy() }, { env: visionEnv, fetch, cache: true });
    const key = 'ttl-entry';
    writeChartReading(key, first);
    expect(readChartReading(key)).not.toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1);
    expect(readChartReading(key)).toBeNull();
    vi.useRealTimers();
  });

  it('keeps the in-memory LRU bounded at 200 entries', async () => {
    const fetch = modelFetch();
    const reading = await analyzeChart({ image, hint: 'lru', currentStrategy: validStrategy() }, { env: visionEnv, fetch, cache: true });
    for (let index = 0; index < 201; index++) writeChartReading('key-' + index, reading as ResearchChatResponse);
    expect(chartReadingCacheSize()).toBe(200);
    expect(readChartReading('key-0')).toBeNull();
    expect(readChartReading('key-200')).not.toBeNull();
  });
});
