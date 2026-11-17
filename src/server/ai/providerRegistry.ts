/**
 * Provider manager: built-in and custom OpenAI-compatible providers, the ordered
 * AI chain, encrypted stored keys, SSRF-safe base URLs and the public contract.
 *
 * Saved settings in data/ai-providers.json override the env baseline. Resetting
 * removes the file and returns to AI_PROVIDER/AI_MODEL/AI_FALLBACK_MODELS.
 */
import { promises as dns } from 'node:dns';
import { z } from 'zod';
import {
  OPENCODE_GO_MODELS, buildProviderPayload, getLastProviderCall, isOpenCodeGoFreeModel, resolveAIConfig,
  type AIEntryFailure, type AIFallbackTarget, type AIProviderName, type AIRuntimeConfig,
} from './provider';
import { VERIFIED_FREE_MODEL } from './freeModel';
import { decryptSecret, encryptSecret, getSecretsStorage, redactSecret, secretHint } from './providerSecrets';
import { clearState, loadState, persistence as storePersistence, readFileState, saveState, type StoredProvider, type StoredState } from './providerStore';
import { AIChainUpdateInputSchema, AIProviderWriteInputSchema } from '../../shared/contracts/featureRegistry';
import type {
  AIChainEntryInput, AIChainEntryPublic, AIProviderModelPublic, AIProviderPrice, AIProviderPublic,
  AIProviderTestResponse, AIProviderWriteInput, AIProvidersResponse,
} from '../../shared/contracts/aiProviders';

const STATE_VERSION = 1;
const MAX_CHAIN = 6;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

interface BuiltinProvider {
  id: string;
  label: string;
  baseUrl: string;
  keyEnv: string;
  adapter: AIProviderName;
}

const BUILTINS: readonly BuiltinProvider[] = [
  { id: 'opencode-go', label: 'OpenCode Go', baseUrl: 'https://opencode.ai/inference/go/openai/v1', keyEnv: 'OPENCODE_API_KEY', adapter: 'opencode-go' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY', adapter: 'openrouter' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', keyEnv: 'DEEPSEEK_API_KEY', adapter: 'deepseek' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY', adapter: 'openai' },
  { id: 'gemini', label: 'Gemini (OpenAI-compatible)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY', adapter: 'openai' },
  { id: 'tokenrouter', label: 'TokenRouter', baseUrl: 'https://api.tokenrouter.com/v1', keyEnv: 'TOKENROUTER_API_KEY', adapter: 'tokenrouter' },
];

interface ProviderRecord extends StoredProvider {
  adapter: AIProviderName;
  keyEnv?: string;
}

export class ProviderError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const providerInputSchema = AIProviderWriteInputSchema;
const chainSchema = AIChainUpdateInputSchema;
const testSchema = z.object({ model: z.string().trim().min(1).max(160) }).strict();

let cache: StoredState | null | undefined;
let cacheLoaded = false;

/** Boot-time load. A DB outage falls back to the file/env baseline. */
export async function initializeProviderRegistry(env: Record<string, string | undefined> = process.env): Promise<void> {
  cache = await loadState(env);
  cacheLoaded = true;
}

/** Test seam. */
export function resetProviderRegistryCache(): void {
  cache = undefined;
  cacheLoaded = false;
}

function readState(env: Record<string, string | undefined>): StoredState | null {
  if (cacheLoaded) return cache ?? null;
  if (!env.DATABASE_URL) {
    cache = readFileState(env);
    cacheLoaded = true;
    return cache ?? null;
  }
  return null;
}

async function persistState(state: StoredState, env: Record<string, string | undefined>): Promise<void> {
  await saveState(state, env);
  cache = state;
  cacheLoaded = true;
}

function envKey(env: Record<string, string | undefined>, keyEnv: string | undefined): string | null {
  const value = keyEnv ? (env[keyEnv] ?? '').trim() : '';
  return value || null;
}

function mergedProviders(env: Record<string, string | undefined>): ProviderRecord[] {
  const state = readState(env);
  const records = new Map<string, ProviderRecord>();
  for (const builtin of BUILTINS) {
    records.set(builtin.id, { id: builtin.id, label: builtin.label, baseUrl: builtin.baseUrl, enabled: true, builtin: true, adapter: builtin.adapter, keyEnv: builtin.keyEnv });
  }
  for (const saved of state?.providers ?? []) {
    const builtin = BUILTINS.find(item => item.id === saved.id);
    if (builtin) {
      records.set(saved.id, { ...saved, builtin: true, adapter: builtin.adapter, keyEnv: builtin.keyEnv });
    } else {
      records.set(saved.id, { ...saved, builtin: false, adapter: 'openai' });
    }
  }
  return [...records.values()];
}

function providerKey(record: ProviderRecord, env: Record<string, string | undefined>): string | null {
  return decryptSecret(record.keyEnc, env) ?? envKey(env, record.keyEnv);
}

function keySource(record: ProviderRecord, env: Record<string, string | undefined>): 'env' | 'stored' | 'none' {
  if (record.keyEnc && decryptSecret(record.keyEnc, env)) return 'stored';
  return envKey(env, record.keyEnv) ? 'env' : 'none';
}

function publicProvider(record: ProviderRecord, env: Record<string, string | undefined>): AIProviderPublic {
  const key = providerKey(record, env);
  return {
    id: record.id, label: record.label, baseUrl: record.baseUrl, builtin: record.builtin,
    enabled: record.enabled, keySource: keySource(record, env), keyHint: secretHint(key),
    extraHeaderNames: Object.keys(record.extraHeaders ?? {}),
  };
}

function envChain(env: Record<string, string | undefined>): AIChainEntryInput[] {
  const primaryProvider = (env.AI_PROVIDER ?? 'none').trim();
  if (!primaryProvider || primaryProvider === 'none') return [];
  const builtin = BUILTINS.find(item => item.id === primaryProvider);
  const model = (env.AI_MODEL ?? '').trim() || (primaryProvider === 'opencode-go' ? 'hy4-flash-free' : '');
  if (!builtin || !model) return [];
  const approved = new Set(String(env.AI_APPROVED_PAID_MODELS ?? '').split(',').map(value => value.trim()).filter(Boolean));
  const chain: AIChainEntryInput[] = [{
    providerId: primaryProvider, model, vision: visionFor(primaryProvider, model),
    paidApproved: approved.has(`${primaryProvider}:${model}`),
  }];
  const fallbackSource = env.AI_FALLBACK_MODELS !== undefined
    ? env.AI_FALLBACK_MODELS
    : primaryProvider === 'opencode-go' ? 'openrouter:openrouter/free,opencode-go:deepseek-v4.1-flash' : '';
  for (const raw of String(fallbackSource).split(',').map(value => value.trim()).filter(Boolean)) {
    const at = raw.indexOf(':');
    if (at <= 0) continue;
    const providerId = raw.slice(0, at).trim();
    const fallbackModel = raw.slice(at + 1).trim();
    if (!fallbackModel || !BUILTINS.some(item => item.id === providerId)) continue;
    if (chain.some(entry => entry.providerId === providerId && entry.model === fallbackModel)) continue;
    chain.push({ providerId, model: fallbackModel, vision: visionFor(providerId, fallbackModel), paidApproved: approved.has(`${providerId}:${fallbackModel}`) });
    if (chain.length >= MAX_CHAIN) break;
  }
  return chain;
}

function visionFor(providerId: string, model: string): boolean {
  if (providerId === 'opencode-go') return model === 'hy4-flash-free';
  if (providerId === 'openrouter') return model === 'openrouter/free';
  if (providerId === 'openai' || providerId === 'gemini') return true;
  return false;
}

/** true zero-priced, false paid, null unknown. */
function freeState(providerId: string, model: string): boolean | null {
  if (providerId === 'opencode-go') {
    const catalog = OPENCODE_GO_MODELS.find(item => item.id === model);
    if (catalog) return catalog.free;
    return isOpenCodeGoFreeModel(model) ? true : false;
  }
  if (providerId === 'openrouter') return model === 'openrouter/free' ? true : null;
  if (providerId === 'tokenrouter') return model === VERIFIED_FREE_MODEL ? true : null;
  return null;
}

function priceFor(providerId: string, model: string): AIProviderPrice | null {
  return freeState(providerId, model) === true ? { prompt: 0, completion: 0 } : null;
}

function lastStatusFor(entry: AIChainEntryInput): AIChainEntryPublic['lastStatus'] {
  const call = getLastProviderCall();
  if (!call) return null;
  const providerMatches = call.provider === entry.providerId || (entry.providerId === 'gemini' && call.provider === 'openai');
  if (!providerMatches) return null;
  const modelMatches = call.model === entry.model || entry.providerId === 'openrouter';
  if (!modelMatches) return null;
  return {
    ok: call.ok, at: call.at,
    ...(call.code ? { error: call.code + (call.status !== undefined ? ` (HTTP ${call.status})` : '') } : {}),
  };
}

function activeChain(env: Record<string, string | undefined>): AIChainEntryInput[] {
  const state = readState(env);
  if (state && state.chain.length) return state.chain;
  return envChain(env);
}

function writable(env: Record<string, string | undefined>): boolean {
  if (env.EXPOSURE_MODE === 'private') return true;
  const host = (env.HOST ?? '').trim().toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

export function getProvidersResponse(env: Record<string, string | undefined> = process.env): AIProvidersResponse {
  const providers = mergedProviders(env);
  const chain = activeChain(env).map(entry => {
    const free = freeState(entry.providerId, entry.model);
    return {
      providerId: entry.providerId, model: entry.model, vision: entry.vision, paidApproved: entry.paidApproved,
      price: priceFor(entry.providerId, entry.model), free, lastStatus: lastStatusFor(entry),
    };
  });
  const canWrite = writable(env);
  return {
    providers: providers.map(record => publicProvider(record, env)),
    chain,
    costPolicy: env.AI_COST_POLICY === 'operator-approved' ? 'operator-approved' : 'free-only',
    writable: canWrite,
    ...(canWrite ? {} : { writeBlockedReason: 'Provider settings are read-only on a public deployment. Use EXPOSURE_MODE=private behind the site password, or run locally.' }),
    secretsStorage: getSecretsStorage(env),
    persistence: storePersistence(env),
  };
}

function requireWritable(env: Record<string, string | undefined>): void {
  if (!writable(env)) throw new ProviderError(403, 'READ_ONLY', 'Provider settings are read-only on this deployment.');
}

let dnsLookup = dns.lookup;
/** Test seam. */
export function setDnsLookupForTests(fn: typeof dns.lookup | null): void { dnsLookup = fn ?? dns.lookup; }

function isPrivateIp(address: string): boolean {
  const ip = address.toLowerCase();
  if (ip === '::1' || ip === '::' || ip === '0.0.0.0') return ip !== '::1' ? true : false;
  if (ip.includes(':')) {
    if (ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
    if (ip.startsWith('::ffff:')) return isPrivateIp(ip.slice(7));
    return false;
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function literalIp(host: string): string | null {
  const value = host.replace(/^\[|\]$/g, '');
  return /^[0-9.]+$/.test(value) || value.includes(':') ? value : null;
}

/** Validate an operator-supplied base URL. Rejects private/metadata targets and non-HTTPS. */
export async function validateBaseUrl(raw: string): Promise<string> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ProviderError(400, 'INVALID_BASE_URL', 'Base URL must be a valid URL.'); }
  if (url.username || url.password) throw new ProviderError(400, 'INVALID_BASE_URL', 'Base URL must not contain credentials.');
  if (url.search || url.hash) throw new ProviderError(400, 'INVALID_BASE_URL', 'Base URL must not contain a query or fragment.');
  const host = url.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  const literal = literalIp(host);
  if (literal && isPrivateIp(literal) && !(loopback && (literal === '127.0.0.1' || literal === '::1'))) {
    throw new ProviderError(400, 'PRIVATE_BASE_URL', 'Base URL must not point at a private, link-local or metadata address.');
  }
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    throw new ProviderError(400, 'INVALID_BASE_URL', 'Base URL must use HTTPS; HTTP is allowed only for localhost.');
  }
  if (!literal) {
    if (host.endsWith('.invalid')) return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
    let addresses: { address: string }[];
    try { addresses = await dnsLookup(host, { all: true }); } catch { throw new ProviderError(400, 'INVALID_BASE_URL', 'Base URL host could not be resolved.'); }
    if (!addresses.length || addresses.some(item => isPrivateIp(item.address) && !(loopback && (item.address === '127.0.0.1' || item.address === '::1')))) {
      throw new ProviderError(400, 'PRIVATE_BASE_URL', 'Base URL must not resolve to a private, link-local or metadata address.');
    }
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const safe: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!name.trim() || /[\r\n]/.test(name) || /[\r\n]/.test(value)) throw new ProviderError(400, 'INVALID_HEADERS', 'Header names and values must be single-line.');
    if (/^(authorization|host)$/i.test(name)) throw new ProviderError(400, 'INVALID_HEADERS', 'Authorization and Host headers cannot be overridden.');
    safe[name] = value;
  }
  return Object.keys(safe).length ? safe : undefined;
}

function customId(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'provider';
  return 'custom-' + slug + '-' + Math.random().toString(36).slice(2, 6);
}

export async function upsertProvider(raw: unknown, env: Record<string, string | undefined> = process.env): Promise<AIProviderPublic> {
  requireWritable(env);
  const input = providerInputSchema.parse(raw) as AIProviderWriteInput;
  const state = readState(env) ?? { version: STATE_VERSION, providers: [], chain: [], updatedAt: new Date().toISOString() };
  const existingBuiltin = input.id ? BUILTINS.find(item => item.id === input.id) : undefined;
  const existingSaved = input.id ? state.providers.find(item => item.id === input.id) : undefined;
  const existingMerged = input.id ? mergedProviders(env).find(item => item.id === input.id) : undefined;
  if (input.id && !existingBuiltin && !existingMerged) throw new ProviderError(404, 'PROVIDER_NOT_FOUND', 'Provider not found.');
  if (input.id && !existingBuiltin && existingMerged?.builtin) throw new ProviderError(400, 'BUILTIN_PROVIDER', 'Built-in providers cannot be replaced.');

  const baseUrl = await validateBaseUrl(input.baseUrl);
  const id = input.id ?? customId(input.label);
  const builtin = Boolean(existingBuiltin);
  const priorKeyEnc = existingSaved?.keyEnc;
  let keyEnc = input.clearKey ? undefined : priorKeyEnc;
  if (!input.clearKey && input.apiKey && input.apiKey.trim()) {
    const encrypted = encryptSecret(input.apiKey.trim(), env);
    if (!encrypted) throw new ProviderError(409, 'SECRETS_UNAVAILABLE', 'Provider keys cannot be stored on this deployment. Use environment keys instead.');
    keyEnc = encrypted;
  }
  const record: StoredProvider = {
    id, label: input.label.trim(), baseUrl, enabled: input.enabled !== false, builtin,
    ...(keyEnc ? { keyEnc } : {}),
    ...(sanitizeHeaders(input.extraHeaders) ? { extraHeaders: sanitizeHeaders(input.extraHeaders) } : {}),
  };
  const providers = state.providers.filter(item => item.id !== id);
  providers.push(record);
  await persistState({ ...state, providers, updatedAt: new Date().toISOString() }, env);
  return publicProvider({ ...record, adapter: builtin ? (existingBuiltin?.adapter ?? 'openai') : 'openai', keyEnv: existingBuiltin?.keyEnv }, env);
}

export async function deleteProvider(id: string, env: Record<string, string | undefined> = process.env): Promise<void> {
  requireWritable(env);
  if (BUILTINS.some(item => item.id === id)) throw new ProviderError(400, 'BUILTIN_PROVIDER', 'Built-in providers cannot be deleted.');
  const state = readState(env);
  if (!state) throw new ProviderError(404, 'PROVIDER_NOT_FOUND', 'Provider not found.');
  const exists = state.providers.some(item => item.id === id);
  if (!exists) throw new ProviderError(404, 'PROVIDER_NOT_FOUND', 'Provider not found.');
  await persistState({
    ...state,
    providers: state.providers.filter(item => item.id !== id),
    chain: state.chain.filter(entry => entry.providerId !== id),
    updatedAt: new Date().toISOString(),
  }, env);
}

export async function setChain(raw: unknown, env: Record<string, string | undefined> = process.env): Promise<AIProvidersResponse> {
  requireWritable(env);
  const parsed = chainSchema.parse(raw);
  const providers = mergedProviders(env);
  const seen = new Set<string>();
  for (const entry of parsed.entries) {
    if (!providers.some(provider => provider.id === entry.providerId)) throw new ProviderError(400, 'UNKNOWN_PROVIDER', `Unknown provider: ${entry.providerId}`);
    const key = `${entry.providerId}:${entry.model}`;
    if (seen.has(key)) throw new ProviderError(400, 'DUPLICATE_ENTRY', `Duplicate chain entry: ${key}`);
    seen.add(key);
    if (env.AI_COST_POLICY !== 'operator-approved') {
      const free = freeState(entry.providerId, entry.model);
      if (free !== true && !entry.paidApproved) throw new ProviderError(400, 'PAID_NOT_APPROVED', `${key} is paid or has unknown price; set paidApproved:true to approve it explicitly.`);
    }
  }
  const state = readState(env) ?? { version: STATE_VERSION, providers: [], chain: [], updatedAt: new Date().toISOString() };
  await persistState({ ...state, chain: parsed.entries, updatedAt: new Date().toISOString() }, env);
  return getProvidersResponse(env);
}

export async function resetProviders(env: Record<string, string | undefined> = process.env): Promise<AIProvidersResponse> {
  requireWritable(env);
  await clearState(env);
  cache = null;
  cacheLoaded = true;
  return getProvidersResponse(env);
}

const rate = new Map<string, number[]>();
function consumeRate(key: string, now = Date.now()): boolean {
  const stamps = (rate.get(key) ?? []).filter(at => now - at < RATE_WINDOW_MS);
  if (stamps.length >= RATE_LIMIT) { rate.set(key, stamps); return false; }
  stamps.push(now);
  rate.set(key, stamps);
  return true;
}
/** Test seam. */
export function resetProviderRegistryForTests(): void { rate.clear(); }

export async function listProviderModels(id: string, env: Record<string, string | undefined> = process.env): Promise<AIProviderModelPublic[]> {
  const record = mergedProviders(env).find(item => item.id === id);
  if (!record) throw new ProviderError(404, 'PROVIDER_NOT_FOUND', 'Provider not found.');
  if (!consumeRate(`models:${id}`)) throw new ProviderError(429, 'RATE_LIMITED', 'Too many model requests; try again in a minute.');
  if (id === 'opencode-go') {
    return OPENCODE_GO_MODELS.map(item => ({
      id: item.id, name: item.label, price: item.free ? { prompt: 0, completion: 0 } : null,
      free: item.free, ...(item.note ? { inputModalities: ['text'] } : {}),
    }));
  }
  if (id === 'openrouter') {
    const key = providerKey(record, env);
    const response = await fetch(`${record.baseUrl.replace(/\/+$/, '')}/models`, {
      method: 'GET', redirect: 'manual',
      headers: { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    });
    if (!response.ok) throw new ProviderError(502, 'MODELS_UNAVAILABLE', 'OpenRouter models endpoint did not return success.');
    const payload = await response.json() as { data?: any[] };
    const models = Array.isArray(payload.data) ? payload.data : [];
    return models.map(item => {
      const prompt = item?.pricing?.prompt;
      const completion = item?.pricing?.completion;
      const free = prompt !== undefined && completion !== undefined && Number(prompt) === 0 && Number(completion) === 0;
      return {
        id: String(item?.id ?? ''), ...(item?.name ? { name: String(item.name) } : {}),
        ...(Number.isFinite(Number(item?.context_length)) ? { contextLength: Number(item.context_length) } : {}),
        ...(Array.isArray(item?.architecture?.input_modalities) ? { inputModalities: item.architecture.input_modalities.map(String) } : {}),
        price: prompt !== undefined && completion !== undefined ? { prompt: Number(prompt), completion: Number(completion) } : null,
        free,
      };
    }).filter(model => model.id);
  }
  return [];
}

export async function testProvider(id: string, raw: unknown, env: Record<string, string | undefined> = process.env): Promise<AIProviderTestResponse> {
  const record = mergedProviders(env).find(item => item.id === id);
  if (!record) throw new ProviderError(404, 'PROVIDER_NOT_FOUND', 'Provider not found.');
  if (!consumeRate(`test:${id}`)) throw new ProviderError(429, 'RATE_LIMITED', 'Too many test requests; try again in a minute.');
  const input = testSchema.parse(raw);
  const key = providerKey(record, env);
  if (!key) return { ok: false, latencyMs: 0, error: 'No API key is configured for this provider.' };
  const started = Date.now();
  const defaults = resolveAIConfig(env);
  // Reuse the real request builder so provider identity headers (OpenCode Go's
  // User-Agent and x-opencode-session) and the provider-specific body are tested.
  const config: AIRuntimeConfig = {
    provider: record.adapter, model: input.model, state: 'ready', ready: true, keyPresent: true,
    endpointHost: new URL(record.baseUrl).host, timeoutMs: 15_000, maxOutputTokens: 64,
    requestsPerHour: defaults.requestsPerHour, costPolicy: 'operator-approved', approvedPaid: true,
    supportsImages: false, approvedPaidModels: [], baseUrl: record.baseUrl,
    providerLabel: record.label, ...(record.extraHeaders ? { extraHeaders: record.extraHeaders } : {}),
  };
  Object.defineProperty(config, 'apiKey', { value: key, enumerable: false });
  try {
    const built = buildProviderPayload(config, {
      system: 'Connectivity check. Reply with OK.', user: 'Reply OK', json: false,
      maxOutputTokens: 64, sessionId: `provider-test-${id}`,
    });
    const response = await fetch(built.url, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15_000),
      headers: built.headers, body: built.body,
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) return { ok: false, latencyMs, error: redactSecret(`Provider returned HTTP ${response.status}.`, key) };
    const payload = await response.json() as { model?: unknown; choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> };
    const choice = payload.choices?.[0];
    const content = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
    const finish = typeof choice?.finish_reason === 'string' ? choice.finish_reason : '';
    // Some reasoning models spend the small allowance before writing text; a
    // normal stop/length finish still proves the endpoint accepted the request.
    const ok = Boolean(content) || finish === 'stop' || finish === 'length';
    const answeredBy = typeof payload.model === 'string' ? payload.model : input.model;
    return { ok, latencyMs, ...(ok ? { answeredBy } : { error: 'Provider returned no text or finish reason.' }) };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: redactSecret((error as Error).message || 'Provider test failed.', key) };
  }
}

function buildEntryConfig(entry: AIChainEntryInput, env: Record<string, string | undefined>, defaults: AIRuntimeConfig): { config?: AIRuntimeConfig; target?: AIFallbackTarget; failure?: AIEntryFailure } {
  const record = mergedProviders(env).find(item => item.id === entry.providerId);
  if (!record) return { failure: 'invalid' };
  const key = providerKey(record, env);
  const free = freeState(entry.providerId, entry.model);
  const blockedPaid = env.AI_COST_POLICY !== 'operator-approved' && free !== true && !entry.paidApproved;
  const configured = Boolean(key) && record.enabled;
  const status: AIFallbackTarget['status'] = !configured ? 'not_configured' : blockedPaid ? 'blocked_paid' : 'ready';
  const failure: AIEntryFailure | undefined = !record.enabled ? 'disabled' : !key ? 'missing_key' : blockedPaid ? 'invalid' : undefined;
  const target: AIFallbackTarget = {
    provider: record.adapter as AIFallbackTarget['provider'], model: entry.model,
    label: `${entry.providerId}:${entry.model}`, providerLabel: record.label,
    configured, approvedPaid: entry.paidApproved,
    supportsImages: entry.vision, status, ...(failure ? { failure } : {}),
  };
  if (status !== 'ready' || !key) return { target, ...(failure ? { failure } : {}) };
  const config: AIRuntimeConfig = {
    provider: record.adapter, model: entry.model, state: 'ready', ready: true, keyPresent: true,
    endpointHost: new URL(record.baseUrl).host, timeoutMs: defaults.timeoutMs,
    maxOutputTokens: defaults.maxOutputTokens, requestsPerHour: defaults.requestsPerHour,
    costPolicy: defaults.costPolicy, approvedPaid: entry.paidApproved, supportsImages: entry.vision,
    approvedPaidModels: defaults.approvedPaidModels ?? [], baseUrl: record.baseUrl,
    providerLabel: record.id, ...(record.extraHeaders ? { extraHeaders: record.extraHeaders } : {}),
  };
  Object.defineProperty(config, 'apiKey', { value: key, enumerable: false });
  return { config, target: { ...target, config } };
}

/** Build the live chat config from the saved chain, or the env baseline when none is saved. */
export function resolveActiveConfig(env: Record<string, string | undefined> = process.env): AIRuntimeConfig {
  const state = readState(env);
  if (!state || !state.chain.length) return resolveAIConfig(env);
  const defaults = resolveAIConfig(env);
  const chain = state.chain;
  const primary = buildEntryConfig(chain[0], env, defaults);
  const fallbackTargets = chain.slice(1).map(entry => buildEntryConfig(entry, env, defaults).target).filter(Boolean) as AIFallbackTarget[];
  if (!primary.config) {
    const record = mergedProviders(env).find(item => item.id === chain[0].providerId);
    const failure = primary.failure ?? 'invalid';
    // A disabled record must say "turned off", not "no key": the key may be
    // present, the user only has to enable the provider in Settings.
    const configState = failure === 'disabled' ? 'disabled' : failure === 'missing_key' ? 'missing_key' : 'invalid_provider';
    return {
      ...defaults, provider: record?.adapter ?? 'none', model: chain[0].model, state: configState, ready: false,
      keyPresent: Boolean(record && providerKey(record, env)),
      providerLabel: record?.label ?? chain[0].providerId,
      fallbackTargets, fallbackModels: fallbackTargets.map(target => target.label),
    };
  }
  const config = primary.config;
  config.fallbackTargets = fallbackTargets;
  config.fallbackModels = fallbackTargets.map(target => target.label);
  return config;
}

/** Last provider call, for a chain entry's status (used by tests and capabilities). */
