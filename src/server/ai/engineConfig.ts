/**
 * OpenCode engine configuration, generated from Stragy's existing provider
 * registry. Nothing here talks to a provider: it only turns the registry's
 * current chain, keys and paid approvals into the JSON document the embedded
 * OpenCode host reads at boot.
 *
 * Shape notes (verified against @opencode/sdk 2.3.2, the version installed):
 * - A provider needs `package: "aisdk:<npm package>"`; the legacy `npm` field is
 *   ignored by this host. @ai-sdk/openai-compatible is a real dependency.
 * - Credentials are referenced as `{env:NAME}` so the generated file on disk
 *   never contains a secret. Stored (encrypted) registry keys are decrypted by
 *   the registry for us and exported to a process-local environment variable
 *   with that name for the lifetime of the server.
 * - The engine gets one dedicated agent whose system prompt is the Stragy
 *   research contract, and every tool that could touch the host machine is
 *   denied: the engine may only use Stragy's own plugin tools.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { OPENCODE_GO_MODELS, isOpenCodeGoFreeModel } from './provider';
import { getProvidersResponse, resolveActiveConfig } from './providerRegistry';

export const ENGINE_AGENT_ID = 'stragy';
export const ENGINE_PROVIDER_PACKAGE = 'aisdk:@ai-sdk/openai-compatible';
export const ENGINE_MODEL_LIMIT = { context: 131_072, output: 8_192 } as const;

/** The model catalog the engine exposes, in preference order. */
export const ENGINE_FREE_MODELS = [
  { providerId: 'opencode-go', model: 'hy4-flash-free', label: 'HY4 Flash (free)' },
  { providerId: 'openrouter', model: 'openrouter/free', label: 'OpenRouter free' },
] as const;

const PAID_CANDIDATES = [
  { providerId: 'deepseek', model: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash (paid)' },
  { providerId: 'opencode-go', model: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash (paid)' },
] as const;

/**
 * Tools the engine must never have: a research assistant does not need a shell,
 * files, the repo, the network or subagents. Denying unknown action names is
 * harmless; the ones that exist are refused before execution.
 */
export const ENGINE_DENIED_ACTIONS = [
  'shell', 'bash', 'edit', 'write', 'patch', 'read', 'glob', 'grep', 'list',
  'webfetch', 'websearch', 'task', 'execute', 'question',
] as const;

export const ENGINE_PERMISSION_RULES = ENGINE_DENIED_ACTIONS.map(action => ({
  action,
  resource: '*',
  effect: 'deny' as const,
}));

/**
 * Stragy's research contract for every engine session. Plain English, honest
 * about partial coverage, and explicit that data comes from tools only.
 */
export const ENGINE_SYSTEM_PROMPT = [
  'You are Stragy, a research assistant for Indian NSE/BSE daily-bar equity research.',
  '',
  'Hard rules:',
  '- Never invent prices, volumes, indicator values, dates, symbols or backtest numbers. Every number must come from a tool result you received in this conversation.',
  '- Coverage is partial and data is delayed/end-of-day. Say "unavailable" or "not checked" honestly instead of guessing; mention the tool\'s warnings when they matter.',
  '- You have no shell, no file access and no internet. Use only the Stragy tools (for example read_chart, scan_market, get_scan_result, check_symbol, get_data_cache, get_price_history, propose_strategy_edit, run_backtest and their result tools).',
  '- You cannot place orders or move money. This is research only.',
  '',
  'Data and cache:',
  '- Before a broad scan, call get_data_cache once. It is free and network-free. Report configured vs cached symbols and the cold/warm estimate, then choose a sensible maxSymbols.',
  '- For one or two symbols use check_symbol, get_price_history, compute_indicators or get_quote. Do not scan a universe to answer about one ticker.',
  '- "Why didn\'t X match?" is one check_symbol with the same entry rules, not a rescan. If a rule change is being refined, check the near-misses from the finished scan first; rescan only when that cannot answer it.',
  '- Never claim full-universe coverage. Say the evaluated window precisely, for example "first 200 of 2,051 configured NSE symbols", and say whether the data came from cache or a provider fetch.',
  '- get_quote: close is the latest observed daily close, never live. Only liveLtp is a live quote. Quotes are not cached.',
  '- refresh_market_data only queues a background warm-up. Call get_refresh_result for progress; never wait for it inline or invent its ETA.',
  '',
  'Tool workflow:',
  '- Chart screenshot: call read_chart (an image attached in this turn is referenced by imageId). Then call get_chart_result with that jobId until it is succeeded or failed. A chart read needs the current workspace strategy to preserve exits, risk, sizing and costs.',
  '- Universe scan: call scan_market with a validated strategy and universe. maxSymbols bounds the evaluated subset; limit only paginates matched rows. Then call get_scan_result with the jobId until it finishes. While it is running, call the result tool again immediately without writing a progress paragraph between polls; state an ETA only when the tool computed one from real progress.',
  '- Strategy change: call propose_strategy_edit with the complete candidate strategy. It returns a draft proposal only. Nothing is applied or saved; the operator reviews it in the UI.',
  '- Backtest: first state the assumptions in plain English (universe, entry/exit rules, stop loss, sizing, costs, data window, starting capital). run_backtest is gated: without an operator approval it returns approval_required and the assumptions to review. Never claim a backtest ran before you have a succeeded job result.',
  '',
  'Answer style:',
  '- Plain English first, then the specific numbers the tools returned. Short paragraphs. No hype, no advice framing beyond research.',
  '- When a tool fails, say what failed and what the user can do next; do not silently substitute a made-up answer.',
  '- If a question is conceptual (for example "what is a stop loss?"), answer it directly without tools, in one or two sentences.',
].join('\n');

export interface EngineModelEntry {
  providerId: string;
  model: string;
  label: string;
  free: boolean;
  paidApproved: boolean;
  /** True when the registry chain (not the built-in catalog) supplied it. */
  fromChain: boolean;
}

export interface BuiltEngineConfig {
  /** Document written to .data/opencode/config/opencode.json. */
  config: Record<string, unknown>;
  /** null when no provider has a usable key; the engine then reports ENGINE_UNAVAILABLE. */
  defaultModel: { providerID: string; model: string } | null;
  models: EngineModelEntry[];
  /** Secrets that must be placed in process.env before the host starts. Never written to disk. */
  env: Record<string, string>;
  warnings: string[];
}

interface ProviderRecord {
  id: string;
  label: string;
  baseUrl: string;
  enabled: boolean;
  keySource?: 'env' | 'stored' | 'none';
  extraHeaderNames?: string[];
}

/** Built-in provider id to its documented environment key (mirrors providerRegistry). */
const KEY_ENV: Record<string, string> = {
  'opencode-go': 'OPENCODE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  tokenrouter: 'TOKENROUTER_API_KEY',
};

function envKeyName(env: Record<string, string | undefined>, record: ProviderRecord): string | null {
  const name = KEY_ENV[record.id];
  if (name && (env[name] ?? '').trim()) return name;
  // Custom providers have no documented environment name; a stored encrypted
  // key reaches the engine through the active-chain runtime config instead.
  return null;
}

function engineEnvName(providerId: string): string {
  return 'STRAGY_ENGINE_KEY_' + providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function approvedPaid(env: Record<string, string | undefined>): Set<string> {
  return new Set(String(env.AI_APPROVED_PAID_MODELS ?? '').split(',').map(value => value.trim()).filter(Boolean));
}

function freeModelEntry(providerId: string, model: string): { label: string; free: boolean } | null {
  const catalog = OPENCODE_GO_MODELS.find(item => item.id === model);
  const free = providerId === 'opencode-go'
    ? isOpenCodeGoFreeModel(model)
    : providerId === 'openrouter' ? model === 'openrouter/free' : false;
  return { label: catalog?.label ?? model, free };
}

function keyFor(record: ProviderRecord, env: Record<string, string | undefined>, decrypted: Map<string, string>, built: BuiltEngineConfig): string | null {
  const envName = envKeyName(env, record);
  if (envName) return `{env:${envName}}`;
  const stored = decrypted.get(record.id);
  if (stored) {
    const name = engineEnvName(record.id);
    built.env[name] = stored;
    return `{env:${name}}`;
  }
  return null;
}

/**
 * Build the host config. Pure with respect to process state: keys that came
 * from the encrypted registry are returned in `env`, not applied here.
 */
export function buildEngineConfig(env: Record<string, string | undefined> = process.env): BuiltEngineConfig {
  const built: BuiltEngineConfig = { config: {}, defaultModel: null, models: [], env: {}, warnings: [] };
  const response = getProvidersResponse(env);
  const active = resolveActiveConfig(env);
  const chainEntries = response.chain ?? [];
  const approved = approvedPaid(env);

  // Decrypted keys for the active chain only. The public registry response has
  // key hints, never keys; the runtime config carries the real secret as a
  // non-enumerable property (see providerRegistry.buildEntryConfig).
  const decrypted = new Map<string, string>();
  const byBaseUrl = new Map<string, string>();
  for (const record of response.providers) byBaseUrl.set(record.baseUrl.replace(/\/+$/, ''), record.id);
  const collect = (candidate: { baseUrl?: string; providerLabel?: string; apiKey?: string } | undefined) => {
    if (!candidate) return;
    const base = candidate.baseUrl?.replace(/\/+$/, '') ?? '';
    const id = byBaseUrl.get(base) ?? (candidate.providerLabel && response.providers.some(p => p.id === candidate.providerLabel) ? candidate.providerLabel : undefined);
    if (id && candidate.apiKey) decrypted.set(id, candidate.apiKey);
  };
  collect(active as unknown as { baseUrl?: string; providerLabel?: string; apiKey?: string });
  for (const target of active.fallbackTargets ?? []) collect(target.config as unknown as { baseUrl?: string; providerLabel?: string; apiKey?: string });

  const records = response.providers.map(provider => ({ ...provider }) as ProviderRecord);
  const modelsByProvider = new Map<string, EngineModelEntry[]>();
  const addModel = (providerId: string, model: string, label: string, free: boolean, fromChain: boolean, chainApproved = false) => {
    const paid = !free;
    const approvalLabel = `${providerId}:${model}`;
    // Owner directive (18 Nov 2026): expose free models plus DeepSeek V4.1
    // Flash from the paid tier only. Other paid models stay hidden until the
    // owner asks for them, even if a provider catalog or approval env names them.
    if (paid && model !== 'deepseek-v4.1-flash') return;
    if (paid && !approved.has(approvalLabel) && !chainApproved) return;
    const list = modelsByProvider.get(providerId) ?? [];
    if (list.some(entry => entry.model === model)) return;
    list.push({ providerId, model, label, free, paidApproved: free ? false : approved.has(approvalLabel), fromChain });
    modelsByProvider.set(providerId, list);
    built.models.push(list.at(-1)!);
  };

  // Catalog entries the engine is allowed to use.
  for (const entry of ENGINE_FREE_MODELS) {
    if (response.providers.some(provider => provider.id === entry.providerId)) {
      addModel(entry.providerId, entry.model, entry.label, true, false);
    }
  }
  for (const entry of PAID_CANDIDATES) {
    if (response.providers.some(provider => provider.id === entry.providerId)) {
      const free = freeModelEntry(entry.providerId, entry.model)?.free ?? false;
      addModel(entry.providerId, entry.model, entry.label, free, false);
    }
  }
  // Saved chain entries (custom providers included) are honoured when the
  // registry considers them free or explicitly approved.
  for (const entry of chainEntries) {
    const provider = response.providers.find(item => item.id === entry.providerId);
    if (!provider) continue;
    const free = entry.free === true;
    if (!free && !entry.paidApproved && !approved.has(`${entry.providerId}:${entry.model}`)) continue;
    addModel(entry.providerId, entry.model, entry.model, free, true, entry.paidApproved);
  }

  const providers: Record<string, unknown> = {};
  for (const record of records) {
    if (!record.enabled) continue;
    const models = modelsByProvider.get(record.id);
    if (!models?.length) continue;
    const apiKey = keyFor(record, env, decrypted, built);
    if (!apiKey) {
      built.warnings.push(`Provider ${record.id} has no API key; its models are not exposed to the engine.`);
      continue;
    }
    if (record.extraHeaderNames?.length) {
      built.warnings.push(`Provider ${record.id} defines extra headers; they are not forwarded by the embedded engine.`);
    }
    providers[record.id] = {
      name: record.label,
      package: ENGINE_PROVIDER_PACKAGE,
      settings: { baseURL: record.baseUrl.replace(/\/+$/, ''), apiKey },
      models: Object.fromEntries(models.map(entry => [entry.model, {
        name: entry.label,
        limit: ENGINE_MODEL_LIMIT,
        ...(entry.free ? { cost: { input: 0, output: 0 } } : {}),
      }])),
    };
  }

  const usable = (entry: EngineModelEntry) => Boolean(providers[entry.providerId]);
  const ordered = [
    ...built.models.filter(entry => entry.free),
    ...built.models.filter(entry => !entry.free && entry.paidApproved),
  ].filter(usable);
  for (const entry of ENGINE_FREE_MODELS) {
    const found = ordered.find(item => item.providerId === entry.providerId && item.model === entry.model);
    if (found) { built.defaultModel = { providerID: found.providerId, model: found.model }; break; }
  }
  if (!built.defaultModel) {
    const first = ordered[0];
    if (first) built.defaultModel = { providerID: first.providerId, model: first.model };
  }
  if (!built.defaultModel) built.warnings.push('No enabled free (or explicitly approved paid) model has an API key.');

  built.config = {
    $schema: 'https://opencode.ai/config.json',
    ...(built.defaultModel ? { model: { providerID: built.defaultModel.providerID, model: built.defaultModel.model } } : {}),
    providers,
    default_agent: ENGINE_AGENT_ID,
    agents: {
      [ENGINE_AGENT_ID]: {
        description: 'Stragy research assistant (NSE/BSE daily bars)',
        mode: 'primary',
        ...(built.defaultModel ? { model: { providerID: built.defaultModel.providerID, model: built.defaultModel.model } } : {}),
        system: ENGINE_SYSTEM_PROMPT,
        steps: 24,
        permissions: ENGINE_PERMISSION_RULES,
      },
    },
    // The todo tool is the one built-in we want: it exposes the plan the user sees.
    experimental: { todo: true },
    // Deny the host-machine tools globally as well as on the agent.
    permissions: ENGINE_PERMISSION_RULES,
    share: 'disabled',
    snapshots: false,
    formatter: false,
    lsp: false,
    watcher: { ignore: ['**'] },
  };
  return built;
}

/** Write the generated document; the directory is gitignored under .data/. */
export async function writeEngineConfig(dir: string, built: BuiltEngineConfig): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'opencode.json');
  await fs.writeFile(file, JSON.stringify(built.config, null, 2) + '\n', 'utf8');
  return file;
}
