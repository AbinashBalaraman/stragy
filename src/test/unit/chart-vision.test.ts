import { describe, expect, it, vi } from 'vitest';
import {
  CHART_IMAGE_LIMITS, ChartImageError, VISION_ATTEMPT_TIMEOUT_MS, VISION_OBSERVATION_ALLOCATION_MS, VISION_OBSERVATIONS_BUDGET_MS, VISION_PLAN_ATTEMPT_TIMEOUT_MS, VISION_PLAN_RESERVE_MS, VISION_TOTAL_BUDGET_MS, analyzeChart, chartObservationSummary, legendBand, observationAttemptTimeouts, parseChartImageDataUrl, visionAttemptTimeout, withVisionTimeout,
} from '../../server/ai/chartVision';
import { callProvider, createRequestBudget, resolveAIConfig, resolveVisionConfig } from '../../server/ai/provider';
import { getAIStatus } from '../../server/ai/copilot';
import { parseConfig } from '../../server/config';
import { parseResearchChatResponse } from '../../shared/contracts/research-chat';
import { validateStrategy } from '../../shared/strategy/schema';
import { fakeResponse, openAIBody, recordingFetch, validStrategy } from '../../server/ai/testFixtures';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const pngUrl = 'data:image/png;base64,' + PNG_BYTES.toString('base64');
const image = () => parseChartImageDataUrl(pngUrl);
const imageRequest = { system: 'read', user: '{"hint":null}', json: true, images: [pngUrl] };

const observations = {
  timeframe: '1D',
  indicators: [{ name: 'RSI', params: [14], legendValues: [45.76, 31.9] }],
  drawnLines: [{ panel: 'rsi', direction: 'down', description: 'falling resistance line' }],
  priceTrend: 'downtrend',
  nearRange: 'low',
  lastCandle: 'bullish',
  events: ['RSI crossed above the falling line'],
};
const plan = {
  conditions: [
    { type: 'rsi_below', value: 36, lookbackBars: 10 },
    { type: 'rsi_trendline_breakout', lookbackBars: 3, period: 14 },
    { type: 'rsi_above_signal', period: 14 },
    { type: 'near_period_low', period: 250, value: 15 },
    { type: 'negative_period_change', period: 126, value: 5 },
    { type: 'rsi_around_value', value: 45.76, tolerance: 6 },
  ],
  confidence: 0.74,
  summary: 'Daily RSI turned up through a falling trendline near the 250-bar low.',
  assumptions: ['Legend RSI value read as 45.76.'],
};
// Free-plan variant without the legend band, used by the retry test.
const planWithoutBand = { ...plan, conditions: plan.conditions.slice(0, 5), assumptions: [] };
const visionEnv = { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'fixture-vision-key', AI_MODEL: 'gpt-test', AI_COST_POLICY: 'operator-approved' };

function pass2Calls(f: ReturnType<typeof recordingFetch>): any[] {
  return f.calls.map(call => ({ url: call.url, body: JSON.parse(call.init.body) }))
    .filter(({ body }) => !Array.isArray(body.messages?.[1]?.content) && !body.contents);
}

describe('chart image validation', () => {
  it('accepts png, jpeg and webp magic bytes', () => {
    expect(image().mimeType).toBe('image/png');
    const jpeg = 'data:image/jpeg;base64,' + JPEG_BYTES.toString('base64');
    expect(parseChartImageDataUrl(jpeg).mimeType).toBe('image/jpeg');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(4)]);
    expect(parseChartImageDataUrl('data:image/webp;base64,' + webp.toString('base64')).mimeType).toBe('image/webp');
  });

  it('rejects unsupported MIME, malformed base64, wrong magic and oversize payloads', () => {
    const rejected = (input: unknown, status: number, code: string) => {
      try { parseChartImageDataUrl(input); throw new Error('expected rejection'); }
      catch (error) {
        expect(error).toBeInstanceOf(ChartImageError);
        expect((error as ChartImageError).status).toBe(status);
        expect((error as ChartImageError).code).toBe(code);
      }
    };
    rejected('data:image/gif;base64,' + pngUrl.split(',')[1], 422, 'INVALID_IMAGE');
    rejected('data:image/png;base64,not%%%base64', 422, 'INVALID_IMAGE');
    rejected('data:image/png;base64,' + JPEG_BYTES.toString('base64'), 422, 'IMAGE_TYPE_MISMATCH');
    rejected(42, 422, 'INVALID_IMAGE');
    const oversize = 'data:image/png;base64,' + Buffer.alloc(CHART_IMAGE_LIMITS.maxDecodedBytes + 1).toString('base64');
    rejected(oversize, 413, 'IMAGE_TOO_LARGE');
  });
});

describe('vision provider image payloads', () => {
  it('sends Gemini inline_data parts', async () => {
    const cfg = resolveAIConfig({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'fixture-gemini' });
    const f = recordingFetch(() => fakeResponse({ body: { candidates: [{ content: { parts: [{ text: '{}' }] } }] } }));
    expect((await callProvider(cfg, imageRequest, { fetch: f, budget: createRequestBudget() })).ok).toBe(true);
    const body = JSON.parse(f.calls[0].init.body);
    expect(body.contents[0].parts[0].text).toBe(imageRequest.user);
    expect(body.contents[0].parts[1].inline_data).toEqual({ mime_type: 'image/png', data: PNG_BYTES.toString('base64') });
  });

  it.each([
    ['opencode-go', { AI_PROVIDER: 'opencode-go', OPENCODE_API_KEY: 'fixture-go', AI_MODEL: 'beam-free' }],
    ['tokenrouter', { AI_PROVIDER: 'tokenrouter', TOKENROUTER_API_KEY: 'fixture-router', AI_MODEL: 'fixture-model' }],
    ['openai', { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'fixture-openai', AI_MODEL: 'gpt-test' }],
  ])('%s sends OpenAI-compatible image_url content parts', async (_name, env) => {
    const cfg = resolveAIConfig(env);
    expect(cfg.ready).toBe(true);
    const f = recordingFetch(() => fakeResponse({ body: openAIBody('{}') }));
    expect((await callProvider(cfg, imageRequest, { fetch: f, budget: createRequestBudget() })).ok).toBe(true);
    const body = JSON.parse(f.calls[0].init.body);
    expect(body.messages[1].content[0]).toEqual({ type: 'text', text: imageRequest.user });
    expect(body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: pngUrl } });
  });

  it('bounds vision request bytes before any network call', async () => {
    const cfg = resolveAIConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'fixture-openai', AI_MODEL: 'gpt-test' });
    const f = recordingFetch(() => fakeResponse({ body: openAIBody('{}') }));
    const result = await callProvider(cfg, { ...imageRequest, maxRequestBodyBytes: 50 }, { fetch: f, budget: createRequestBudget() });
    expect(result).toMatchObject({ ok: false, code: 'request_too_large' });
    expect(f.calls).toHaveLength(0);
  });
});

describe('vision time budget', () => {
  it('caps every chart attempt and its fallback chain without losing the key', () => {
    const cfg = resolveAIConfig({ ...visionEnv, AI_TIMEOUT_MS: '60000', AI_MODEL: 'gpt-primary', AI_FALLBACK_MODELS: 'openai:gpt-fallback', AI_COST_POLICY: 'operator-approved' });
    const capped = withVisionTimeout(cfg);
    expect(capped.timeoutMs).toBe(VISION_ATTEMPT_TIMEOUT_MS);
    expect(capped.fallbackTargets?.[0]?.config?.timeoutMs).toBe(VISION_ATTEMPT_TIMEOUT_MS);
    expect((capped as unknown as { apiKey?: string }).apiKey).toBe('fixture-vision-key');
    expect((capped.fallbackTargets?.[0]?.config as unknown as { apiKey?: string } | undefined)?.apiKey).toBe('fixture-vision-key');
    const shorter = withVisionTimeout(cfg, 30_000);
    expect(shorter.timeoutMs).toBe(30_000);
    expect(shorter.fallbackTargets?.[0]?.config?.timeoutMs).toBe(30_000);
    const longer = withVisionTimeout(cfg, 70_000, true);
    expect(longer.timeoutMs).toBe(70_000);
    expect((longer as unknown as { apiKey?: string }).apiKey).toBe('fixture-vision-key');
    expect(VISION_ATTEMPT_TIMEOUT_MS * 3).toBeLessThan(180_000);
    expect(VISION_TOTAL_BUDGET_MS).toBe(200_000);
    expect(VISION_TOTAL_BUDGET_MS + 10_000).toBeLessThanOrEqual(210_000);
  });

  it('splits the remaining chart budget across the models still to try', () => {
    expect(visionAttemptTimeout(VISION_TOTAL_BUDGET_MS, 3)).toBe(VISION_ATTEMPT_TIMEOUT_MS);
    expect(visionAttemptTimeout(120_000, 3)).toBe(40_000);
    expect(visionAttemptTimeout(30_000, 3)).toBe(10_000);
    expect(visionAttemptTimeout(10_000, 1)).toBe(10_000);
    expect(visionAttemptTimeout(0, 3)).toBe(0);
  });

  it('reserves the plan pass and the paid observation fallback', () => {
    expect(VISION_OBSERVATIONS_BUDGET_MS + VISION_PLAN_RESERVE_MS).toBe(VISION_TOTAL_BUDGET_MS);
    expect(VISION_PLAN_RESERVE_MS).toBeGreaterThanOrEqual(VISION_ATTEMPT_TIMEOUT_MS + 5_000);
    // The audited default chain: primary free 55 s, short probe 10 s, paid 70 s.
    const chain = observationAttemptTimeouts([{ approvedPaid: false }, { approvedPaid: false }, { approvedPaid: true }]);
    expect(chain).toEqual([55_000, 10_000, 70_000]);
    expect(chain).toEqual([VISION_OBSERVATION_ALLOCATION_MS.primaryFree, VISION_OBSERVATION_ALLOCATION_MS.secondFree, VISION_OBSERVATION_ALLOCATION_MS.paid]);
    expect(chain.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(VISION_OBSERVATIONS_BUDGET_MS);
    // A fourth free model is skipped, never at the paid attempt's expense.
    const withExtraFree = observationAttemptTimeouts([{ approvedPaid: false }, { approvedPaid: false }, { approvedPaid: false }, { approvedPaid: true }]);
    expect(withExtraFree).toEqual([55_000, 10_000, 0, 70_000]);
    const freeOnly = observationAttemptTimeouts([{ approvedPaid: false }, { approvedPaid: false }, { approvedPaid: false }]);
    expect(freeOnly.every(ms => ms <= VISION_ATTEMPT_TIMEOUT_MS)).toBe(true);
    expect(freeOnly.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(VISION_OBSERVATIONS_BUDGET_MS);
    expect(observationAttemptTimeouts([{ approvedPaid: true }])[0]).toBe(VISION_ATTEMPT_TIMEOUT_MS);
  });

  it('gives the plan pass the reserve after observations succeed', async () => {
    const attempts: { pass: string; timeoutMs: number }[] = [];
    const spy = vi.spyOn(console, 'info').mockImplementation(line => {
      try {
        const event = JSON.parse(String(line));
        if (event.event === 'chart_model_attempt') attempts.push({ pass: event.pass, timeoutMs: event.timeoutMs });
      } catch { /* unrelated log line */ }
    });
    try {
      const env = { ...visionEnv, AI_MODEL: 'gpt-primary', AI_FALLBACK_MODELS: 'openai:gpt-fallback', AI_COST_POLICY: 'operator-approved' };
      const f = recordingFetch((_url, init) => {
        const body = JSON.parse(init.body);
        const content = Array.isArray(body.messages[1].content) ? observations : plan;
        return fakeResponse({ body: openAIBody(JSON.stringify(content)) });
      });
      const result = await analyzeChart({ image: image(), currentStrategy: validStrategy() }, { env, fetch: f, budget: createRequestBudget() });
      expect(result.kind).toBe('screen');
    } finally {
      spy.mockRestore();
    }
    const planAttempt = attempts.find(attempt => attempt.pass === 'plan');
    expect(planAttempt?.timeoutMs).toBe(VISION_PLAN_ATTEMPT_TIMEOUT_MS);
    expect(planAttempt!.timeoutMs).toBe(VISION_PLAN_ATTEMPT_TIMEOUT_MS);
    expect(VISION_PLAN_RESERVE_MS).toBeGreaterThanOrEqual(60_000);
    expect(attempts.filter(attempt => attempt.pass === 'observations').every(attempt => attempt.timeoutMs <= VISION_OBSERVATIONS_BUDGET_MS)).toBe(true);
  });

  it('renders sane observations plainly when the plan budget cannot fit', () => {
    const view = observations as unknown as Parameters<typeof chartObservationSummary>[0];
    expect(chartObservationSummary(view)).toContain('downtrend trend');
    expect(chartObservationSummary(view)).toContain('RSI(14) 45.76/31.9');
  });
});

describe('chart analysis', () => {
  it('returns unavailable without a configured provider and never calls fetch', async () => {
    const f = vi.fn();
    const result = await analyzeChart({ image: image(), currentStrategy: validStrategy() }, { env: { AI_PROVIDER: 'none' }, fetch: f });
    expect(result).toMatchObject({ kind: 'conversation', method: 'unavailable', provider: { name: 'none', aiGenerated: false } });
    expect(result.message).toMatch(/disabled|unavailable/i);
    expect(f).not.toHaveBeenCalled();
  });

  it('maps two passes into a validated chart screen contract with a legend band', async () => {
    const f = recordingFetch((_url, init) => {
      const body = JSON.parse(init.body);
      return fakeResponse({ body: openAIBody(JSON.stringify(Array.isArray(body.messages[1].content) ? observations : plan)) });
    });
    const result = await analyzeChart({ image: image(), hint: 'RSI downtrend break near lows', currentStrategy: validStrategy(), }, { env: visionEnv, fetch: f, budget: createRequestBudget() });
    expect(result.kind).toBe('screen');
    if (result.kind !== 'screen') throw new Error('screen expected');
    expect(result).toMatchObject({ universe: 'NIFTY_50', source: 'chart_image', backtestReady: false, confidence: 0.74, method: 'external_ai' });
    expect(result.observations).toEqual(observations);
    expect(result.summary).toContain('falling trendline');
    expect(result.summary).not.toMatch(/Conditions:/i);
    expect(result.strategy.name).toBe('RSI trendline breakout · near 52-week low');
    expect(result.assumptions.join(' ')).toMatch(/dropped to keep the scan findable:/i);
    expect(result.missingBacktestRules).toEqual(['exits', 'positionSizing', 'executionAndCosts']);
    expect(result.strategy.universe.timeframe).toBe('1D');
    expect(result.strategy.execution).toMatchObject({ allowLong: true, allowShort: false, orderType: 'MARKET' });
    expect(validateStrategy(result.strategy).success).toBe(true);
    expect(result.strategy.rules.entry.map(r => r.rightValue).filter((v): v is number => typeof v === 'number')).toEqual(expect.arrayContaining([40, 52]));
    expect(result.strategy.rules.entry.some(r => r.rightIndicator?.includes('rsi_tl') && r.operator === 'crossesAbove')).toBe(true);
    expect(result.strategy.rules.entry.some(r => r.lookback?.bars === 10)).toBe(true);
    expect(pass2Calls(f)).toHaveLength(1);
    const firstBody = JSON.parse(f.calls[0].init.body);
    expect(firstBody.max_completion_tokens).toBe(8000);
    const pass2System = JSON.parse(f.calls[1].init.body).messages[0].content;
    expect(pass2System).toContain('Exact strategy JSON requirements');
    expect(pass2System).toContain('FLAT NUMBERS');
    expect(pass2System).toContain('"timeframe":"1D"');
    expect(pass2System).toContain('Do NOT output the AST');
    expect(parseResearchChatResponse(result)).toEqual(result);
    expect(JSON.stringify(result)).not.toContain('fixture-vision-key');
  });

  it('reports the fallback model that actually answered, not the primary', async () => {
    const env = { ...visionEnv, AI_MODEL: 'gpt-primary', AI_FALLBACK_MODELS: 'openai:gpt-fallback', AI_COST_POLICY: 'operator-approved' };
    const f = recordingFetch((_url, init) => {
      const body = JSON.parse(init.body);
      if (body.model === 'gpt-primary') {
        return fakeResponse({ body: { choices: [{ message: { content: '' }, finish_reason: 'length' }] } });
      }
      const content = Array.isArray(body.messages[1].content) ? observations : plan;
      return fakeResponse({ body: openAIBody(JSON.stringify(content)) });
    });
    const result = await analyzeChart({ image: image(), currentStrategy: validStrategy() }, { env, fetch: f, budget: createRequestBudget() });
    expect(result.kind).toBe('screen');
    expect(result.provider).toEqual({ name: 'openai', model: 'gpt-fallback', aiGenerated: true });
    expect(f.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('falls through a provider-success response with unusable observations', async () => {
    const env = { ...visionEnv, AI_MODEL: 'gpt-primary', AI_FALLBACK_MODELS: 'openai:gpt-fallback', AI_COST_POLICY: 'operator-approved' };
    const f = recordingFetch((_url, init) => {
      const body = JSON.parse(init.body);
      if (body.model === 'gpt-primary') return fakeResponse({ body: openAIBody('not json at all') });
      const content = Array.isArray(body.messages[1].content) ? observations : plan;
      return fakeResponse({ body: openAIBody(JSON.stringify(content)) });
    });
    const result = await analyzeChart({ image: image(), currentStrategy: validStrategy() }, { env, fetch: f, budget: createRequestBudget() });
    expect(result.kind).toBe('screen');
    expect(result.provider).toEqual({ name: 'openai', model: 'gpt-fallback', aiGenerated: true });
    const models = f.calls.map(call => JSON.parse(call.init.body).model);
    expect(models.filter(model => model === 'gpt-primary')).toHaveLength(1);
    expect(models.filter(model => model === 'gpt-fallback').length).toBeGreaterThanOrEqual(2);
  });

  it('retries pass 2 once with the validation errors when the plan is unusable', async () => {
    let pass2 = 0;
    const f = recordingFetch((_url, init) => {
      const body = JSON.parse(init.body);
      if (Array.isArray(body.messages[1].content)) return fakeResponse({ body: openAIBody(JSON.stringify(observations)) });
      pass2++;
      if (pass2 === 1) return fakeResponse({ body: openAIBody(JSON.stringify({ ...planWithoutBand, conditions: [] })) });
      return fakeResponse({ body: openAIBody(JSON.stringify(planWithoutBand)) });
    });
    const result = await analyzeChart({ image: image(), currentStrategy: validStrategy() }, { env: visionEnv, fetch: f, budget: createRequestBudget() });
    expect(result.kind).toBe('screen');
    expect(pass2).toBe(2);
    const second = JSON.parse(pass2Calls(f)[1].body.messages[1].content);
    expect(second.errors.length).toBeGreaterThan(0);
    expect(second).toHaveProperty('rejected');
    expect(result.warnings.join(' ')).toMatch(/repair pass/i);
    expect(parseResearchChatResponse(result).kind).toBe('screen');
  });

  it('fails closed after one retry instead of inventing a reading', async () => {
    const f = recordingFetch((_url, init) => {
      const body = JSON.parse(init.body);
      if (Array.isArray(body.messages[1].content)) return fakeResponse({ body: openAIBody(JSON.stringify(observations)) });
      return fakeResponse({ body: openAIBody(JSON.stringify({ conditions: [] })) });
    });
    const result = await analyzeChart({ image: image(), currentStrategy: validStrategy() }, { env: visionEnv, fetch: f, budget: createRequestBudget() });
    expect(result).toMatchObject({ kind: 'conversation', method: 'unavailable' });
    expect(result.message).toBe("I couldn't read this chart. The AI models didn't return a reading. Try again, or describe the setup in words.");
    expect(JSON.stringify(result)).not.toContain('fixture-vision-key');
  });

  it('requires an executable workspace for exits, risk and costs', async () => {
    const f = vi.fn();
    const result = await analyzeChart({ image: image() }, { env: visionEnv, fetch: f });
    expect(result).toMatchObject({ kind: 'conversation', method: 'unavailable' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('vision configuration', () => {
  it('defaults to the text AI provider and supports independent overrides without leaking keys', () => {
    expect(resolveVisionConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'fixture-openai', AI_MODEL: 'gpt-test' })).toMatchObject({ provider: 'openai', model: 'gpt-test', ready: true });
    const override = resolveVisionConfig({ AI_PROVIDER: 'none', VISION_PROVIDER: 'gemini', GEMINI_API_KEY: 'fixture-gemini', VISION_MODEL: 'gemini-2.0-flash' });
    expect(override).toMatchObject({ provider: 'gemini', model: 'gemini-2.0-flash', ready: true });
    expect(resolveVisionConfig({ AI_PROVIDER: 'none', VISION_PROVIDER: 'gemini' })).toMatchObject({ state: 'missing_key', ready: false });
    const status = getAIStatus({ AI_PROVIDER: 'none', VISION_PROVIDER: 'gemini', GEMINI_API_KEY: 'fixture-gemini' });
    expect(status.vision).toMatchObject({ provider: 'gemini', ready: true, keyConfigured: true });
    expect(JSON.stringify(status)).not.toContain('fixture-gemini');
  });

  it('keeps demo-public and public-research guards aligned for vision providers', () => {
    expect(() => parseConfig({ EXPOSURE_MODE: 'demo-public', DATA_MODE: 'demo', VISION_PROVIDER: 'openai' })).toThrow(/demo/i);
    const base = { EXPOSURE_MODE: 'public-research', DATA_MODE: 'real', MARKET_PROVIDER: 'yahoo', PUBLIC_ORIGIN: 'https://research.example.test', VISION_PROVIDER: 'opencode-go' };
    expect(parseConfig({ ...base, AI_COST_POLICY: 'free-only' }).VISION_PROVIDER).toBe('opencode-go');
    expect(() => parseConfig({ ...base, AI_COST_POLICY: 'operator-approved' })).toThrow(/free-only|unapproved/i);
  });
});

describe('legend tolerance band', () => {
  it('turns the exact printed RSI reading into a deterministic band', () => {
    expect(legendBand(45.76, 6)).toEqual([40, 52]);
    expect(legendBand(0, 6)).toEqual([0, 6]);
    expect(legendBand(98, 6)).toEqual([92, 100]);
  });
});
