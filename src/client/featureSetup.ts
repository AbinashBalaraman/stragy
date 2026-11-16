import { ApiError, readJson } from './api';
import {
  FeatureSetupResponseSchema, type FeatureSetupResponse, type UserPreferences,
} from '../shared/contracts/featureRegistry';
import type { StrategyAST } from '../shared/strategy/types';

export interface FeatureSetupInput {
  message: string;
  currentStrategy: StrategyAST;
  preferences?: UserPreferences;
}

/**
 * Ask the copilot to fill a feature setup from one message plus remembered
 * preferences. The server validates the complete filled setup before replying;
 * this client validates the reply shape again.
 */
export async function requestFeatureSetup(input: FeatureSetupInput, signal?: AbortSignal): Promise<FeatureSetupResponse> {
  const controller = new AbortController();
  const relay = () => controller.abort(signal?.reason ?? new DOMException('Request cancelled', 'AbortError'));
  if (signal?.aborted) relay(); else signal?.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(() => controller.abort(new ApiError('Feature setup deadline exceeded. Nothing was run.', 'CLIENT_DEADLINE')), 20_000);
  try {
    const response = await fetch('/api/v2/feature-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const parsed = FeatureSetupResponseSchema.safeParse(await readJson(response));
    if (!parsed.success) throw new ApiError('The feature setup reply was invalid. Nothing was run.', 'INVALID_RESPONSE');
    return parsed.data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
}
