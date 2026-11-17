import { describe, it, expect } from 'vitest';
import { resolveAIConfig, callProvider, createRequestBudget, OPENCODE_GO_FREE_MODELS, isOpenCodeGoFreeModel, resetLastProviderCall } from '../../server/ai/provider';
import { getAIStatus } from '../../server/ai/copilot';
import { parseConfig } from '../../server/config';
import { fakeResponse, openAIBody, recordingFetch } from '../../server/ai/testFixtures';

const SECRET_A = 'secret-gemini-AAAA1111';
const SECRET_B = 'secret-openai-BBBB2222';
const SECRET_C = 'secret-openrouter-CCCC3333';
const SECRET_D = 'secret-deepseek-DDDD4444';
const SECRET_E = 'secret-opencode-EEEE5555';
const ALL_KEYS = { GEMINI_API_KEY: SECRET_A, OPENAI_API_KEY: SECRET_B, OPENROUTER_API_KEY: SECRET_C, DEEPSEEK_API_KEY: SECRET_D, OPENCODE_API_KEY: SECRET_E };
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
    ['opencode-go', 'opencode.ai', 'authorization', SECRET_E],
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
    expect(f.calls[0].init.redirect).toBe('manual');
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

  it('accepts content arrays and applies a bounded output-token override for vision', async () => {
    const cfg = resolveAIConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: SECRET_B, AI_MODEL: 'gpt-test', AI_MAX_OUTPUT_TOKENS: '500' });
    const f = recordingFetch(() => fakeResponse({ body: { choices: [{ message: { content: [{ type: 'text', text: '{"ok":true}' }] }, finish_reason: 'stop' }] } }));
    const r = await callProvider(cfg, { ...req, maxOutputTokens: 4000, reasoningEffort: 'low' }, { fetch: f, budget: createRequestBudget() });
    expect(r).toMatchObject({ ok: true, text: '{"ok":true}' });
    const body = JSON.parse(f.calls[0].init.body);
    expect(body.max_completion_tokens).toBe(4000);
    expect(body.reasoning_effort).toBe('low');
  });

  it('bounds timeout and tokens from env', () => {
    const c = resolveAIConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: SECRET_B, AI_TIMEOUT_MS: '9999999', AI_MAX_OUTPUT_TOKENS: '99999999' });
    expect(c.timeoutMs).toBeLessThanOrEqual(60_000);
    expect(c.maxOutputTokens).toBeLessThanOrEqual(12_000);
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

describe('OpenCode Go provider', () => {
  const GO_ENV = { AI_PROVIDER: 'opencode-go', OPENCODE_API_KEY: SECRET_E };

  it('is a first-class config provider with hy4-flash-free as the default model', () => {
    expect(parseConfig({ AI_PROVIDER: 'opencode-go' }).AI_PROVIDER).toBe('opencode-go');
    expect(resolveAIConfig({ AI_PROVIDER: 'opencode-go' })).toMatchObject({ provider: 'opencode-go', state: 'missing_key', keyPresent: false, model: 'hy4-flash-free' });
    expect(resolveAIConfig(GO_ENV)).toMatchObject({ provider: 'opencode-go', model: 'hy4-flash-free', ready: true, endpointHost: 'opencode.ai' });
    expect(resolveAIConfig(GO_ENV).fallbackModels).toEqual(['openrouter:openrouter/free', 'opencode-go:deepseek-v4.1-flash']);
    expect(resolveAIConfig({ ...GO_ENV, AI_MODEL: 'Beam-Free' }).state).toBe('invalid_model');
    expect(JSON.stringify(resolveAIConfig(GO_ENV))).not.toContain(SECRET_E);
  });

  it('sends Bearer auth, its own User-Agent and one stable session id per process', async () => {
    const cfg = resolveAIConfig(GO_ENV);
    const f = recordingFetch(() => fakeResponse({ body: openAIBody('{}') }));
    expect((await callProvider(cfg, req, { fetch: f, budget: createRequestBudget() })).ok).toBe(true);
    expect((await callProvider(cfg, req, { fetch: f, budget: createRequestBudget() })).ok).toBe(true);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0].url).toBe('https://opencode.ai/inference/go/openai/v1/chat/completions');
    expect(new URL(f.calls[0].url).host).toBe('opencode.ai');
    const headers = f.calls.map(call => Object.fromEntries(Object.entries(call.init.headers).map(([k, v]) => [k.toLowerCase(), String(v)])));
    expect(headers[0].authorization).toBe('Bearer ' + SECRET_E);
    expect(headers[0]['user-agent']).toBe('stragy-research/2.0');
    expect(headers[0]['x-opencode-session']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(headers[1]['x-opencode-session']).toBe(headers[0]['x-opencode-session']);
    const payload = JSON.parse(f.calls[0].init.body);
    expect(payload).toMatchObject({ model: 'hy4-flash-free', temperature: 0.2, max_tokens: 1500, response_format: { type: 'json_object' } });
    expect(payload.messages).toHaveLength(2);
    expect(f.calls[0].init.redirect).toBe('manual');
  });

  it('prefers a caller-supplied conversation id for the session header', async () => {
    const cfg = resolveAIConfig(GO_ENV);
    const f = recordingFetch(() => fakeResponse({ body: openAIBody('{}') }));
    await callProvider(cfg, req, { fetch: f, budget: createRequestBudget(), sessionId: 'conversation-fixture-7' });
    const headers = Object.fromEntries(Object.entries(f.calls[0].init.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    expect(headers['x-opencode-session']).toBe('conversation-fixture-7');
  });

  it('allows exactly the static $0 models under free-only without any pricing fetch', async () => {
    for (const model of OPENCODE_GO_FREE_MODELS) {
      const cfg = resolveAIConfig({ ...GO_ENV, AI_MODEL: model, AI_COST_POLICY: 'free-only' });
      const f = recordingFetch(() => fakeResponse({ body: openAIBody('{}') }));
      const r = await callProvider(cfg, req, { fetch: f, budget: createRequestBudget() });
      expect([model, r.ok]).toEqual([model, true]);
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0].url).toBe('https://opencode.ai/inference/go/openai/v1/chat/completions');
      expect(f.calls[0].url).not.toContain('tokenrouter');
    }
  });

  it('rejects a subscription model under free-only before any request and allows it when operator-approved', async () => {
    const free = resolveAIConfig({ ...GO_ENV, AI_MODEL: 'deepseek-v4.1-flash', AI_COST_POLICY: 'free-only' });
    const blocked = recordingFetch(() => fakeResponse({ body: openAIBody('{}') }));
    expect(await callProvider(free, req, { fetch: blocked, budget: createRequestBudget() })).toMatchObject({ ok: false, code: 'cost_not_approved' });
    expect(blocked.calls).toHaveLength(0);

    const approved = resolveAIConfig({ ...GO_ENV, AI_MODEL: 'deepseek-v4.1-flash', AI_COST_POLICY: 'operator-approved' });
    const allowed = recordingFetch(() => fakeResponse({ body: openAIBody('{}') }));
    expect(await callProvider(approved, req, { fetch: allowed, budget: createRequestBudget() })).toMatchObject({ ok: true, provider: 'opencode-go', model: 'deepseek-v4.1-flash' });
    expect(allowed.calls).toHaveLength(1);
  });

  it('accepts hy4-flash-free as a zero-priced primary without a pricing fetch', async () => {
    expect(OPENCODE_GO_FREE_MODELS).toContain('hy4-flash-free');
    expect(isOpenCodeGoFreeModel('hy4-flash-free')).toBe(true);
    const cfg = resolveAIConfig({ ...GO_ENV, AI_MODEL: 'hy4-flash-free', AI_COST_POLICY: 'free-only' });
    const f = recordingFetch(() => fakeResponse({ body: openAIBody('Hy4 answer') }));
    const r = await callProvider(cfg, req, { fetch: f, budget: createRequestBudget() });
    expect(r).toMatchObject({ ok: true, model: 'hy4-flash-free', text: 'Hy4 answer' });
    expect(f.calls).toHaveLength(1);
  });

  it('falls back hy4 -> longcat after a 403 without retrying the refused model', async () => {
    const cfg = resolveAIConfig({ ...GO_ENV, AI_MODEL: 'hy4-flash-free', AI_FALLBACK_MODELS: 'opencode-go:longcat-2.5-free,opencode-go:beam-free', AI_COST_POLICY: 'free-only' });
    const responses = [
      { ok: false, status: 403, headers: { get: () => null }, text: async () => '{}' },
      fakeResponse({ body: openAIBody('Longcat answer') }),
    ];
    const f = recordingFetch(() => responses.shift());
    const r = await callProvider(cfg, req, { fetch: f, budget: createRequestBudget(), sleep: async () => {} });
    expect(r).toMatchObject({ ok: true, model: 'longcat-2.5-free', text: 'Longcat answer' });
    expect(f.calls).toHaveLength(2);
    expect(JSON.parse(f.calls[1].init.body).model).toBe('longcat-2.5-free');
  });

  it('treats finish_reason=length with no content as retryable and moves to the fallback', async () => {
    const cfg = resolveAIConfig({ ...GO_ENV, AI_MODEL: 'hy4-flash-free', AI_FALLBACK_MODELS: 'opencode-go:longcat-2.5-free', AI_COST_POLICY: 'free-only' });
    const limited = { choices: [{ message: { content: '' }, finish_reason: 'length' }] };
    const responses = [fakeResponse({ body: limited }), fakeResponse({ body: openAIBody('Fallback answer after length') })];
    const f = recordingFetch(() => responses.shift());
    const r = await callProvider(cfg, req, { fetch: f, budget: createRequestBudget(), sleep: async () => {} });
    expect(r).toMatchObject({ ok: true, model: 'longcat-2.5-free', text: 'Fallback answer after length' });
    expect(f.calls).toHaveLength(2);
  });

  it('moves to the fallback when reasoning arrives without answer content', async () => {
    const cfg = resolveAIConfig({ ...GO_ENV, AI_MODEL: 'hy4-flash-free', AI_FALLBACK_MODELS: 'opencode-go:longcat-2.5-free', AI_COST_POLICY: 'free-only' });
    const reasoningOnly = { choices: [{ message: { content: '', reasoning_content: 'internal reasoning only' }, finish_reason: 'stop' }] };
    const responses = [fakeResponse({ body: reasoningOnly }), fakeResponse({ body: openAIBody('Fallback answer') })];
    const f = recordingFetch(() => responses.shift());
    const r = await callProvider(cfg, req, { fetch: f, budget: createRequestBudget(), sleep: async () => {} });
    expect(r).toMatchObject({ ok: true, model: 'longcat-2.5-free', text: 'Fallback answer' });
    expect(f.calls).toHaveLength(2);
  });

  it('keeps public-research on free-only AI when Go is selected', () => {
    const base = { EXPOSURE_MODE: 'public-research', DATA_MODE: 'real', MARKET_PROVIDER: 'yahoo', PUBLIC_ORIGIN: 'https://research.example.test', AI_PROVIDER: 'opencode-go' };
    expect(parseConfig({ ...base, AI_COST_POLICY: 'free-only' }).AI_PROVIDER).toBe('opencode-go');
    expect(() => parseConfig({ ...base, AI_COST_POLICY: 'operator-approved' })).toThrow(/free-only|unapproved/i);
  });

  it('lists selectable Go models in status without leaking the key', () => {
    const s = getAIStatus(GO_ENV);
    expect(s.opencodeGoStatus).toBe('CONFIGURED_UNVERIFIED');
    expect(s.opencodeGoModels).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'hy4-flash-free', free: true }),
      expect.objectContaining({ id: 'beam-free', free: true }),
      expect.objectContaining({ id: 'longcat-2.5-free', free: true }),
      expect.objectContaining({ id: 'deepseek-v4.1-flash', free: false }),
    ]));
    expect(s.opencodeGoModels.find(m => m.id === 'hy4-flash-free')!.note).toMatch(/text and chart vision verified/i);
    expect(s.opencodeGoModels.find(m => m.id === 'longcat-2.5-free')!.note).toMatch(/China/i);
    expect(s.opencodeGoModels.find(m => m.id === 'iceman-contributor-free')).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain(SECRET_E);
    expect(JSON.stringify(s)).not.toContain('OPENCODE_API_KEY');
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

describe('D01 rate-limit retry, fallback models and last-call status', () => {
  const providerCfg = (env: Record<string, string | undefined> = {}) => resolveAIConfig({
    AI_PROVIDER: 'openai', OPENAI_API_KEY: SECRET_B, AI_MODEL: 'gpt-test', AI_TIMEOUT_MS: '1000', ...env,
  });
  const httpFailure = (status: number, retryAfter?: string) => ({
    ok: false, status,
    headers: { get: (name: string) => name.toLowerCase() === 'retry-after' && retryAfter !== undefined ? retryAfter : null },
    text: async () => '{}',
    json: async () => ({}),
  });

  it('retries a 429 once after Retry-After, capped at five seconds', async () => {
    const env = { AI_PROVIDER: 'openai', OPENAI_API_KEY: SECRET_B, AI_MODEL: 'gpt-test' };
    resetLastProviderCall();
    const responses = [httpFailure(429, '2'), fakeResponse({ body: openAIBody('after wait') })];
    const f = recordingFetch(() => responses.shift());
    let slept = 0;
    const r = await callProvider(providerCfg(), req, { fetch: f, budget: createRequestBudget(), sleep: async ms => { slept = ms; } });
    expect(r).toMatchObject({ ok: true, text: 'after wait', model: 'gpt-test' });
    expect(f.calls).toHaveLength(2);
    expect(slept).toBe(2_000);
    expect(getAIStatus(env).lastCall).toMatchObject({ ok: true, provider: 'openai', model: 'gpt-test' });

    resetLastProviderCall();
    const capped = [httpFailure(429, '99'), fakeResponse({ body: openAIBody('capped') })];
    const f2 = recordingFetch(() => capped.shift());
    let cappedSleep = 0;
    await callProvider(providerCfg(), req, { fetch: f2, budget: createRequestBudget(), sleep: async ms => { cappedSleep = ms; } });
    expect(cappedSleep).toBe(5_000);
  });

  it('tries cost-approved fallback models in order on 403 and labels the model that answered', async () => {
    const cfg = providerCfg({ AI_FALLBACK_MODELS: 'openai:gpt-fallback-a,openai:gpt-fallback-b', AI_COST_POLICY: 'operator-approved' });
    expect(cfg.fallbackModels).toEqual(['openai:gpt-fallback-a', 'openai:gpt-fallback-b']);
    resetLastProviderCall();
    const responses = [httpFailure(403), httpFailure(403), fakeResponse({ body: openAIBody('fallback answer') })];
    const f = recordingFetch(() => responses.shift());
    const r = await callProvider(cfg, req, { fetch: f, budget: createRequestBudget(), sleep: async () => {} });
    expect(r).toMatchObject({ ok: true, text: 'fallback answer', model: 'gpt-fallback-b' });
    expect(f.calls).toHaveLength(3);
    expect(getAIStatus({ AI_PROVIDER: 'openai', OPENAI_API_KEY: SECRET_B, AI_MODEL: 'gpt-test' }).lastCall).toMatchObject({ ok: true, model: 'gpt-fallback-b' });
  });

  it('tries an approved paid fallback for a vision request even when the catalog marks it text-only', async () => {
    const cfg = resolveAIConfig({
      AI_PROVIDER: 'opencode-go', OPENCODE_API_KEY: SECRET_E, AI_MODEL: 'hy4-flash-free',
      AI_COST_POLICY: 'free-only', AI_APPROVED_PAID_MODELS: 'opencode-go:deepseek-v4.1-flash',
      AI_FALLBACK_MODELS: 'opencode-go:deepseek-v4.1-flash',
    });
    expect(cfg.fallbackTargets?.[0]).toMatchObject({ label: 'opencode-go:deepseek-v4.1-flash', approvedPaid: true, supportsImages: false, status: 'ready' });
    const f = recordingFetch((_url, init) => {
      const body = JSON.parse(init.body);
      return body.model === 'hy4-flash-free'
        ? { ok: false, status: 403, headers: { get: () => null }, text: async () => '{}' }
        : fakeResponse({ body: openAIBody('paid vision answer') });
    });
    const r = await callProvider(cfg, {
      system: 'read', user: '{"hint":null}', json: true, images: ['data:image/png;base64,AAAA'],
    }, { fetch: f, budget: createRequestBudget() });
    expect(r).toMatchObject({ ok: true, provider: 'opencode-go', model: 'deepseek-v4.1-flash', text: 'paid vision answer' });
    expect(f.calls).toHaveLength(2);
  });

  it('keeps free targets ready, paid targets blocked unless approved, and lists missing keys', () => {
    const go = resolveAIConfig({ AI_PROVIDER: 'opencode-go', OPENCODE_API_KEY: SECRET_E, AI_MODEL: 'hy4-flash-free', AI_COST_POLICY: 'free-only', AI_FALLBACK_MODELS: 'opencode-go:beam-free,opencode-go:deepseek-v4.1-flash,openrouter:openrouter/free' });
    expect(go.fallbackModels).toEqual(['opencode-go:beam-free', 'opencode-go:deepseek-v4.1-flash', 'openrouter:openrouter/free']);
    expect(go.fallbackTargets?.map(target => [target.label, target.status])).toEqual([
      ['opencode-go:beam-free', 'ready'],
      ['opencode-go:deepseek-v4.1-flash', 'blocked_paid'],
      ['openrouter:openrouter/free', 'not_configured'],
    ]);
    const approved = resolveAIConfig({ AI_PROVIDER: 'opencode-go', OPENCODE_API_KEY: SECRET_E, AI_MODEL: 'hy4-flash-free', AI_COST_POLICY: 'free-only', AI_APPROVED_PAID_MODELS: 'opencode-go:deepseek-v4.1-flash', AI_FALLBACK_MODELS: 'opencode-go:deepseek-v4.1-flash' });
    expect(approved.fallbackTargets?.[0]).toMatchObject({ label: 'opencode-go:deepseek-v4.1-flash', status: 'ready', approvedPaid: true });
    expect(approved.fallbackTargets?.[0].config?.approvedPaid).toBe(true);
  });

  it('reports a degraded capability state after the last call fails', async () => {
    resetLastProviderCall();
    const env = { AI_PROVIDER: 'openai', OPENAI_API_KEY: SECRET_B, AI_MODEL: 'gpt-test' };
    const f = recordingFetch(() => httpFailure(500));
    await callProvider(providerCfg(), req, { fetch: f, budget: createRequestBudget() });
    const status = getAIStatus(env);
    expect(status.state).toBe('degraded');
    expect(status.stateMessage).toMatch(/last request failed/i);
    expect(status.lastCall).toMatchObject({ ok: false, code: 'http_error', status: 500 });
    resetLastProviderCall();
    expect(getAIStatus(env).state).toBe('ready');
  });
});


