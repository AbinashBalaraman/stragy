/**
 * Provider-manager contract shared by the server and the settings UI.
 * Key values are write-only: no response type in this file may contain a full key.
 */

export type AIProviderId = string;
export type AICostPolicy = 'free-only' | 'operator-approved';

export interface AIProviderPrice {
  prompt: number | null;
  completion: number | null;
}

export interface AIProviderPublic {
  id: AIProviderId;
  label: string;
  baseUrl: string;
  builtin: boolean;
  enabled: boolean;
  keySource: 'env' | 'stored' | 'none';
  /** Ellipsis plus the last four characters, or null. Never the full key. */
  keyHint: string | null;
  extraHeaderNames: string[];
}

export interface AIChainLastStatus {
  ok: boolean;
  at: string;
  error?: string;
  latencyMs?: number;
}

export interface AIChainEntryPublic {
  providerId: AIProviderId;
  model: string;
  vision: boolean;
  paidApproved: boolean;
  price: AIProviderPrice | null;
  free: boolean | null;
  lastStatus: AIChainLastStatus | null;
}

export interface AIProvidersResponse {
  providers: AIProviderPublic[];
  chain: AIChainEntryPublic[];
  costPolicy: AICostPolicy;
  writable: boolean;
  writeBlockedReason?: string;
  secretsStorage: 'encrypted' | 'unavailable';
  /** Ephemeral storage means saved settings disappear on redeploy. */
  persistence: 'ephemeral' | 'durable';
}

export interface AIProviderModelPublic {
  id: string;
  name?: string;
  contextLength?: number;
  inputModalities?: string[];
  price: AIProviderPrice | null;
  /** true zero-priced, false paid, null unknown. */
  free: boolean | null;
}

export interface AIProviderModelsResponse {
  models: AIProviderModelPublic[];
}

export interface AIProviderTestResponse {
  ok: boolean;
  latencyMs: number;
  answeredBy?: string;
  error?: string;
}

export interface AIChainEntryInput {
  providerId: AIProviderId;
  model: string;
  vision: boolean;
  paidApproved: boolean;
}

export interface AIChainUpdateInput {
  entries: AIChainEntryInput[];
}

export interface AIProviderWriteInput {
  id?: AIProviderId;
  label: string;
  baseUrl: string;
  /** Write-only. Omit or leave empty to keep the existing key. */
  apiKey?: string;
  /** Explicitly remove the stored key. */
  clearKey?: boolean;
  extraHeaders?: Record<string, string>;
  enabled: boolean;
}

export interface AIProviderWriteResponse {
  provider: AIProviderPublic;
}
