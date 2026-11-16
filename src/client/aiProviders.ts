import { ApiError, readJson } from './api';
import type {
  AIChainEntryInput,
  AIProviderModelsResponse,
  AIProviderTestResponse,
  AIProviderWriteInput,
  AIProviderWriteResponse,
  AIProvidersResponse,
} from '../shared/contracts/aiProviders';

const REQUEST_TIMEOUT_MS = 60_000;

async function call(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const relay = () => controller.abort(signal?.reason ?? new DOMException('Request cancelled', 'AbortError'));
  if (signal?.aborted) relay(); else signal?.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(() => controller.abort(new ApiError('The provider settings request timed out. Nothing was changed.', 'CLIENT_DEADLINE')), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
}

async function json<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  return await readJson(await call(path, init, signal)) as T;
}

async function empty(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<void> {
  const response = await call(path, init, signal);
  if (!response.ok) await readJson(response);
}

export async function getAIProviders(signal?: AbortSignal): Promise<AIProvidersResponse> {
  return await json<AIProvidersResponse>('/api/v2/ai/providers', {}, signal);
}

export async function createAIProvider(input: AIProviderWriteInput): Promise<AIProviderWriteResponse> {
  return await json<AIProviderWriteResponse>('/api/v2/ai/providers', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateAIProvider(id: string, input: AIProviderWriteInput): Promise<AIProviderWriteResponse> {
  return await json<AIProviderWriteResponse>('/api/v2/ai/providers/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(input) });
}

export async function deleteAIProvider(id: string): Promise<void> {
  await empty('/api/v2/ai/providers/' + encodeURIComponent(id), { method: 'DELETE' });
}

export async function getAIProviderModels(id: string, signal?: AbortSignal): Promise<AIProviderModelsResponse> {
  return await json<AIProviderModelsResponse>('/api/v2/ai/providers/' + encodeURIComponent(id) + '/models', {}, signal);
}

export async function testAIProviderModel(id: string, model: string): Promise<AIProviderTestResponse> {
  return await json<AIProviderTestResponse>('/api/v2/ai/providers/' + encodeURIComponent(id) + '/test', {
    method: 'POST',
    body: JSON.stringify({ model }),
  });
}

export async function saveAIChain(entries: AIChainEntryInput[]): Promise<AIProvidersResponse> {
  return await json<AIProvidersResponse>('/api/v2/ai/chain', { method: 'PUT', body: JSON.stringify({ entries }) });
}

export async function resetAIProviders(): Promise<AIProvidersResponse> {
  return await json<AIProvidersResponse>('/api/v2/ai/reset', { method: 'POST' });
}
