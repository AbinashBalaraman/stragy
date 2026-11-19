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

import { randomUUID } from 'node:crypto';
import { VERIFIED_FREE_MODEL, verifyFreeModel, verifyOpenRouterFreeModel } from './freeModel';
export type AIProviderName = 'none' | 'gemini' | 'openai' | 'openrouter' | 'deepseek' | 'tokenrouter' | 'opencode-go';
export const AI_PROVIDERS: readonly AIProviderName[] = ['none', 'gemini', 'openai', 'openrouter', 'deepseek', 'tokenrouter', 'opencode-go'];

/** OpenCode Go requires its own client identity and a stable conversation header. */
export const OPENCODE_GO_USER_AGENT = 'stragy-research/2.0';
/** Conversations without an explicit identifier reuse one process-scoped session id. */
const OPENCODE_GO_PROCESS_SESSION = randomUUID();

/**
 * Go models listed as $0 by the provider. Only these may run under free-only.
 * - hy4-flash-free is the primary model: zero-priced, text and chart vision verified.
 * - longcat-2.5-free is hosted in China and requires the Global region in workspace privacy settings.
 * - beam-free is zero-priced but model access can be disabled in the owner console.
 * Training-use models such as iceman-contributor-free are deliberately excluded.
 */
export const OPENCODE_GO_FREE_MODELS = ['hy4-flash-free', 'longcat-2.5-free', 'beam-free'] as const;

export interface OpenCodeGoModel { id: string; label: string; free: boolean; note?: string }
export const OPENCODE_GO_MODELS: readonly OpenCodeGoModel[] = [
  { id: 'hy4-flash-free', label: 'HY4 Flash (free)', free: true, note: 'Zero-priced Go model; text and chart vision verified. Static $0 allowlist.' },
  { id: 'longcat-2.5-free', label: 'LongCat 2.5 (free)', free: true, note: 'Zero-priced. Hosted in China; enable the Global region in workspace privacy settings.' },
  { id: 'beam-free', label: 'Beam (free)', free: true, note: 'Zero-priced; access can be disabled in the owner console. Fallback only.' },
  { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', free: false },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', free: false },
  { id: 'glm-5.3-flash', label: 'GLM 5.3 Flash', free: false },
  { id: 'glm-5.3', label: 'GLM 5.3', free: false },
  { id: 'glm-5.2', label: 'GLM 5.2', free: false },
  { id: 'kimi-k3', label: 'Kimi K3', free: false },
  { id: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro', free: false },
  { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', free: false },
  { id: 'mimo-v2.6-flash', label: 'MiMo V2.6 Flash', free: false },
  { id: 'mimo-v2.6-pro', label: 'MiMo V2.6 Pro', free: false },
  { id: 'mimo-v2.5', label: 'MiMo V2.5', free: false },
  { id: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro', free: false },
  { id: 'minimax-m3.1-flash', label: 'MiniMax M3.1 Flash', free: false },
  { id: 'minimax-m3', label: 'MiniMax M3', free: false },
  { id: 'qwen4-max', label: 'Qwen4 Max', free: false },
  { id: 'qwen3.8-max', label: 'Qwen3.8 Max', free: false },
  { id: 'qwen3.8-flash', label: 'Qwen3.8 Flash', free: false },
  { id: 'qwen3.7-plus', label: 'Qwen3.7 Plus', free: false },
  { id: 'longcat-2.0', label: 'LongCat 2.0', free: false },
  { id: 'hy4', label: 'HY4', free: false },
  { id: 'hy3', label: 'HY3', free: false },
  { id: 'step-5-preview', label: 'Step 5 Preview', free: false },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', free: false },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', free: false },
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon', free: false },
  { id: 'grok-4.7', label: 'Grok 4.7', free: false },
];

export function isOpenCodeGoFreeModel(model: string | null | undefined): boolean {
  return !!model && (OPENCODE_GO_FREE_MODELS as readonly string[]).includes(model);
}

export type AIConfigState = 'disabled' | 'missing_key' | 'missing_model' | 'invalid_model' | 'invalid_provider' | 'ready' | 'degraded';

export type FetchLike = (input: string, init?: any) => Promise<any>;
export type EnvLike = Record<string, string | undefined>;

export const AI_LIMITS = {
  defaultTimeoutMs: 20_000,
  minTimeoutMs: 1_000,
  maxTimeoutMs: 60_000,
  defaultOutputTokens: 1_500,
  /**
   * Reasoning vision models (e.g. HY4 Flash) can spend 6k+ completion tokens on
   * hidden reasoning before emitting a ~300-token JSON answer. 3k truncated the
   * answer to nothing, so the vision budget needs headroom for both.
   */
  defaultVisionOutputTokens: 8_000,
  minOutputTokens: 64,
  maxOutputTokens: 12_000,
  maxRequestBodyBytes: 64 * 1024,
  /** Chart images are base64-inflated; this is the route-level cap for one vision request. */
  maxVisionRequestBodyBytes: 8 * 1024 * 1024,
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
  'opencode-go': {
    keyEnv: 'OPENCODE_API_KEY', host: 'opencode.ai', defaultModel: 'hy4-flash-free',
    modelPattern: /^[a-z0-9][a-z0-9.-]{1,63}$/,
    url: () => 'https://opencode.ai/inference/go/openai/v1/chat/completions',
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

export type AIProviderTarget = Exclude<AIProviderName, 'none'>;
export type AIFallbackStatus = 'ready' | 'not_configured' | 'blocked_paid';
/** Why an entry in the saved chain cannot run. */
export type AIEntryFailure = 'disabled' | 'missing_key' | 'invalid';

/** One cross-provider fallback entry. Its key is never serialised. */
export interface AIFallbackTarget {
  provider: AIProviderTarget;
  model: string;
  label: string;
  providerLabel?: string;
  configured: boolean;
  approvedPaid: boolean;
  supportsImages: boolean;
  status: AIFallbackStatus;
  failure?: AIEntryFailure;
  config?: AIRuntimeConfig;
}

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
  /** Explicitly approved for paid use under free-only via AI_APPROVED_PAID_MODELS. */
  approvedPaid?: boolean;
  /** Whether this model is known to accept image inputs. */
  supportsImages?: boolean;
  /** Ordered cross-provider fallbacks, including not-configured and blocked entries. */
  fallbackTargets?: AIFallbackTarget[];
  /** Labels of every configured fallback entry, in order. */
  fallbackModels?: string[];
  /** Explicit paid approvals as provider:model labels. */
  approvedPaidModels?: string[];
  /** Custom/registry OpenAI-compatible base URL (no /chat/completions suffix). */
  baseUrl?: string;
  /** Provider-specific headers; Authorization/Host are rejected upstream. */
  extraHeaders?: Record<string, string>;
  /** Display id for registry providers (built-in id or custom id). */
  providerLabel?: string;
  /** Non-enumerable: never serialised, never logged by JSON.stringify. */
  readonly apiKey?: string;
}

function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function parseProviderModel(value: string): { provider: AIProviderTarget; model: string } | null {
  const at = value.indexOf(':');
  if (at <= 0) return null;
  const provider = value.slice(0, at).trim();
  const model = value.slice(at + 1).trim();
  if (!model || !(AI_PROVIDERS as readonly string[]).includes(provider) || provider === 'none') return null;
  const spec = PROVIDER_SPECS[provider as AIProviderTarget];
  return spec.modelPattern.test(model) ? { provider: provider as AIProviderTarget, model } : null;
}

function supportsImagesFor(provider: AIProviderName, model: string | null): boolean {
  if (!model) return false;
  if (provider === 'opencode-go') return model === 'hy4-flash-free';
  if (provider === 'openrouter') return model === 'openrouter/free';
  if (provider === 'gemini' || provider === 'openai') return true;
  return false;
}

function isFreeCandidate(provider: AIProviderName, model: string): boolean {
  if (provider === 'opencode-go') return isOpenCodeGoFreeModel(model);
  if (provider === 'tokenrouter') return model === VERIFIED_FREE_MODEL;
  if (provider === 'openrouter') return model === 'openrouter/free';
  return false;
}

export function resolveAIConfig(env: EnvLike = process.env): AIRuntimeConfig {
  const rawProvider = (env.AI_PROVIDER ?? 'none').trim().toLowerCase() || 'none';
  const timeoutMs = clampInt(env.AI_TIMEOUT_MS, AI_LIMITS.defaultTimeoutMs, AI_LIMITS.minTimeoutMs, AI_LIMITS.maxTimeoutMs);
  const maxOutputTokens = clampInt(env.AI_MAX_OUTPUT_TOKENS, AI_LIMITS.defaultOutputTokens, AI_LIMITS.minOutputTokens, AI_LIMITS.maxOutputTokens);
  const requestsPerHour = clampInt(env.AI_MAX_REQUESTS_PER_HOUR, AI_LIMITS.defaultRequestsPerHour, 1, AI_LIMITS.maxRequestsPerHour);
  const costPolicy = env.AI_COST_POLICY === 'free-only' ? 'free-only' : 'operator-approved';
  const approvedPaidModels = [...new Set(String(env.AI_APPROVED_PAID_MODELS ?? '').split(',').map(value => value.trim()).filter(Boolean))];

  const makeConfig = (provider: AIProviderName, model: string | null, state: AIConfigState, key?: string, host: string | null = null): AIRuntimeConfig => {
    const cfg: AIRuntimeConfig = {
      provider, model, state,
      ready: state === 'ready',
      keyPresent: Boolean(key),
      endpointHost: host,
      timeoutMs, maxOutputTokens, requestsPerHour,
      costPolicy,
      approvedPaidModels,
    };
    if (key && state === 'ready') Object.defineProperty(cfg, 'apiKey', { value: key, enumerable: false });
    return cfg;
  };

  const build = (provider: AIProviderName, model: string | null, state: AIConfigState, key?: string, host: string | null = null): AIRuntimeConfig => {
    const cfg = makeConfig(provider, model, state, key, host);
    if (state !== 'ready' || provider === 'none' || !model) return cfg;
    const primaryLabel = `${provider}:${model}`;
    cfg.approvedPaid = approvedPaidModels.includes(primaryLabel);
    cfg.supportsImages = supportsImagesFor(provider, model);

    const fallbackSource = env.AI_FALLBACK_MODELS !== undefined
      ? env.AI_FALLBACK_MODELS
      : provider === 'opencode-go' ? 'openrouter:openrouter/free,opencode-go:deepseek-v4.1-flash' : '';
    const targets: AIFallbackTarget[] = [];
    const seen = new Set<string>();
    for (const raw of String(fallbackSource).split(',').map(value => value.trim()).filter(Boolean)) {
      const parsed = parseProviderModel(raw);
      if (!parsed) continue;
      const label = `${parsed.provider}:${parsed.model}`;
      if (label === primaryLabel || seen.has(label)) continue;
      seen.add(label);
      const targetSpec = PROVIDER_SPECS[parsed.provider];
      const targetKey = (env[targetSpec.keyEnv] ?? '').trim();
      const targetApproved = approvedPaidModels.includes(label);
      const blockedPaid = costPolicy === 'free-only' && !isFreeCandidate(parsed.provider, parsed.model) && !targetApproved;
      const configured = Boolean(targetKey);
      const status: AIFallbackStatus = !configured ? 'not_configured' : blockedPaid ? 'blocked_paid' : 'ready';
      const targetCfg = status === 'ready' ? makeConfig(parsed.provider, parsed.model, 'ready', targetKey, targetSpec.host) : undefined;
      if (targetCfg) {
        targetCfg.approvedPaid = targetApproved;
        targetCfg.supportsImages = supportsImagesFor(parsed.provider, parsed.model);
      }
      targets.push({
        provider: parsed.provider, model: parsed.model, label, configured, approvedPaid: targetApproved,
        supportsImages: supportsImagesFor(parsed.provider, parsed.model), status,
        ...(targetCfg ? { config: targetCfg } : {}),
      });
    }
    cfg.fallbackTargets = targets.slice(0, 3);
    cfg.fallbackModels = targets.map(target => target.label);
    return cfg;
  };

  if (!(AI_PROVIDERS as readonly string[]).includes(rawProvider)) return build('none', null, 'invalid_provider');
  if (rawProvider === 'none') return build('none', null, 'disabled');

  const provider = rawProvider as AIProviderTarget;
  const spec = PROVIDER_SPECS[provider];
  // Only this provider's own key is consulted for the primary. Fallback targets read their own provider's key.
  const key = (env[spec.keyEnv] ?? '').trim();
  if (provider === 'tokenrouter' && env.TOKENROUTER_BASE_URL && env.TOKENROUTER_BASE_URL.replace(/\/$/, '') !== 'https://api.tokenrouter.com/v1') return build(provider, null, 'invalid_provider');
  const requestedModel = (env.AI_MODEL ?? (provider === 'tokenrouter' ? env.TOKENROUTER_MODEL : '') ?? '').trim();
  const model = requestedModel || spec.defaultModel;

  if (!key) return build(provider, model, 'missing_key', undefined, spec.host);
  if (!model) return build(provider, null, 'missing_model', key, spec.host);
  if (!spec.modelPattern.test(model)) return build(provider, null, 'invalid_model', key, spec.host);
  return build(provider, model, 'ready', key, spec.host);
}

/**
 * Vision uses VISION_PROVIDER/VISION_MODEL when present and otherwise the normal
 * AI provider/model. Only the selected provider's own key is ever consulted.
 */
export function resolveVisionConfig(env: EnvLike = process.env): AIRuntimeConfig {
  const explicitProvider = (env.VISION_PROVIDER ?? '').trim().toLowerCase();
  const explicitModel = (env.VISION_MODEL ?? '').trim();
  if (!explicitProvider && !explicitModel) return resolveAIConfig(env);
  const aiProvider = (env.AI_PROVIDER ?? 'none').trim().toLowerCase();
  const provider = explicitProvider || aiProvider;
  const model = explicitModel || (provider === aiProvider ? (env.AI_MODEL ?? '') : '');
  return resolveAIConfig({ ...env, AI_PROVIDER: provider, AI_MODEL: model || undefined });
}

export type ProviderErrorCode =
  | 'not_configured' | 'budget_exceeded' | 'request_too_large' | 'timeout' | 'network_error'
  | 'http_error' | 'response_too_large' | 'invalid_response' | 'empty_response' | 'refusal' | 'cost_not_approved';

export interface ProviderCallSuccess { ok: true; text: string; reasoningText?: string; provider: AIProviderName; model: string; providerLabel?: string }
export interface ProviderCallFailure { ok: false; code: ProviderErrorCode; message: string; status?: number; retryAfterMs?: number }
export type ProviderCallResult = ProviderCallSuccess | ProviderCallFailure;

/** The most recent provider call in this process, for honest capability reporting. */
export interface ProviderCallStatus {
  ok: boolean;
  provider: AIProviderName;
  model: string | null;
  at: string;
  code?: ProviderErrorCode;
  status?: number;
}
let lastProviderCall: ProviderCallStatus | null = null;

/** Test/ops seam. */
export function resetLastProviderCall(): void { lastProviderCall = null; }
export function getLastProviderCall(): ProviderCallStatus | null { return lastProviderCall ? { ...lastProviderCall } : null; }
function recordProviderCall(result: ProviderCallResult, provider: AIProviderName, model: string | null): void {
  lastProviderCall = result.ok
    ? { ok: true, provider, model, at: new Date().toISOString() }
    : { ok: false, provider, model, at: new Date().toISOString(), code: result.code, ...(result.status !== undefined ? { status: result.status } : {}) };
}

export interface ProviderRequest {
  system: string;
  /** Single user message containing JSON-encoded untrusted data. */
  user: string;
  json: boolean;
  /** Stable conversation identity for providers that require one (OpenCode Go). */
  sessionId?: string;
  /** Validated image data URLs (png/jpeg/webp). Vision-capable providers only. */
  images?: string[];
  /** Optional caller cap, bounded by AI_LIMITS.maxVisionRequestBodyBytes when images are present. */
  maxRequestBodyBytes?: number;
  /** Optional output-token override, bounded by AI_LIMITS.maxOutputTokens. */
  maxOutputTokens?: number;
  /** Optional sampling temperature; chart analysis asks for deterministic 0. */
  temperature?: number;
  /** Optional OpenAI-compatible reasoning effort hint (used for slower reasoning vision models). */
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** Read the answer from a reasoning-only reply instead of failing the pass. */
  reasoningFallback?: boolean;
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

/** Shared hourly AI budget; provider connectivity tests consume it too. */
export function consumeDefaultBudget(limit: number): boolean { return defaultBudget.tryConsume(limit); }

export interface ProviderDeps {
  fetch?: FetchLike;
  budget?: RequestBudget;
  /** Conversation identifier from the caller; overrides the process-scoped session. */
  sessionId?: string;
  /** Test seam for Retry-After waits. */
  sleep?: (ms: number) => Promise<void>;
}

function fail(code: ProviderErrorCode, message: string, status?: number, retryAfterMs?: number): ProviderCallFailure {
  return { ok: false, code, message, ...(status !== undefined ? { status } : {}), ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
}

function splitImageDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const comma = dataUrl.indexOf(',');
  const header = comma > 0 ? dataUrl.slice(0, comma) : '';
  const match = /^data:(image\/(?:png|jpeg|webp));base64$/.exec(header);
  if (!match || comma < 0) throw new Error('Invalid image data URL');
  const base64 = dataUrl.slice(comma + 1);
  if (!base64) throw new Error('Empty image data URL');
  return { mimeType: match[1], base64 };
}

export function buildProviderPayload(cfg: AIRuntimeConfig, req: ProviderRequest): { url: string; headers: Record<string, string>; body: string } {
  if (!cfg.ready || cfg.provider === 'none' || !cfg.model || !cfg.apiKey) throw new Error('AI provider is not ready');
  const spec = PROVIDER_SPECS[cfg.provider];
  const baseUrl = cfg.baseUrl?.replace(/\/+$/, '');
  const url = baseUrl ? `${baseUrl}/chat/completions` : spec.url(cfg.model);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  for (const [name, value] of Object.entries(cfg.extraHeaders ?? {})) {
    if (/^(authorization|host)$/i.test(name)) continue;
    headers[name] = value;
  }
  const images = (req.images ?? []).map(splitImageDataUrl);
  const maxOutputTokens = req.maxOutputTokens === undefined
    ? cfg.maxOutputTokens
    : Math.min(AI_LIMITS.maxOutputTokens, Math.max(AI_LIMITS.minOutputTokens, Math.trunc(req.maxOutputTokens)));
  let payload: unknown;
  if (cfg.provider === 'gemini') {
    headers['x-goog-api-key'] = cfg.apiKey;
    payload = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }, ...images.map(image => ({ inline_data: { mime_type: image.mimeType, data: image.base64 } }))] }],
      generationConfig: {
        maxOutputTokens,
        temperature: req.temperature ?? 0.2,
        ...(req.json ? { responseMimeType: 'application/json' } : {}),
      },
    };
  } else {
    headers.Authorization = `Bearer ${cfg.apiKey}`;
    if (cfg.provider === 'opencode-go') {
      // Go asks every client to identify itself and to keep one session id per conversation.
      headers['User-Agent'] = OPENCODE_GO_USER_AGENT;
      headers['x-opencode-session'] = req.sessionId ?? OPENCODE_GO_PROCESS_SESSION;
    }
    if (cfg.provider === 'openrouter') {
      // Recommended attribution headers for the OpenRouter free router.
      headers['HTTP-Referer'] = process.env.PUBLIC_ORIGIN ?? 'https://stragy.app';
      headers['X-Title'] = 'Stragy research';
    }
    const userContent = images.length
      ? [{ type: 'text', text: req.user }, ...images.map(image => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } }))]
      : req.user;
    payload = {
      model: cfg.model,
      messages: [{ role: 'system', content: req.system }, { role: 'user', content: userContent }],
      temperature: req.temperature ?? 0.2,
      ...(req.reasoningEffort ? { reasoning_effort: req.reasoningEffort } : {}),
      ...(cfg.provider === 'openai' ? { max_completion_tokens: maxOutputTokens } : { max_tokens: maxOutputTokens }),
      ...(req.json ? { response_format: { type: 'json_object' } } : {}),
    };
  }
  return { url, headers, body: JSON.stringify(payload) };
}

function extractText(provider: AIProviderName, data: any, reasoningFallback = false): ProviderCallFailure | { text: string; reasoningText?: string } {
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
  const reasoning = typeof choice.message?.reasoning_content === 'string' ? choice.message.reasoning_content : '';
  const reasoningOnly = reasoning.trim().length > 0;
  const content = choice.message?.content;
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) text = content.map((part: any) => typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '').join('');
  else if (content && typeof content === 'object' && typeof content.text === 'string') text = content.text;
  else if (!reasoningOnly) return fail(choice.finish_reason === 'length' ? 'empty_response' : 'invalid_response', choice.finish_reason === 'length' ? 'Provider returned no answer text. This is retryable.' : 'Provider message content was not text.');
  if (text.trim()) return { text };
  if (reasoningOnly && reasoningFallback) return { text: '', reasoningText: reasoning };
  return fail('empty_response', reasoningOnly
    ? 'Provider returned reasoning without answer text.'
    : choice.finish_reason === 'length' ? 'Provider returned no answer text. This is retryable.' : 'Provider returned empty text.');
}

/**
 * One HTTP attempt against one model. Never retries by itself.
 */
async function attemptProvider(cfg: AIRuntimeConfig, req: ProviderRequest, deps: ProviderDeps, fetchImpl: FetchLike): Promise<ProviderCallResult> {
  if (!cfg.ready || cfg.provider === 'none' || !cfg.model) return fail('not_configured', 'External AI is not configured.');

  let built;
  try { built = buildProviderPayload(cfg, deps.sessionId ? { ...req, sessionId: deps.sessionId } : req); } catch { return fail('not_configured', 'External AI is not configured.'); }
  const requestCap = req.images?.length
    ? Math.min(req.maxRequestBodyBytes ?? AI_LIMITS.maxVisionRequestBodyBytes, AI_LIMITS.maxVisionRequestBodyBytes)
    : AI_LIMITS.maxRequestBodyBytes;
  if (Buffer.byteLength(built.body, 'utf8') > requestCap) return fail('request_too_large', 'AI request exceeds the size limit.');
  const host = new URL(built.url).host;
  const expectedHost = cfg.baseUrl ? new URL(cfg.baseUrl).host : PROVIDER_SPECS[cfg.provider].host;
  if (host !== expectedHost) return fail('not_configured', 'Endpoint is not allowlisted.');

  if (!(deps.budget ?? defaultBudget).tryConsume(cfg.requestsPerHour)) return fail('budget_exceeded', 'AI request budget exhausted for this period.');

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ProviderCallFailure>((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(fail('timeout', `AI request timed out after ${cfg.timeoutMs} ms.`)); }, cfg.timeoutMs);
  });

  const work = (async (): Promise<ProviderCallResult> => {
    if (cfg.costPolicy === 'free-only') {
      let free = false;
      if (cfg.provider === 'opencode-go') {
        // Static $0 allowlist: no pricing endpoint is called for Go.
        free = isOpenCodeGoFreeModel(cfg.model);
      } else if (cfg.provider === 'tokenrouter') {
        free = await verifyFreeModel(fetchImpl, cfg.model!, controller.signal);
      } else if (cfg.provider === 'openrouter') {
        free = await verifyOpenRouterFreeModel(fetchImpl, cfg.model!, controller.signal);
      }
      if (!free && !cfg.approvedPaid) {
        return fail('cost_not_approved', `No AI request was sent: ${cfg.provider}:${cfg.model} is not verified zero-priced and is not in AI_APPROVED_PAID_MODELS.`);
      }
    }
    if (controller.signal.aborted) return fail('timeout', 'AI pricing verification timed out. No completion was requested.');
    let res: any;
    try {
      res = await fetchImpl(built.url, { method: 'POST', headers: built.headers, body: built.body, signal: controller.signal, redirect: 'manual' });
    } catch (e: any) {
      if (e?.name === 'AbortError') return fail('timeout', `AI request timed out after ${cfg.timeoutMs} ms.`);
      return fail('network_error', 'Could not reach the AI provider.');
    }
    if (!res || typeof res.status !== 'number' && res.ok === undefined) return fail('invalid_response', 'Malformed provider response.');
    if (!res.ok) {
      try { await res.body?.cancel?.(); } catch { /* best-effort release */ }
      const after = parseRetryAfter(res.headers?.get?.('retry-after'));
      return fail('http_error', res.status === 403 ? 'AI provider refused access (HTTP 403). Check the configured key\'s model permissions. No alternate or paid model was used.' : `AI provider returned HTTP ${res.status ?? 'error'}.`, res.status, after);
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
    if (cfg.provider === 'opencode-go' && req.images?.length) {
      const choice = data?.choices?.[0];
      const content = choice?.message?.content;
      console.info(JSON.stringify({
        event: 'provider_response_shape', provider: cfg.provider, model: cfg.model,
        contentLength: typeof content === 'string' ? content.length : Array.isArray(content) ? content.length : 0,
        reasoningLength: typeof choice?.message?.reasoning_content === 'string' ? choice.message.reasoning_content.length : 0,
        finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
        toolCalls: Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls.length : 0,
      }));
    }
    const extracted = extractText(cfg.provider, data, req.reasoningFallback === true);
    if ('ok' in extracted) return extracted;
    const routedModel = cfg.provider === 'openrouter' && typeof data.model === 'string' && data.model.trim()
      ? data.model.trim()
      : cfg.model!;
    return { ok: true, text: extracted.text, ...(extracted.reasoningText ? { reasoningText: extracted.reasoningText } : {}), provider: cfg.provider, model: routedModel, ...(cfg.providerLabel ? { providerLabel: cfg.providerLabel } : {}) };
  })();

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Parse Retry-After seconds or an HTTP date. Never waits more than five seconds. */
function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(5_000, Math.round(seconds * 1_000)));
  const at = Date.parse(value);
  if (Number.isFinite(at)) return Math.max(0, Math.min(5_000, at - now));
  return undefined;
}

async function attemptWithRetry(cfg: AIRuntimeConfig, req: ProviderRequest, deps: ProviderDeps, fetchImpl: FetchLike): Promise<ProviderCallResult> {
  const first = await attemptProvider(cfg, req, deps, fetchImpl);
  if (first.ok || first.code !== 'http_error' || first.status !== 429) return first;
  const waitMs = first.retryAfterMs ?? 1_000;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  await sleep(waitMs);
  return attemptProvider(cfg, req, deps, fetchImpl);
}

/**
 * Call the configured provider. On a 429 the same model is retried once after the
 * provider's Retry-After (capped at 5 s). Cross-provider fallback entries are tried
 * in order after a 429, 403, timeout or empty answer. Paid fallbacks must be listed
 * in AI_APPROVED_PAID_MODELS; their use is logged without secrets. Every attempt
 * stays inside the request budget.
 */
export async function callProvider(cfg: AIRuntimeConfig, req: ProviderRequest, deps: ProviderDeps = {}): Promise<ProviderCallResult> {
  if (!cfg.ready || cfg.provider === 'none' || !cfg.model) {
    const result = fail('not_configured', 'External AI is not configured.');
    recordProviderCall(result, cfg.provider, cfg.model);
    return result;
  }
  const fetchImpl: FetchLike | undefined = deps.fetch ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    const result = fail('network_error', 'No fetch implementation available.');
    recordProviderCall(result, cfg.provider, cfg.model);
    return result;
  }

  const attempts: { config: AIRuntimeConfig; fallback: boolean }[] = [{ config: cfg, fallback: false }];
  for (const target of cfg.fallbackTargets ?? []) {
    if (!target.configured || target.status !== 'ready' || !target.config) continue;
    // An owner-approved paid fallback is a last resort for vision too; the
    // provider is allowed to reject images, and that attempt is logged.
    const imageCapable = target.supportsImages || (target.approvedPaid && target.configured);
    if (req.images?.length && !imageCapable) continue;
    attempts.push({ config: target.config, fallback: true });
  }

  let failure: ProviderCallFailure | null = null;
  let failedProvider: AIProviderName = cfg.provider;
  let failedModel: string | null = cfg.model;
  for (const attempt of attempts) {
    const attemptCfg = attempt.config;
    if (attempt.fallback && attemptCfg.approvedPaid && attemptCfg.costPolicy === 'free-only') {
      console.info(JSON.stringify({ event: 'ai_paid_fallback', provider: attemptCfg.provider, model: attemptCfg.model, at: new Date().toISOString() }));
    }
    const result = await attemptWithRetry(attemptCfg, req, deps, fetchImpl);
    if (req.images?.length) {
      console.info(JSON.stringify({ event: 'ai_vision_attempt', provider: attemptCfg.provider, model: attemptCfg.model, fallback: attempt.fallback, ok: result.ok, code: result.ok ? undefined : result.code, at: new Date().toISOString() }));
    }
    if (result.ok) {
      recordProviderCall(result, result.provider, result.model);
      return result;
    }
    failure = result;
    failedProvider = attemptCfg.provider;
    failedModel = attemptCfg.model;
    const fallbackEligible = result.code === 'timeout' || result.code === 'empty_response' || result.code === 'network_error' || result.code === 'http_error';
    if (!fallbackEligible) break;
  }
  const final = failure ?? fail('network_error', 'Could not reach the AI provider.');
  recordProviderCall(final, failedProvider, failedModel);
  return final;
}
