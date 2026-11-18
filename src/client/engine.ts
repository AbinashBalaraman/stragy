import { z } from 'zod';

/**
 * Typed client for the durable OpenCode engine sessions (Agent B's REST block):
 *
 *   POST /api/v2/engine/sessions                     -> { sessionId }
 *   GET  /api/v2/engine/sessions                     -> { sessions: [...] }
 *   POST /api/v2/engine/sessions/:id/messages        -> 202
 *   GET  /api/v2/engine/sessions/:id/messages        -> { messages, lastSeq }
 *   GET  /api/v2/engine/sessions/:id/events?after=N  -> SSE, replay then live
 *   POST /api/v2/engine/sessions/:id/interrupt
 *
 * The chat client persists { sessionId, lastSeq } in this browser, fetches the
 * full message list on load and resubscribes from the stored cursor, so a
 * server restart or a closed tab neither loses the conversation nor replays
 * events into duplicates. This module is deliberately standalone (no import
 * from api.ts) so chat component tests that mock api.ts keep working, and so the
 * engine route can 404 cleanly while Agent B lands.
 */

export const ENGINE_SESSION_KEY = 'stragy.engine.session';
export const ENGINE_EVENTS_SUPPORTED = typeof EventSource !== 'undefined';

export class EngineError extends Error {
  constructor(message: string, public code = 'ENGINE_FAILED', public status = 0) {
    super(message);
  }
}

/** The engine REST block is absent (server not restarted with Agent B's code). */
export function isEngineUnavailable(error: unknown): boolean {
  return error instanceof EngineError && (error.status === 404 || error.code === 'ENGINE_NOT_DEPLOYED');
}

/** A transient failure the caller may retry (network, 5xx, timeout). */
export function isEngineTransient(error: unknown): boolean {
  if (!(error instanceof EngineError)) return false;
  return error.status === 0 || error.status === 429 || error.status >= 500;
}

export interface StoredEngineSession {
  sessionId: string;
  lastSeq: number;
}

const SessionReceipt = z.object({ sessionId: z.string().min(1).max(200) }).passthrough();

const ModelChoice = z.object({
  providerID: z.string().min(1).max(100),
  id: z.string().min(1).max(200),
}).passthrough();

const TokenCounts = z.object({
  input: z.number().finite().min(0).optional(),
  output: z.number().finite().min(0).optional(),
  reasoning: z.number().finite().min(0).optional(),
}).passthrough();

const SessionEntry = z.object({
  sessionId: z.string().min(1).max(200),
  title: z.string().max(500).optional(),
  updatedAt: z.union([z.string(), z.number()]).optional(),
  messageCount: z.number().int().min(0).optional(),
  model: ModelChoice.partial().optional(),
  cost: z.number().finite().min(0).optional(),
  tokens: TokenCounts.optional(),
}).passthrough();

export interface EngineSessionSummary {
  sessionId: string;
  title?: string;
  updatedAt?: string | number;
  messageCount?: number;
  model?: { providerID?: string; id?: string };
  cost?: number;
  tokens?: { input?: number; output?: number; reasoning?: number };
}

export type EngineToolStatus = 'called' | 'running' | 'success' | 'failed';

/** Normalized tool activity emitted with an engine turn (Agent B's contract). */
export interface EngineToolActivity {
  type: 'tool';
  name: string;
  status: EngineToolStatus;
  summary?: string;
  durationMs?: number;
  error?: { code?: string; message?: string };
  callId?: string;
  /** Server-reported attempt count for a polling tool. */
  attempts?: number;
}

export type EngineTodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface EngineTodoItem {
  content: string;
  status: EngineTodoStatus;
}

const TOOL_STATUS_ALIASES: Record<string, EngineToolStatus> = {
  pending: 'called', queued: 'called', called: 'called', requested: 'called',
  running: 'running', started: 'running', in_progress: 'running', 'in-progress': 'running', working: 'running',
  success: 'success', succeeded: 'success', completed: 'success', complete: 'success', done: 'success',
  failed: 'failed', failure: 'failed', error: 'failed', cancelled: 'failed', canceled: 'failed',
};

const TODO_STATUS_ALIASES: Record<string, EngineTodoStatus> = {
  pending: 'pending', todo: 'pending', open: 'pending', queued: 'pending',
  in_progress: 'in_progress', 'in-progress': 'in_progress', active: 'in_progress', running: 'in_progress', doing: 'in_progress',
  completed: 'completed', complete: 'completed', done: 'completed', success: 'completed',
  cancelled: 'cancelled', canceled: 'cancelled', skipped: 'cancelled', stopped: 'cancelled',
};

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 2000) : undefined;
}

/**
 * Accept the normalized shape, a single entry, or an array; status aliases are
 * mapped and malformed entries are dropped instead of failing the whole turn.
 */
export function normalizeToolActivities(input: unknown): EngineToolActivity[] {
  const raw = Array.isArray(input) ? input : [input];
  const entries: EngineToolActivity[] = [];
  for (const candidate of raw) {
    const item = recordOf(candidate);
    if (!item) continue;
    const name = textOf(item.name) ?? textOf(item.tool);
    if (!name) continue;
    const status = TOOL_STATUS_ALIASES[String(item.status ?? '').trim().toLowerCase()] ?? 'running';
    const errorRecord = recordOf(item.error);
    const error = errorRecord && (textOf(errorRecord.code) || textOf(errorRecord.message))
      ? { ...(textOf(errorRecord.code) ? { code: textOf(errorRecord.code)! } : {}), ...(textOf(errorRecord.message) ? { message: textOf(errorRecord.message)! } : {}) }
      : undefined;
    const duration = typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) && item.durationMs >= 0
      ? Math.min(item.durationMs, 86_400_000)
      : undefined;
    entries.push({
      type: 'tool',
      name: name.slice(0, 100),
      status,
      ...(textOf(item.summary) ? { summary: textOf(item.summary)! } : {}),
      ...(duration !== undefined ? { durationMs: duration } : {}),
      ...(error ? { error } : {}),
      ...(textOf(item.callId) ?? textOf(item.id) ? { callId: (textOf(item.callId) ?? textOf(item.id))! } : {}),
      ...(typeof item.attempts === 'number' && Number.isFinite(item.attempts) && item.attempts > 1 ? { attempts: Math.min(Math.floor(item.attempts), 10_000) } : {}),
    });
    if (entries.length >= 40) break;
  }
  return entries;
}

/** Accept `{ todos: [...] }`, a todo tool result, or an already-flat list. */
export function normalizeEngineTodos(input: unknown): EngineTodoItem[] {
  const container = recordOf(input);
  const raw = Array.isArray(input) ? input : Array.isArray(container?.todos) ? container!.todos as unknown[] : Array.isArray(container?.items) ? container!.items as unknown[] : [];
  const items: EngineTodoItem[] = [];
  for (const candidate of raw) {
    if (typeof candidate === 'string') {
      const content = candidate.trim();
      if (content) items.push({ content: content.slice(0, 500), status: 'pending' });
      continue;
    }
    const item = recordOf(candidate);
    if (!item) continue;
    const content = textOf(item.content) ?? textOf(item.text) ?? textOf(item.title) ?? textOf(item.todo);
    if (!content) continue;
    const status = TODO_STATUS_ALIASES[String(item.status ?? '').trim().toLowerCase()] ?? 'pending';
    items.push({ content: content.slice(0, 500), status });
    if (items.length >= 100) break;
  }
  return items;
}

/**
 * One durable engine message. `payload` carries the adapter output with the
 * exact legacy ResearchChatResponse shape (so the cards read it unchanged);
 * `result` carries a tool output (ScanResult, BacktestResponse, ...). Both are
 * validated by the components that render them, never here.
 */
const EngineMessageSchema = z.object({
  id: z.string().min(1).max(200),
  role: z.enum(['user', 'assistant', 'tool']),
  text: z.string().max(30_000).optional(),
  timestamp: z.number().finite().optional(),
  payload: z.unknown().optional(),
  result: z.unknown().optional(),
  tool: z.string().max(100).optional(),
  job: z.object({
    id: z.string().min(1).max(200),
    kind: z.string().max(40).optional(),
    status: z.string().max(40).optional(),
  }).passthrough().optional(),
  approval: z.object({
    id: z.string().min(1).max(200),
    tool: z.string().max(100).optional(),
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    title: z.string().max(500).optional(),
    summary: z.array(z.string().max(1000)).max(50).optional(),
  }).passthrough().optional(),
  /** Normalized per-turn tool activity; validated by normalizeToolActivities. */
  activity: z.unknown().optional(),
  /** The engine's plan checklist; validated by normalizeEngineTodos. */
  todos: z.unknown().optional(),
  durationMs: z.number().finite().min(0).max(86_400_000).optional(),
  error: z.object({ code: z.string().max(100).optional(), message: z.string().max(2000).optional(), jobId: z.string().max(200).optional() }).passthrough().optional(),
  seq: z.number().int().min(0).optional(),
}).passthrough();

export type EngineMessage = z.infer<typeof EngineMessageSchema>;

export type EngineEventType = 'message' | 'status' | 'error' | 'idle' | 'job' | 'tool' | 'todo' | 'connected';

export interface EngineEvent {
  seq: number;
  type: EngineEventType;
  message?: EngineMessage;
  /** Engine turn state: "working" or "idle". */
  status?: string;
  error?: string;
  job?: { id: string; kind?: string; status?: string };
  activity?: EngineToolActivity;
  /** Multiple entries when a stream event batches one turn's tool calls. */
  activities?: EngineToolActivity[];
  todos?: EngineTodoItem[];
}

const MessageList = z.object({
  messages: z.array(z.unknown()).max(2000),
  lastSeq: z.number().int().min(0).optional(),
}).passthrough();

export interface EngineMessagePage {
  messages: EngineMessage[];
  lastSeq: number;
}

function now(): number { return Date.now(); }

async function boundedFetch(url: string, init: RequestInit, signal: AbortSignal | undefined, timeoutMs: number, label: string): Promise<Response> {
  const controller = new AbortController();
  const relay = () => controller.abort(signal?.reason ?? new DOMException('Request cancelled', 'AbortError'));
  if (signal?.aborted) relay(); else signal?.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(() => controller.abort(new EngineError(label + ' timed out. Try again.', 'ENGINE_TIMEOUT')), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (caught) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Request cancelled', 'AbortError');
    if (caught instanceof EngineError) throw caught;
    throw new EngineError(label + ' could not reach the server. Try again.', 'ENGINE_UNREACHABLE');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
}

async function request<T>(url: string, init: RequestInit, parse: (raw: unknown) => T, label: string, signal?: AbortSignal, timeoutMs = 15_000): Promise<T> {
  const response = await boundedFetch(url, init, signal, timeoutMs, label);
  let raw: unknown = null;
  try { raw = await response.json(); } catch {
    if (response.ok) throw new EngineError(label + ' returned an invalid response.', 'ENGINE_INVALID_RESPONSE', response.status);
  }
  if (!response.ok) {
    const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const error = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : undefined;
    const message = typeof error?.message === 'string' ? error.message
      : typeof body.error === 'string' ? body.error
        : response.status === 404 ? 'Engine session routes are not available on this server.'
          : label + ' failed (' + response.status + ').';
    throw new EngineError(message, typeof error?.code === 'string' ? error.code : 'ENGINE_FAILED', response.status);
  }
  return parse(raw);
}

const sessionIdPath = (sessionId: string) => '/api/v2/engine/sessions/' + encodeURIComponent(sessionId);

export async function createEngineSession(signal?: AbortSignal, model?: { providerID: string; model: string }): Promise<string> {
  const receipt = await request('/api/v2/engine/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(model ? { model } : {}),
  }, raw => SessionReceipt.parse(raw), 'Creating an engine session', signal, 20_000);
  return receipt.sessionId;
}

/**
 * The session list. `query` is the history search: the server filters, the
 * client never filters a cached page into a different answer.
 */
export async function listEngineSessions(query?: string, signal?: AbortSignal): Promise<EngineSessionSummary[]> {
  const search = query?.trim();
  const url = '/api/v2/engine/sessions' + (search ? '?q=' + encodeURIComponent(search) : '');
  const data = await request(url, { method: 'GET' }, raw => {
    const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    return z.array(SessionEntry).max(200).parse(body.sessions ?? []);
  }, 'Listing engine sessions', signal);
  return data.map(entry => ({
    sessionId: entry.sessionId,
    ...(entry.title ? { title: entry.title } : {}),
    ...(entry.updatedAt !== undefined ? { updatedAt: entry.updatedAt } : {}),
    ...(entry.messageCount !== undefined ? { messageCount: entry.messageCount } : {}),
    ...(entry.model ? { model: entry.model } : {}),
    ...(entry.cost !== undefined ? { cost: entry.cost } : {}),
    ...(entry.tokens ? { tokens: entry.tokens } : {}),
  }));
}

/** Rename a durable session; the server keeps the old title when it rejects. */
export async function renameEngineSession(sessionId: string, title: string, signal?: AbortSignal): Promise<EngineSessionSummary | null> {
  const data = await request(sessionIdPath(sessionId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  }, raw => {
    const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const parsed = SessionEntry.safeParse(body.session);
    return parsed.success ? parsed.data : null;
  }, 'Renaming the chat', signal);
  if (!data) return null;
  return {
    sessionId: data.sessionId,
    ...(data.title ? { title: data.title } : {}),
    ...(data.updatedAt !== undefined ? { updatedAt: data.updatedAt } : {}),
    ...(data.model ? { model: data.model } : {}),
    ...(data.cost !== undefined ? { cost: data.cost } : {}),
    ...(data.tokens ? { tokens: data.tokens } : {}),
  };
}

export async function deleteEngineSession(sessionId: string, signal?: AbortSignal): Promise<void> {
  await request(sessionIdPath(sessionId), { method: 'DELETE' }, () => undefined, 'Deleting the chat', signal);
}

/** Switch the model a session runs on. The server validates paid approval. */
export async function switchEngineModel(
  sessionId: string,
  choice: { providerID: string; model: string },
  signal?: AbortSignal,
): Promise<EngineSessionSummary | null> {
  const data = await request(sessionIdPath(sessionId) + '/model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(choice),
  }, raw => {
    const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const parsed = SessionEntry.safeParse(body.session);
    return parsed.success ? parsed.data : null;
  }, 'Switching the model', signal);
  if (!data) return null;
  return {
    sessionId: data.sessionId,
    ...(data.title ? { title: data.title } : {}),
    ...(data.updatedAt !== undefined ? { updatedAt: data.updatedAt } : {}),
    ...(data.model ? { model: data.model } : {}),
  };
}

export interface EngineModel {
  providerID: string;
  id: string;
  label: string;
  free: boolean | null;
  approvedPaid: boolean;
  default: boolean;
}

export interface EngineModels {
  models: EngineModel[];
  default: { providerID: string; model: string } | null;
}

const ModelRecord = z.object({
  providerID: z.string().min(1).max(100),
  id: z.string().min(1).max(200),
  label: z.string().max(200).optional(),
  free: z.boolean().optional(),
  approvedPaid: z.boolean().optional(),
  default: z.boolean().optional(),
}).passthrough();

export async function listEngineModels(signal?: AbortSignal): Promise<EngineModels> {
  return request('/api/v2/engine/models', { method: 'GET' }, raw => {
    const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const seen = new Set<string>();
    const models = z.array(ModelRecord).max(100).parse(body.models ?? []).flatMap(entry => {
      const key = entry.providerID + '/' + entry.id;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        providerID: entry.providerID,
        id: entry.id,
        label: entry.label?.trim() || entry.id,
        free: entry.free ?? null,
        approvedPaid: entry.approvedPaid === true,
        default: entry.default === true,
      }];
    });
    const fallback = body.default && typeof body.default === 'object' ? body.default as Record<string, unknown> : null;
    const providerID = typeof fallback?.providerID === 'string' ? fallback.providerID : '';
    const model = typeof fallback?.model === 'string' ? fallback.model : typeof fallback?.id === 'string' ? fallback.id : '';
    return { models, default: providerID && model ? { providerID, model } : null };
  }, 'Listing models', signal);
}

export interface EngineUsageSession {
  sessionId: string;
  title?: string;
  cost?: number;
  tokens?: { input?: number; output?: number };
}

export interface EngineUsageModel {
  providerID?: string;
  id?: string;
  label?: string;
  cost?: number;
  tokens?: { input?: number; output?: number };
}

export interface EngineUsageStats {
  sessions: number;
  prompts: number;
  steps: number;
  tokens: { input?: number; output?: number };
  cost: number | null;
  models: EngineUsageModel[];
}

export interface EngineUsage {
  /** null when the SDK stats call failed; never coerced into zeros. */
  stats: EngineUsageStats | null;
  warnings: string[];
  limits: unknown;
  sessions: EngineUsageSession[];
  /** Present only when the server scoped the report to a window. */
  windowDays?: number;
  since?: string;
}

export async function getEngineUsage(signal?: AbortSignal): Promise<EngineUsage> {
  return request('/api/v2/engine/usage', { method: 'GET' }, raw => {
    const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const rawStats = body.stats && typeof body.stats === 'object' ? body.stats as Record<string, unknown> : null;
    const tokens = rawStats?.tokens && typeof rawStats.tokens === 'object' ? rawStats.tokens as Record<string, unknown> : {};
    const sessions = Array.isArray(body.sessions) ? body.sessions : [];
    const warnings = Array.isArray(body.warnings)
      ? body.warnings.flatMap(warning => typeof warning === 'string' && warning.trim() ? [warning.trim().slice(0, 300)] : []).slice(0, 10)
      : [];
    return {
      stats: rawStats ? {
        sessions: typeof rawStats.sessions === 'number' ? rawStats.sessions : 0,
        prompts: typeof rawStats.prompts === 'number' ? rawStats.prompts : 0,
        steps: typeof rawStats.steps === 'number' ? rawStats.steps : 0,
        tokens: {
          ...(typeof tokens.input === 'number' ? { input: tokens.input } : {}),
          ...(typeof tokens.output === 'number' ? { output: tokens.output } : {}),
        },
        cost: typeof rawStats.cost === 'number' && Number.isFinite(rawStats.cost) ? rawStats.cost : null,
        models: (Array.isArray(rawStats.models) ? rawStats.models : []).flatMap(candidate => {
          if (!candidate || typeof candidate !== 'object') return [];
          const item = candidate as Record<string, unknown>;
          const itemTokens = item.tokens && typeof item.tokens === 'object' ? item.tokens as Record<string, unknown> : {};
          // The SDK reports `{model:{id,providerID,variant},steps,tokens,cost}`.
          const nested = item.model && typeof item.model === 'object' ? item.model as Record<string, unknown> : null;
          const providerID = typeof item.providerID === 'string' ? item.providerID : typeof nested?.providerID === 'string' ? nested.providerID : '';
          const id = typeof item.id === 'string' ? item.id : typeof nested?.id === 'string' ? nested.id : '';
          const label = typeof item.label === 'string' ? item.label : typeof nested?.label === 'string' ? nested.label : id;
          return [{
            ...(providerID ? { providerID } : {}),
            ...(id ? { id } : {}),
            ...(label ? { label } : {}),
            ...(typeof item.cost === 'number' && Number.isFinite(item.cost) ? { cost: item.cost } : {}),
            ...(typeof itemTokens.input === 'number' || typeof itemTokens.output === 'number' ? {
              tokens: {
                ...(typeof itemTokens.input === 'number' ? { input: itemTokens.input } : {}),
                ...(typeof itemTokens.output === 'number' ? { output: itemTokens.output } : {}),
              },
            } : {}),
          }];
        }).slice(0, 40),
      } : null,
      warnings,
      limits: body.limits ?? null,
      sessions: sessions.flatMap(candidate => {
        if (!candidate || typeof candidate !== 'object') return [];
        const item = candidate as Record<string, unknown>;
        const sessionId = typeof item.sessionId === 'string' ? item.sessionId : typeof item.id === 'string' ? item.id : '';
        if (!sessionId) return [];
        const itemTokens = item.tokens && typeof item.tokens === 'object' ? item.tokens as Record<string, unknown> : {};
        return [{
          sessionId,
          ...(typeof item.title === 'string' ? { title: item.title } : {}),
          ...(typeof item.cost === 'number' && Number.isFinite(item.cost) ? { cost: item.cost } : {}),
          ...(typeof itemTokens.input === 'number' || typeof itemTokens.output === 'number' ? {
            tokens: {
              ...(typeof itemTokens.input === 'number' ? { input: itemTokens.input } : {}),
              ...(typeof itemTokens.output === 'number' ? { output: itemTokens.output } : {}),
            },
          } : {}),
        }];
      }).slice(0, 200),
      ...(typeof body.windowDays === 'number' && body.windowDays > 0 ? { windowDays: body.windowDays } : {}),
      ...(typeof body.since === 'string' ? { since: body.since } : {}),
    };
  }, 'Reading engine usage', signal);
}

export interface EngineExport {
  format: 'md' | 'json';
  filename: string;
  content: string;
}

export async function exportEngineSession(sessionId: string, format: 'md' | 'json' = 'md', signal?: AbortSignal): Promise<EngineExport> {
  return request(sessionIdPath(sessionId) + '/export?format=' + format, { method: 'GET' }, raw => {
    const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    if (typeof body.content !== 'string') throw new EngineError('The export did not include any content.', 'ENGINE_INVALID_RESPONSE');
    return {
      format: body.format === 'json' ? 'json' as const : format,
      filename: typeof body.filename === 'string' && body.filename.trim()
        ? body.filename.trim().slice(0, 200)
        : 'stragy-session.' + (body.format === 'json' ? 'json' : 'md'),
      content: body.content,
    };
  }, 'Exporting the chat', signal, 30_000);
}

export interface ProviderRate {
  requests?: number;
  candleRequests?: number;
  quoteRequests?: number;
  loginRequests?: number;
  throttles?: number;
  retrySleepMs?: number;
  relogins?: number;
}

export interface ProviderStatus {
  ai: {
    ready: boolean;
    models: string[];
    model?: string;
    modelChain?: string[];
  };
  market: {
    configured: boolean;
    connected: boolean;
    reason?: string;
    rate?: ProviderRate;
    /** Environment variable NAMES only; never values. */
    credentials?: { missing: string[] };
  };
  voice: { configured: boolean; model?: string };
}

function modelLabels(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap(candidate => {
    if (typeof candidate === 'string') return candidate.trim() ? [candidate.trim().slice(0, 120)] : [];
    if (!candidate || typeof candidate !== 'object') return [];
    const item = candidate as Record<string, unknown>;
    const label = typeof item.label === 'string' ? item.label : typeof item.id === 'string' ? item.id : '';
    return label.trim() ? [label.trim().slice(0, 120)] : [];
  }).slice(0, 12);
}

export async function getProviderStatus(signal?: AbortSignal): Promise<ProviderStatus> {
  return request('/api/v2/providers', { method: 'GET' }, raw => {
    const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const ai = body.ai && typeof body.ai === 'object' ? body.ai as Record<string, unknown> : {};
    const market = body.market && typeof body.market === 'object' ? body.market as Record<string, unknown> : {};
    const voice = body.voice && typeof body.voice === 'object' ? body.voice as Record<string, unknown> : {};
    const rateRaw = market.rate && typeof market.rate === 'object' ? market.rate as Record<string, unknown> : null;
    const rate: ProviderRate | undefined = rateRaw ? {
      ...(typeof rateRaw.requests === 'number' ? { requests: rateRaw.requests } : {}),
      ...(typeof rateRaw.candleRequests === 'number' ? { candleRequests: rateRaw.candleRequests } : {}),
      ...(typeof rateRaw.quoteRequests === 'number' ? { quoteRequests: rateRaw.quoteRequests } : {}),
      ...(typeof rateRaw.loginRequests === 'number' ? { loginRequests: rateRaw.loginRequests } : {}),
      ...(typeof rateRaw.throttles === 'number' ? { throttles: rateRaw.throttles } : {}),
      ...(typeof rateRaw.retrySleepMs === 'number' ? { retrySleepMs: rateRaw.retrySleepMs } : {}),
      ...(typeof rateRaw.relogins === 'number' ? { relogins: rateRaw.relogins } : {}),
    } : undefined;
    const credentialsRaw = market.credentials && typeof market.credentials === 'object' ? market.credentials as Record<string, unknown> : null;
    const missing = credentialsRaw && Array.isArray(credentialsRaw.missing)
      ? credentialsRaw.missing.flatMap(name => typeof name === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(name) ? [name] : []).slice(0, 20)
      : [];
    return {
      ai: {
        ready: ai.ready === true,
        models: modelLabels(ai.models),
        ...(typeof ai.model === 'string' ? { model: ai.model } : {}),
        ...(Array.isArray(ai.modelChain) ? { modelChain: modelLabels(ai.modelChain) } : {}),
      },
      market: {
        configured: market.configured === true,
        connected: market.connected === true,
        ...(typeof market.reason === 'string' ? { reason: market.reason.slice(0, 300) } : {}),
        ...(rate ? { rate } : {}),
        ...(missing.length ? { credentials: { missing } } : {}),
      },
      voice: {
        configured: voice.configured === true,
        ...(typeof voice.model === 'string' ? { model: voice.model.slice(0, 120) } : {}),
      },
    };
  }, 'Reading provider status', signal);
}

export interface MarketCacheStats {
  symbols: number;
  bars: number;
  firstDate: string | null;
  lastDate: string | null;
  dbBytes: number;
  hits: number;
  misses: number;
  incrementalFetches: number;
  lastFetchAt: string | null;
  dbPath: string;
}

const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const dateText = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim().slice(0, 40) : null;

export async function getMarketCache(signal?: AbortSignal): Promise<MarketCacheStats> {
  return request('/api/v2/market/cache', { method: 'GET' }, raw => {
    const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const stats = body.stats && typeof body.stats === 'object' ? body.stats as Record<string, unknown> : body;
    return {
      symbols: count(stats.symbols),
      bars: count(stats.bars),
      firstDate: dateText(stats.firstDate),
      lastDate: dateText(stats.lastDate),
      dbBytes: count(stats.dbBytes),
      hits: count(stats.hits),
      misses: count(stats.misses),
      incrementalFetches: count(stats.incrementalFetches),
      lastFetchAt: dateText(stats.lastFetchAt),
      dbPath: typeof stats.dbPath === 'string' ? stats.dbPath.slice(0, 300) : '',
    };
  }, 'Reading the market cache', signal);
}

export interface MarketRefreshResult {
  jobId?: string;
  status: string;
  refreshed?: number;
  failed?: number;
  message?: string;
}

export async function refreshMarketCache(universe: string, signal?: AbortSignal): Promise<MarketRefreshResult> {
  return request('/api/v2/market/cache/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ universe }),
  }, raw => {
    const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    return {
      ...(typeof body.jobId === 'string' && body.jobId ? { jobId: body.jobId.slice(0, 200) } : {}),
      status: typeof body.status === 'string' ? body.status : 'unknown',
      ...(typeof body.refreshed === 'number' ? { refreshed: body.refreshed } : {}),
      ...(typeof body.failed === 'number' ? { failed: body.failed } : {}),
      ...(typeof body.message === 'string' ? { message: body.message.slice(0, 500) } : {}),
    };
  }, 'Refreshing market data', signal, 30_000);
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'unknown';

export interface JobSummary {
  id: string;
  kind: string;
  status: JobStatus;
  stage?: string;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  progress?: { processed: number; total: number };
  error?: { code?: string; message?: string };
  resumable: boolean;
  universe?: string;
}

const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'] as const;

function normalizeJob(raw: unknown): JobSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 200) : '';
  if (!id) return null;
  const status = JOB_STATUSES.includes(item.status as typeof JOB_STATUSES[number]) ? item.status as JobStatus : 'unknown';
  const progress = item.progress && typeof item.progress === 'object' ? item.progress as Record<string, unknown> : null;
  const processed = typeof progress?.processed === 'number' ? progress.processed : typeof item.processed === 'number' ? item.processed : null;
  const total = typeof progress?.total === 'number' ? progress.total : typeof item.total === 'number' ? item.total : null;
  const error = item.error && typeof item.error === 'object' ? item.error as Record<string, unknown> : null;
  const errorMessage = typeof error?.message === 'string' ? error.message : typeof item.error === 'string' ? item.error : '';
  const errorCode = typeof error?.code === 'string' ? error.code : '';
  return {
    id,
    kind: typeof item.kind === 'string' ? item.kind.slice(0, 40) : 'unknown',
    status,
    ...(typeof item.stage === 'string' ? { stage: item.stage.slice(0, 80) } : {}),
    ...(typeof item.createdAt === 'string' ? { createdAt: item.createdAt } : {}),
    ...(typeof item.startedAt === 'string' ? { startedAt: item.startedAt } : {}),
    ...(typeof item.finishedAt === 'string' ? { finishedAt: item.finishedAt } : {}),
    ...(processed !== null && total !== null && total > 0 ? { progress: { processed, total } } : {}),
    ...(errorMessage || errorCode ? { error: { ...(errorCode ? { code: errorCode } : {}), ...(errorMessage ? { message: errorMessage.slice(0, 300) } : {}) } } : {}),
    resumable: item.resumable === true,
    ...(typeof item.universe === 'string' ? { universe: item.universe.slice(0, 60) } : {}),
  };
}

export async function listJobs(limit = 20, signal?: AbortSignal): Promise<JobSummary[]> {
  return request('/api/v2/jobs?limit=' + Math.max(1, Math.min(100, Math.floor(limit))), { method: 'GET' }, raw => {
    const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const list = Array.isArray(body.jobs) ? body.jobs : Array.isArray(raw) ? raw : [];
    return list.map(normalizeJob).filter((job): job is JobSummary => job !== null).slice(0, 100);
  }, 'Listing jobs', signal);
}

export async function cancelJob(jobId: string, signal?: AbortSignal): Promise<void> {
  await request('/api/v2/jobs/' + encodeURIComponent(jobId), { method: 'DELETE' }, () => undefined, 'Cancelling the job', signal);
}

/** Resume a job the server marked interrupted; the same id continues. */
export async function resumeJob(jobId: string, signal?: AbortSignal): Promise<void> {
  await request('/api/v2/jobs/' + encodeURIComponent(jobId) + '/resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }, () => undefined, 'Resuming the job', signal, 20_000);
}

export interface EngineSendInput {
  text?: string;
  /** A data URL (PNG/JPEG/WebP) for read_chart. */
  image?: { dataUrl: string; mimeType: string; name: string };
  hint?: string;
  currentStrategy?: unknown;
  screenContext?: unknown;
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
}

/** Prompt the engine; the route answers 202 and delivers messages over SSE. */
export async function postEngineMessage(sessionId: string, input: EngineSendInput, signal?: AbortSignal): Promise<void> {
  const body: Record<string, unknown> = {};
  const text = input.text?.trim();
  if (text) body.text = text;
  if (input.image) body.image = input.image;
  if (input.hint?.trim()) body.hint = input.hint.trim();
  if (input.currentStrategy !== undefined) body.currentStrategy = input.currentStrategy;
  if (input.screenContext !== undefined) body.screenContext = input.screenContext;
  if (input.history?.length) body.history = input.history.slice(-20);
  if (!body.text && !body.image) throw new EngineError('A message needs text or an image.', 'ENGINE_EMPTY_MESSAGE');
  const response = await boundedFetch(sessionIdPath(sessionId) + '/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, signal, 20_000, 'Sending the message');
  let raw: unknown = null;
  try { raw = await response.json(); } catch { raw = null; }
  if (!response.ok) {
    const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const error = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : undefined;
    throw new EngineError(
      typeof error?.message === 'string' ? error.message : 'The engine did not accept the message (' + response.status + ').',
      typeof error?.code === 'string' ? error.code : 'ENGINE_SEND_FAILED',
      response.status,
    );
  }
  if (response.status !== 202 && response.status !== 200) {
    throw new EngineError('The engine did not accept the message (' + response.status + ').', 'ENGINE_SEND_FAILED', response.status);
  }
}

export async function getEngineMessages(sessionId: string, signal?: AbortSignal): Promise<EngineMessagePage> {
  return request(sessionIdPath(sessionId) + '/messages', { method: 'GET' }, raw => {
    const page = MessageList.parse(raw);
    const messages = page.messages
      .map(candidate => EngineMessageSchema.safeParse(candidate))
      .filter((parsed): parsed is { success: true; data: EngineMessage } => parsed.success)
      .map(parsed => parsed.data);
    const lastSeq = page.lastSeq ?? messages.reduce((max, message) => Math.max(max, message.seq ?? 0), 0);
    return { messages, lastSeq };
  }, 'Loading the session', signal, 20_000);
}

export async function interruptEngineSession(sessionId: string, signal?: AbortSignal): Promise<void> {
  await request(sessionIdPath(sessionId) + '/interrupt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, () => undefined, 'Interrupting the session', signal, 10_000);
}

/**
 * Approve a gated engine action. The chat then sends the confirm message so the
 * engine owns the actual execution (the legacy review card keeps its own flow).
 */
export async function postEngineApproval(input: { sessionId: string; approvalId: string; decision: 'approve' | 'reject'; note?: string }, signal?: AbortSignal): Promise<void> {
  await request('/api/v2/engine/approvals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: input.sessionId,
      approvalId: input.approvalId,
      decision: input.decision,
      ...(input.note ? { note: input.note } : {}),
    }),
  }, () => undefined, 'Sending the approval', signal, 15_000);
}

const StoredSession = z.object({ sessionId: z.string().min(1).max(200), lastSeq: z.number().int().min(0) });

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): StorageLike | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

export function readStoredEngineSession(source: StorageLike | undefined = storage()): StoredEngineSession | null {
  if (!source) return null;
  try {
    const raw = source.getItem(ENGINE_SESSION_KEY);
    if (!raw) return null;
    const parsed = StoredSession.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeStoredEngineSession(session: StoredEngineSession, target: StorageLike | undefined = storage()): boolean {
  if (!target) return false;
  try {
    target.setItem(ENGINE_SESSION_KEY, JSON.stringify({ sessionId: session.sessionId, lastSeq: Math.max(0, Math.floor(session.lastSeq)) }));
    return true;
  } catch {
    return false;
  }
}

export function clearStoredEngineSession(target: StorageLike | undefined = storage()): void {
  try { target?.removeItem(ENGINE_SESSION_KEY); } catch { /* storage may be unavailable */ }
}

/** Cursor persistence is per-tab cheap: one small write per delivered event. */
export function rememberEngineCursor(sessionId: string, lastSeq: number): void {
  writeStoredEngineSession({ sessionId, lastSeq });
}

interface EventSourceLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close(): void;
  addEventListener?: (type: string, listener: (event: { data: string }) => void) => void;
}

type EventSourceCtor = new (url: string) => EventSourceLike;

function eventSourceCtor(): EventSourceCtor | null {
  const candidate = (globalThis as unknown as { EventSource?: EventSourceCtor }).EventSource;
  return typeof candidate === 'function' ? candidate : null;
}

const NAMED_EVENTS = ['message', 'status', 'job', 'error', 'idle', 'tool', 'todo'] as const;
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000] as const;

export interface EngineSubscription {
  close(): void;
  /** Events the client has accepted (deduplicated by seq). */
  cursor(): number;
  /** True when the transport is SSE; false when it polls the message list. */
  transport(): 'sse' | 'poll';
}

export interface SubscribeOptions {
  /** Called once per accepted event, in seq order. */
  onEvent(event: EngineEvent): void;
  /** Transport state for an honest "Reconnecting…" note. */
  onState?(state: 'open' | 'reconnecting' | 'closed'): void;
  /** Persist the cursor; defaults to rememberEngineCursor. */
  onCursor?(lastSeq: number): void;
  /** Polling fallback interval when EventSource is unavailable. */
  pollMs?: number;
}

/**
 * Subscribe to a session's durable event stream from `afterSeq`. SSE reconnects
 * automatically (query cursor, exponential backoff) and every event with a seq
 * at or below the cursor is dropped, so a server restart or flaky proxy can
 * neither lose nor duplicate a message. Without EventSource the client polls
 * the message list and synthesizes the same events.
 */
export function subscribeEngineEvents(sessionId: string, afterSeq: number, options: SubscribeOptions): EngineSubscription {
  let closed = false;
  let cursor = Math.max(0, Math.floor(afterSeq));
  let attempt = 0;
  let source: EventSourceLike | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let seen = new Set<string>();
  const persist = options.onCursor ?? ((seq: number) => rememberEngineCursor(sessionId, seq));

  const accept = (event: EngineEvent) => {
    if (closed) return;
    if (!Number.isFinite(event.seq) || event.seq <= cursor) return;
    cursor = Math.floor(event.seq);
    persist(cursor);
    options.onEvent(event);
  };

  const parse = (raw: string, fallbackType: EngineEventType, fallbackSeq: number): EngineEvent | null => {
    try {
      const value = JSON.parse(raw) as Record<string, unknown>;
      const type = typeof value.type === 'string' && (['message', 'status', 'error', 'idle', 'job', 'tool', 'todo', 'connected'] as string[]).includes(value.type)
        ? value.type as EngineEventType
        : fallbackType;
      const message = EngineMessageSchema.safeParse(value.message);
      const rawSeq = value.seq ?? (message.success ? message.data.seq : undefined);
      const seq = rawSeq === undefined ? fallbackSeq : Number(rawSeq);
      if (!Number.isFinite(seq)) return null;
      const activitySource = value.activity ?? (type === 'tool' ? (value.tool ?? (value.name ? value : undefined)) : undefined);
      const activities = normalizeToolActivities(activitySource);
      const todoSource = value.todos ?? value.items ?? (type === 'todo' ? value : undefined);
      const todos = normalizeEngineTodos(todoSource);
      return {
        seq,
        type,
        ...(message.success ? { message: message.data } : {}),
        ...(typeof value.status === 'string' ? { status: value.status } : {}),
        ...(typeof value.error === 'string' ? { error: value.error } : {}),
        ...(value.job && typeof value.job === 'object' ? { job: value.job as EngineEvent['job'] } : {}),
        ...(activities.length ? { activity: activities[0], activities } : {}),
        ...(todos.length ? { todos } : {}),
      };
    } catch {
      return null;
    }
  };

  const scheduleReconnect = () => {
    if (closed) return;
    source?.close();
    source = null;
    options.onState?.('reconnecting');
    const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
    attempt += 1;
    retry = setTimeout(connect, delay);
  };

  const connect = () => {
    if (closed) return;
    const Ctor = eventSourceCtor();
    if (!Ctor) { startPolling(); return; }
    const url = sessionIdPath(sessionId) + '/events?after=' + cursor + '&_=' + now();
    let current: EventSourceLike;
    try { current = new Ctor(url); } catch { scheduleReconnect(); return; }
    source = current;
    current.onopen = () => {
      if (closed || source !== current) return;
      attempt = 0;
      options.onState?.('open');
    };
    const receive = (fallbackType: EngineEventType) => (event: { data: string }) => {
      if (closed || source !== current) return;
      const parsed = parse(event.data, fallbackType, cursor + 1);
      if (parsed) accept(parsed);
    };
    current.onmessage = receive('message');
    for (const name of NAMED_EVENTS) {
      if (name === 'message' || typeof current.addEventListener !== 'function') continue;
      const fallback: EngineEventType = name === 'error' ? 'error'
        : name === 'idle' ? 'idle'
          : name === 'job' ? 'job'
            : name === 'tool' ? 'tool'
              : name === 'todo' ? 'todo'
                : 'status';
      current.addEventListener(name, receive(fallback));
    }
    current.onerror = () => {
      if (closed || source !== current) return;
      scheduleReconnect();
    };
  };

  const startPolling = () => {
    if (closed || poll) return;
    options.onState?.('open');
    const tick = async () => {
      if (closed) return;
      try {
        const page = await getEngineMessages(sessionId);
        for (const message of page.messages) {
          if (seen.has(message.id)) continue;
          seen.add(message.id);
          const seq = message.seq ?? Math.max(cursor + 1, page.lastSeq);
          if (seq <= cursor) continue;
          cursor = Math.floor(seq);
          persist(cursor);
          options.onEvent({ seq: cursor, type: 'message', message });
        }
        if (!page.messages.length) seen = new Set();
        attempt = 0;
      } catch (error) {
        if (isEngineUnavailable(error)) { options.onState?.('closed'); return; }
        options.onState?.('reconnecting');
      }
    };
    void tick();
    poll = setInterval(() => { void tick(); }, Math.max(1_000, options.pollMs ?? 3_000));
  };

  connect();

  return {
    close() {
      closed = true;
      source?.close();
      source = null;
      if (retry) clearTimeout(retry);
      if (poll) clearInterval(poll);
      options.onState?.('closed');
    },
    cursor: () => cursor,
    transport: () => eventSourceCtor() ? 'sse' : 'poll',
  };
}

/** A job record's status, including Agent A's durable "interrupted" state. */
export interface JobStatusRecord {
  id: string;
  kind?: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'unknown';
  error?: { code?: string; message?: string };
}

const JobRecord = z.object({
  id: z.string().min(1).max(200),
  kind: z.string().max(40).optional(),
  status: z.string().max(40),
  error: z.object({ code: z.string().max(100).optional(), message: z.string().max(2000).optional() }).passthrough().optional(),
}).passthrough();

export async function getJobStatus(jobId: string, signal?: AbortSignal): Promise<JobStatusRecord> {
  return request('/api/v2/jobs/' + encodeURIComponent(jobId), { method: 'GET' }, raw => {
    const job = JobRecord.parse(raw);
    const statuses = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'];
    return { ...job, status: statuses.includes(job.status) ? job.status as JobStatusRecord['status'] : 'unknown' };
  }, 'Reading the research job', signal, 10_000);
}

type ResumeJob = (jobId: string) => Promise<unknown>;

/**
 * Agent A owns the job functions in api.ts and adds `resumeResearchJob` with
 * their durable-jobs change. Consume it when present; until then the same
 * endpoint is called directly so the interrupted-state button is honest only
 * when the server actually supports resume (a 404 stays a typed error).
 */
export async function resumeInterruptedJob(jobId: string, signal?: AbortSignal): Promise<void> {
  let shared: ResumeJob | undefined;
  try {
    const candidate = (await import('./api')) as unknown as { resumeResearchJob?: ResumeJob };
    shared = typeof candidate.resumeResearchJob === 'function' ? candidate.resumeResearchJob : undefined;
  } catch { shared = undefined; }
  if (shared) { await shared(jobId); return; }
  await request('/api/v2/jobs/' + encodeURIComponent(jobId) + '/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, () => undefined, 'Resuming the research job', signal, 15_000);
}
