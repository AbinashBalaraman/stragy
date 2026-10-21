/**
 * Explicit, single-provider AI adapter.
 *
 * Rules enforced here:
 *  - exactly one provider chosen by AI_PROVIDER (none|gemini|openai|openrouter|deepseek)
 *  - each provider reads only its own key (GEMINI_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, DEEPSEEK_API_KEY)
 *  - fixed, allowlisted HTTPS endpoint per provider (no user supplied URLs, no redirects)
 *  - no cross-provider and no cross-model fallback, no retries
 *  - bounded timeout, output tokens, request body, response size and request count
 *  - nothing here runs at import or startup; the network is only touched inside callProvider()
 *  - the key never appears in status, errors, or enumerable config properties
 */

import { verifyFreeModel } from './freeModel';
export type AIProviderName = 'none' | 'gemini' | 'openai' | 'openrouter' | 'deepseek' | 'tokenrouter';
export const AI_PROVIDERS: readonly AIProviderName[] = ['none', 'gemini', 'openai', 'openrouter', 'deepseek', 'tokenrouter'];

export type AIConfigState = 'disabled' | 'missing_key' | 'missing_model' | 'invalid_model' | 'invalid_provider' | 'ready';

export type FetchLike = (input: string, init?: any) => Promise<any>;
export type EnvLike = Record<string, string | undefined>;

export const AI_LIMITS = {
  defaultTimeoutMs: 20_000,
  minTimeoutMs: 1_000,
  maxTimeoutMs: 60_000,
  defaultOutputTokens: 1_500,
  minOutputTokens: 64,
  maxOutputTokens: 4_000,
  maxRequestBodyBytes: 64 * 1024,
  maxResponseBytes: 256 * 1024,
  defaultRequestsPerHour: 30,
  maxRequestsPerHour: 600,
} as const;

interface ProviderSpec {
  keyEnv: string;
  host: string;
  defaultModel: string | null;
  modelPattern: RegExp;
  url: (model: string) => string;
}

const PROVIDER_SPECS: Record<Exclude<AIProviderName, 'none'>, ProviderSpec> = {
  tokenrouter: {
    keyEnv: 'TOKENROUTER_API_KEY', host: 'api.tokenrouter.com', defaultModel: null,
    modelPattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,95}$/,
    url: () => 'https://api.tokenrouter.com/v1/chat/completions',
  },
  gemini: {
    keyEnv: 'GEMINI_API_KEY',
    host: 'generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.0-flash',
    modelPattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
    url: (m) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`,
  },
  openai: {
    keyEnv: 'OPENAI_API_KEY',
    host: 'api.openai.com',
    defaultModel: 'gpt-4o-mini',
    modelPattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/,
    url: () => 'https://api.openai.com/v1/chat/completions',
  },
  openrouter: {
    keyEnv: 'OPENROUTER_API_KEY',
    host: 'openrouter.ai',
    // No default: OpenRouter routes to many paid/free models, so the operator must choose one.
    defaultModel: null,
    modelPattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,95}$/,
    url: () => 'https://openrouter.ai/api/v1/chat/completions',
  },
  deepseek: {
    keyEnv: 'DEEPSEEK_API_KEY',
    host: 'api.deepseek.com',
    defaultModel: 'deepseek-chat',
    modelPattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
    url: () => 'https://api.deepseek.com/chat/completions',
  },
};

export interface AIRuntimeConfig {
  provider: AIProviderName;
  model: string | null;
  state: AIConfigState;
  /** true only when provider selected AND its own key present AND model valid */
  ready: boolean;
  keyPresent: boolean;
  endpointHost: string | null;
  timeoutMs: number;
  maxOutputTokens: number;
  requestsPerHour: number;
  costPolicy?: 'free-only' | 'operator-approved';
  /** Non-enumerable: never serialised, never logged by JSON.stringify. */
  readonly apiKey?: string;
}

function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function resolveAIConfig(env: EnvLike = process.env): AIRuntimeConfig {
  const rawProvider = (env.AI_PROVIDER ?? 'none').trim().toLowerCase() || 'none';
  const timeoutMs = clampInt(env.AI_TIMEOUT_MS, AI_LIMITS.defaultTimeoutMs, AI_LIMITS.minTimeoutMs, AI_LIMITS.maxTimeoutMs);
  const maxOutputTokens = clampInt(env.AI_MAX_OUTPUT_TOKENS, AI_LIMITS.defaultOutputTokens, AI_LIMITS.minOutputTokens, AI_LIMITS.maxOutputTokens);
  const requestsPerHour = clampInt(env.AI_MAX_REQUESTS_PER_HOUR, AI_LIMITS.defaultRequestsPerHour, 1, AI_LIMITS.maxRequestsPerHour);

  const build = (provider: AIProviderName, model: string | null, state: AIConfigState, key?: string, host: string | null = null): AIRuntimeConfig => {
    const cfg: AIRuntimeConfig = {
      provider, model, state,
      ready: state === 'ready',
      keyPresent: Boolean(key),
      endpointHost: host,
      timeoutMs, maxOutputTokens, requestsPerHour,
      costPolicy: env.AI_COST_POLICY === 'free-only' ? 'free-only' : 'operator-approved',
    };
    if (key && state === 'ready') Object.defineProperty(cfg, 'apiKey', { value: key, enumerable: false });
    return cfg;
  };

  if (!(AI_PROVIDERS as readonly string[]).includes(rawProvider)) return build('none', null, 'invalid_provider');
  if (rawProvider === 'none') return build('none', null, 'disabled');

  const provider = rawProvider as Exclude<AIProviderName, 'none'>;
  const spec = PROVIDER_SPECS[provider];
  // Only this provider's own key is consulted. Other providers' keys are never read.
  const key = (env[spec.keyEnv] ?? '').trim();
  if (provider === 'tokenrouter' && env.TOKENROUTER_BASE_URL && env.TOKENROUTER_BASE_URL.replace(/\/$/, '') !== 'https://api.tokenrouter.com/v1') return build(provider, null, 'invalid_provider');
  const requestedModel = (env.AI_MODEL ?? (provider === 'tokenrouter' ? env.TOKENROUTER_MODEL : '') ?? '').trim();
  const model = requestedModel || spec.defaultModel;

  if (!key) return build(provider, model, 'missing_key', undefined, spec.host);
  if (!model) return build(provider, null, 'missing_model', key, spec.host);
  if (!spec.modelPattern.test(model)) return build(provider, null, 'invalid_model', key, spec.host);
  return build(provider, model, 'ready', key, spec.host);
}

export type ProviderErrorCode =
  | 'not_configured' | 'budget_exceeded' | 'request_too_large' | 'timeout' | 'network_error'
  | 'http_error' | 'response_too_large' | 'invalid_response' | 'empty_response' | 'refusal' | 'cost_not_approved';

export interface ProviderCallSuccess { ok: true; text: string; provider: AIProviderName; model: string }
export interface ProviderCallFailure { ok: false; code: ProviderErrorCode; message: string; status?: number }
export type ProviderCallResult = ProviderCallSuccess | ProviderCallFailure;

export interface ProviderRequest {
  system: string;
  /** Single user message containing JSON-encoded untrusted data. */
  user: string;
  json: boolean;
}

/** Rolling-window request budget. Injectable for tests. */
export interface RequestBudget { tryConsume(limit: number): boolean }
export function createRequestBudget(now: () => number = Date.now, windowMs = 3_600_000): RequestBudget {
  const stamps: number[] = [];
  return {
    tryConsume(limit: number) {
      const t = now();
      while (stamps.length && t - stamps[0] >= windowMs) stamps.shift();
      if (stamps.length >= limit) return false;
      stamps.push(t);
      return true;
    },
  };
}
const defaultBudget = createRequestBudget();

export interface ProviderDeps {
  fetch?: FetchLike;
  budget?: RequestBudget;
}

function fail(code: ProviderErrorCode, message: string, status?: number): ProviderCallFailure {
  return { ok: false, code, message, ...(status !== undefined ? { status } : {}) };
}

export function buildProviderPayload(cfg: AIRuntimeConfig, req: ProviderRequest): { url: string; headers: Record<string, string>; body: string } {
  if (!cfg.ready || cfg.provider === 'none' || !cfg.model || !cfg.apiKey) throw new Error('AI provider is not ready');
  const spec = PROVIDER_SPECS[cfg.provider];
  const url = spec.url(cfg.model);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  let payload: unknown;
  if (cfg.provider === 'gemini') {
    headers['x-goog-api-key'] = cfg.apiKey;
    payload = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: {
        maxOutputTokens: cfg.maxOutputTokens,
        temperature: 0.2,
        ...(req.json ? { responseMimeType: 'application/json' } : {}),
      },
    };
  } else {
    headers.Authorization = `Bearer ${cfg.apiKey}`;
    payload = {
      model: cfg.model,
      messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
      temperature: 0.2,
      ...(cfg.provider === 'openai' ? { max_completion_tokens: cfg.maxOutputTokens } : { max_tokens: cfg.maxOutputTokens }),
      ...(req.json ? { response_format: { type: 'json_object' } } : {}),
    };
  }
  return { url, headers, body: JSON.stringify(payload) };
}

function extractText(provider: AIProviderName, data: any): ProviderCallFailure | { text: string } {
  if (!data || typeof data !== 'object') return fail('invalid_response', 'Provider response was not an object.');
  if (provider === 'gemini') {
    if (data.promptFeedback?.blockReason) return fail('refusal', 'Provider declined the request.');
    const cand = data.candidates?.[0];
    if (!cand) return fail('empty_response', 'Provider returned no candidates.');
    if (cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT' || cand.finishReason === 'RECITATION') {
      return fail('refusal', 'Provider declined the request.');
    }
    const text = (cand.content?.parts ?? []).map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
    return text.trim() ? { text } : fail('empty_response', 'Provider returned empty text.');
  }
  const choice = data.choices?.[0];
  if (!choice) return fail('empty_response', 'Provider returned no choices.');
  if (choice.message?.refusal || choice.finish_reason === 'content_filter') return fail('refusal', 'Provider declined the request.');
  const content = choice.message?.content;
  if (typeof content !== 'string') return fail('invalid_response', 'Provider message content was not text.');
  return content.trim() ? { text: content } : fail('empty_response', 'Provider returned empty text.');
}

/**
 * Perform exactly one request to the configured provider. Never retries, never tries another
 * provider or model. All failures are returned as values with key-free messages.
 */
export async function callProvider(cfg: AIRuntimeConfig, req: ProviderRequest, deps: ProviderDeps = {}): Promise<ProviderCallResult> {
  if (!cfg.ready || cfg.provider === 'none' || !cfg.model) return fail('not_configured', 'External AI is not configured.');
  const fetchImpl: FetchLike | undefined = deps.fetch ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) return fail('network_error', 'No fetch implementation available.');

  let built;
  try { built = buildProviderPayload(cfg, req); } catch { return fail('not_configured', 'External AI is not configured.'); }
  if (Buffer.byteLength(built.body, 'utf8') > AI_LIMITS.maxRequestBodyBytes) return fail('request_too_large', 'AI request exceeds the size limit.');
  const host = new URL(built.url).host;
  if (host !== PROVIDER_SPECS[cfg.provider].host) return fail('not_configured', 'Endpoint is not allowlisted.');

  if (!(deps.budget ?? defaultBudget).tryConsume(cfg.requestsPerHour)) return fail('budget_exceeded', 'AI request budget exhausted for this period.');

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ProviderCallFailure>((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(fail('timeout', `AI request timed out after ${cfg.timeoutMs} ms.`)); }, cfg.timeoutMs);
  });

  const work = (async (): Promise<ProviderCallResult> => {
    if (cfg.costPolicy === 'free-only' && (cfg.provider !== 'tokenrouter' || !await verifyFreeModel(fetchImpl, cfg.model!, controller.signal))) return fail('cost_not_approved', 'No AI request was sent: the selected model could not be verified as zero-priced. Paid usage and paid fallbacks are disabled.');
    if (controller.signal.aborted) return fail('timeout', 'AI pricing verification timed out. No completion was requested.');
    let res: any;
    try {
      res = await fetchImpl(built.url, { method: 'POST', headers: built.headers, body: built.body, signal: controller.signal, redirect: 'error' });
    } catch (e: any) {
      if (e?.name === 'AbortError') return fail('timeout', `AI request timed out after ${cfg.timeoutMs} ms.`);
      return fail('network_error', 'Could not reach the AI provider.');
    }
    if (!res || typeof res.status !== 'number' && res.ok === undefined) return fail('invalid_response', 'Malformed provider response.');
    if (!res.ok) {
      try { await res.body?.cancel?.(); } catch { /* best-effort release */ }
      return fail('http_error', res.status === 403 ? 'AI provider refused access (HTTP 403). Check the configured key\'s model permissions. No alternate or paid model was used.' : `AI provider returned HTTP ${res.status ?? 'error'}.`, res.status);
    }
    let raw: string;
    try {
      const len = Number(res.headers?.get?.('content-length'));
      if (Number.isFinite(len) && len > AI_LIMITS.maxResponseBytes) return fail('response_too_large', 'AI response exceeds the size limit.');
      if (res.body?.getReader) {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > AI_LIMITS.maxResponseBytes) {
            await reader.cancel();
            controller.abort();
            return fail('response_too_large', 'AI response exceeds the size limit.');
          }
          chunks.push(chunk.value);
        }
        raw = Buffer.concat(chunks).toString('utf8');
      } else {
        // Small fixture response objects can implement text()/json() without a stream.
        raw = typeof res.text === 'function' ? await res.text() : JSON.stringify(await res.json());
      }
    } catch {
      return fail('invalid_response', 'Could not read provider response.');
    }
    if (Buffer.byteLength(raw, 'utf8') > AI_LIMITS.maxResponseBytes) return fail('response_too_large', 'AI response exceeds the size limit.');
    let data: any;
    try { data = JSON.parse(raw); } catch { return fail('invalid_response', 'Provider response was not JSON.'); }
    const extracted = extractText(cfg.provider, data);
    if ('ok' in extracted) return extracted;
    return { ok: true, text: extracted.text, provider: cfg.provider, model: cfg.model! };
  })();

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
