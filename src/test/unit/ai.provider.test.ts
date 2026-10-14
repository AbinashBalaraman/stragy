import { describe, it, expect } from 'vitest';
import { resolveAIConfig, callProvider, createRequestBudget } from '../../server/ai/provider';
import { getAIStatus } from '../../server/ai/copilot';
import { fakeResponse, openAIBody, recordingFetch } from '../../server/ai/testFixtures';

const SECRET_A = 'secret-gemini-AAAA1111';
const SECRET_B = 'secret-openai-BBBB2222';
const SECRET_C = 'secret-openrouter-CCCC3333';
const SECRET_D = 'secret-deepseek-DDDD4444';
const ALL_KEYS = { GEMINI_API_KEY: SECRET_A, OPENAI_API_KEY: SECRET_B, OPENROUTER_API_KEY: SECRET_C, DEEPSEEK_API_KEY: SECRET_D };
const req = { system: 's', user: '{"x":1}', json: true };

describe('AI provider config isolation', () => {
  it('defaults to disabled with no provider contact', () => {
    const c = resolveAIConfig({});
    expect(c.provider).toBe('none');
    expect(c.ready).toBe(false);
    expect(c.state).toBe('disabled');
  });

  it('missing own key disables even when other providers have keys', () => {
    const c = resolveAIConfig({ AI_PROVIDER: 'openai', GEMINI_API_KEY: SECRET_A, OPENROUTER_API_KEY: SECRET_C, DEEPSEEK_API_KEY: SECRET_D });
    expect(c.ready).toBe(false);
    expect(c.state).toBe('missing_key');
    expect(c.keyPresent).toBe(false);
  });

  it.each([
    ['gemini', 'generativelanguage.googleapis.com', 'x-goog-api-key', SECRET_A],
    ['openai', 'api.openai.com', 'authorization', SECRET_B],
    ['deepseek', 'api.deepseek.com', 'authorization', SECRET_D],
    ['openrouter', 'openrouter.ai', 'authorization', SECRET_C],
  ])('%s sends only its own key to its own host', async (provider, host, header, expected) => {
    const cfg = resolveAIConfig({ ...ALL_KEYS, AI_PROVIDER: provider, AI_MODEL: 'some-model' });
    expect(cfg.ready).toBe(true);
    const f = recordingFetch(() => fakeResponse({ body: provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: '{}' }] } }] } : openAIBody('{}') }));
    const r = await callProvider(cfg, req, { fetch: f, budget: createRequestBudget() });
    expect(r.ok).toBe(true);
    expect(f.calls).toHaveLength(1);
    expect(new URL(f.calls[0].url).host).toBe(host);
    const headers = Object.fromEntries(Object.entries(f.calls[0].init.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    expect(headers[header]).toContain(expected);
    for (const other of Object.values(ALL_KEYS).filter((k) => k !== expected)) {
      expect(JSON.stringify(f.calls[0])).not.toContain(other);
    }
    expect(f.calls[0].init.redirect).toBe('error');
  });

  it('openrouter requires an explicit model and rejects unsafe model names', () => {
    expect(resolveAIConfig({ AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: SECRET_C }).state).toBe('missing_model');
    expect(resolveAIConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: SECRET_B, AI_MODEL: 'x/../../evil?y=1' }).state).toBe('invalid_model');
    expect(resolveAIConfig({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: SECRET_A, AI_MODEL: 'a/b' }).state).toBe('invalid_model');
  });

  it('unknown provider value is disabled, not coerced', () => {
    const c = resolveAIConfig({ AI_PROVIDER: 'anthropic', OPENAI_API_KEY: SECRET_B });
    expect(c.ready).toBe(false);
    expect(c.state).toBe('invalid_provider');
  });

  it('bounds timeout and tokens from env', () => {
    const c = resolveAIConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: SECRET_B, AI_TIMEOUT_MS: '9999999', AI_MAX_OUTPUT_TOKENS: '99999999' });
    expect(c.timeoutMs).toBeLessThanOrEqual(60_000);
    expect(c.maxOutputTokens).toBeLessThanOrEqual(4_000);
  });
});

describe('callProvider failure handling (single attempt, no fallback)', () => {
  const cfg = () => resolveAIConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: SECRET_B, AI_MODEL: 'gpt-test', AI_TIMEOUT_MS: '1000' });

  it('not_configured makes no request', async () => {
    const f = recordingFetch(() => fakeResponse({}));
    const r = await callProvider(resolveAIConfig({}), req, { fetch: f });
    expect(r).toMatchObject({ ok: false, code: 'not_configured' });
    expect(f.calls).toHaveLength(0);
  });

  it('HTTP error is returned once, never retried, never leaks key', async () => {
    const f = recordingFetch(() => fakeResponse({ status: 500, raw: `boom ${SECRET_B}` }));
    const r = await callProvider(cfg(), req, { fetch: f, budget: createRequestBudget() });
    expect(r).toMatchObject({ ok: false, code: 'http_error', status: 500 });
    expect(JSON.stringify(r)).not.toContain(SECRET_B);
    expect(f.calls).toHaveLength(1);
  });

  it('times out even if fetch ignores the abort signal', async () => {
    const f = recordingFetch(() => new Promise(() => {}));
    const r = await callProvider(cfg(), req, { fetch: f, budget: createRequestBudget() });
    expect(r).toMatchObject({ ok: false, code: 'timeout' });
  }, 5000);

  it('network error message does not echo the underlying error', async () => {
    const f = recordingFetch(() => { throw new Error(`connect failed with ${SECRET_B}`); });
    const r = await callProvider(cfg(), req, { fetch: f, budget: createRequestBudget() });
    expect(r).toMatchObject({ ok: false, code: 'network_error' });
    expect(JSON.stringify(r)).not.toContain(SECRET_B);
  });

  it('detects refusal and empty content', async () => {
    const refusal = recordingFetch(() => fakeResponse({ body: { choices: [{ message: { content: null, refusal: 'no' } }] } }));
    expect(await callProvider(cfg(), req, { fetch: refusal, budget: createRequestBudget() })).toMatchObject({ code: 'refusal' });
    const empty = recordingFetch(() => fakeResponse({ body: openAIBody('   ') }));
    expect(await callProvider(cfg(), req, { fetch: empty, budget: createRequestBudget() })).toMatchObject({ code: 'empty_response' });
  });

  it('rejects oversized responses and oversized requests', async () => {
    const big = recordingFetch(() => fakeResponse({ raw: 'x'.repeat(300_000) }));
    expect(await callProvider(cfg(), req, { fetch: big, budget: createRequestBudget() })).toMatchObject({ code: 'response_too_large' });
    const f = recordingFetch(() => fakeResponse({}));
    const r = await callProvider(cfg(), { ...req, user: 'y'.repeat(70_000) }, { fetch: f, budget: createRequestBudget() });
    expect(r).toMatchObject({ code: 'request_too_large' });
    expect(f.calls).toHaveLength(0);
  });

  it('enforces the request budget without calling fetch', async () => {
    const c = resolveAIConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: SECRET_B, AI_MODEL: 'gpt-test', AI_MAX_REQUESTS_PER_HOUR: '1' });
    const f = recordingFetch(() => fakeResponse({ body: openAIBody('{}') }));
    const budget = createRequestBudget();
    expect((await callProvider(c, req, { fetch: f, budget })).ok).toBe(true);
    expect(await callProvider(c, req, { fetch: f, budget })).toMatchObject({ code: 'budget_exceeded' });
    expect(f.calls).toHaveLength(1);
  });
});

describe('getAIStatus', () => {
  it('never contains secrets and never claims a verified connection', () => {
    const s = getAIStatus({ ...ALL_KEYS, AI_PROVIDER: 'openai', AI_MODEL: 'gpt-test' });
    const text = JSON.stringify(s);
    for (const k of Object.values(ALL_KEYS)) expect(text).not.toContain(k);
    expect(s.connectionVerified).toBe(false);
    expect(s.externalAiEnabled).toBe(true);
    expect(s.openaiStatus).toBe('CONFIGURED_UNVERIFIED');
    expect(s.geminiStatus).toBe('NOT_SELECTED');
    expect(s.deepseekStatus).toBe('NOT_SELECTED');
  });

  it('exact shape when disabled', () => {
    const s = getAIStatus({});
    expect(s).toMatchObject({ provider: 'none', model: null, state: 'disabled', externalAiEnabled: false, keyConfigured: false, connectionVerified: false, activeProvider: 'local_heuristic' });
    expect(s.localHeuristic).toEqual({ available: true, label: 'local_heuristic', isAI: false });
  });

  it('missing key reports not configured, not connected', () => {
    const s = getAIStatus({ AI_PROVIDER: 'gemini' });
    expect(s.externalAiEnabled).toBe(false);
    expect(s.geminiStatus).toBe('NOT_CONFIGURED');
    expect(s.activeProvider).toBe('local_heuristic');
  });

  it('does no network I/O (global fetch is denied by test setup)', () => {
    expect(() => getAIStatus({ AI_PROVIDER: 'openai', OPENAI_API_KEY: SECRET_B })).not.toThrow();
  });
});
