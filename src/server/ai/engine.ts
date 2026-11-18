/**
 * Embedded OpenCode host: one lazy singleton per Stragy server.
 *
 * The host runs in-process (no HTTP listener), stores sessions/messages in
 * SQLite under .data/opencode/stragy.db, and sees exactly one empty workspace
 * directory. Its event stream is fanned out to SSE subscribers with a durable
 * cursor: durable session events carry seq = durableSeq * 1000, derived message
 * events use small offsets inside that block, and live-only events reuse the
 * current block. Reconnect replays from the durable session log, so a server
 * restart loses nothing in the conversation.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  ENGINE_AGENT_ID, buildEngineConfig, writeEngineConfig,
  type BuiltEngineConfig,
} from './engineConfig';
import {
  EngineContextStore, createEnginePlugin,
  type EngineJobService, type EngineStrategyRepository,
} from './engineTools';
import { engineApprovals } from './engineApprovals';
import { loadEngineHostApi, type EngineHost, type EngineHostSessionInfo, type EngineHostStats, type EngineHostUsageLimits } from './opencodeRuntime';
import {
  adaptMessages, buildSeqIndex, humanToolName, idleErrorText, todosFromOutput, toolActivitySummary, toolErrorText, toolOutputFromContent,
  type AdaptedEngineMessage, type AgentToolActivity, type AgentTodoItem,
} from './engineAdapter';
import type { ResearchPayload } from '../jobs/manager';
import { validateStrategy } from '../../shared/strategy/schema';

export class EngineError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = 'EngineError'; }
}

export interface EngineSseEvent {
  seq: number;
  type: 'message' | 'status' | 'error' | 'idle' | 'job' | 'tool' | 'todo' | 'connected';
  message?: AdaptedEngineMessage;
  status?: string;
  /** A string for engine errors; an object for a failed tool activity. */
  error?: string | { code: string; message: string };
  job?: { id: string; kind?: string; status?: string };
  /** Normalized tool activity (same shape as AgentActivity's AgentToolEntry). */
  name?: string;
  callId?: string;
  summary?: string;
  durationMs?: number;
  /** The full updated plan from todowrite. */
  todos?: AgentTodoItem[];
  engine?: { type: string; seq?: number };
}

export interface EngineDependencies {
  /** .data/opencode by default; tests point this at a temp directory. */
  rootDir: string;
  env: Record<string, string | undefined>;
  dataMode: 'demo' | 'real';
  jobs?: EngineJobService;
  prepareBacktest?: (body: unknown) => Promise<ResearchPayload>;
  rememberRun?: (result: unknown) => Promise<void>;
  repository?: EngineStrategyRepository;
}

export interface EngineSessionSummary {
  sessionId: string;
  title?: string;
  updatedAt?: string;
  agent?: string;
  model?: { providerID: string; id: string };
  /** Session total from the engine; absent when the host did not report it. */
  cost?: number;
  tokens?: { input: number; output: number };
  outcome?: string;
}

export interface EngineModelOption {
  providerID: string;
  id: string;
  label: string;
  /** In the free chain, so it can run without a paid approval. */
  free: boolean;
  /** Paid, exposed only because an explicit approval allowed it. */
  approvedPaid: boolean;
  default: boolean;
}

export interface EngineModelsReport {
  models: EngineModelOption[];
  default: { providerID: string; model: string } | null;
}

export interface EngineUsageSession {
  sessionId: string;
  title?: string;
  updatedAt?: string;
  cost?: number;
  tokens?: { input: number; output: number };
}

/** See GET /api/v2/engine/usage: null fields carry an honest warning, never zeros. */
export interface EngineUsageReport {
  stats: EngineHostStats | null;
  limits: EngineHostUsageLimits | null;
  sessions: EngineUsageSession[];
  warnings: string[];
}

export interface EngineExport {
  format: 'md' | 'json';
  filename: string;
  content: string;
}

export interface EngineMessagePage {
  messages: AdaptedEngineMessage[];
  lastSeq: number;
}

export interface EngineStagedImage {
  dataUrl: string;
  mimeType: string;
  name: string;
  hint?: string;
  currentStrategy?: unknown;
}

interface SessionState {
  buffer: EngineSseEvent[];
  lastDurableSeq: number;
  lastStartedAt?: number;
  lastEmittedAt?: number;
  index?: { byMessageId: Map<string, number>; lastSeq: number };
  emitted: Set<string>;
  /** Durable tool call id -> name/start, for live activity events. */
  tools: Map<string, { name: string; startedAt: number }>;
}

interface Runtime {
  host: EngineHost;
  workspace: string;
  configFile: string;
  built: BuiltEngineConfig;
  sessions: Map<string, SessionState>;
  listeners: Map<string, Set<(event: EngineSseEvent) => void>>;
  abort: AbortController;
  closed?: boolean;
  startedAt: number;
}

const MAX_BUFFER = 1_000;
const MAX_MESSAGE_HISTORY = 200;
const MAX_SESSION_LIST = 50;
const DEFAULT_SESSION_TITLE = 'New research conversation';
const AUTO_TITLE_MAX = 60;
/** GET /api/v2/engine/sessions/:id/export never returns more than this. */
const EXPORT_MAX_BYTES = 2 * 1024 * 1024;
/** The SDK message-list route caps limit at 200. */
const EXPORT_MESSAGE_LIMIT = 200;
const DEFAULT_ROOT = () => path.resolve(process.cwd(), '.data/opencode');

let deps: EngineDependencies = {
  rootDir: process.env.STRAGY_ENGINE_DIR || DEFAULT_ROOT(),
  env: process.env,
  dataMode: 'demo',
};
let runtime: Runtime | null = null;
let initPromise: Promise<Runtime> | null = null;
let boot: { built: BuiltEngineConfig; configFile: string; warnings: string[] } | null = null;
let bootError: { code: string; message: string } | null = null;
let hooksRegistered = false;
let testHostFactory: (() => Promise<EngineHost>) | null = null;
const contexts = new EngineContextStore();

/** Configure/update the engine dependencies. Safe to call once at app boot. */
export function configureEngine(input: Partial<EngineDependencies>): void {
  const previousRoot = deps.rootDir;
  deps = { ...deps, ...input };
  if (deps.rootDir !== previousRoot && runtime) {
    // The old host points at another database; close it before the next use.
    void closeEngine().catch(() => undefined);
  }
}

/** Write the generated config at boot. Never throws: routes report the typed error. */
export async function initializeEngine(input: Partial<EngineDependencies> = {}): Promise<{ configured: boolean; defaultModel: { providerID: string; model: string } | null; warnings: string[]; configFile?: string; error?: { code: string; message: string } }> {
  if (Object.keys(input).length) configureEngine(input);
  bootError = null;
  try {
    const built = buildEngineConfig(deps.env);
    const configDir = path.join(deps.rootDir, 'config');
    await fs.mkdir(path.join(deps.rootDir, 'workspace'), { recursive: true });
    const configFile = await writeEngineConfig(configDir, built);
    boot = { built, configFile, warnings: built.warnings };
    if (!built.defaultModel) {
      bootError = {
        code: 'ENGINE_UNAVAILABLE',
        message: 'The AI engine has no configured model. Add a provider key in Settings, then restart the engine session. ' + (built.warnings[0] ?? ''),
      };
    }
    return { configured: Boolean(built.defaultModel), defaultModel: built.defaultModel, warnings: built.warnings, configFile, ...(bootError ? { error: bootError } : {}) };
  } catch (error) {
    bootError = { code: 'ENGINE_CONFIG_FAILED', message: 'The AI engine configuration could not be written: ' + ((error as Error).message || 'unknown filesystem error') };
    return { configured: false, defaultModel: null, warnings: [], ...(bootError ? { error: bootError } : {}) };
  }
}

function sessionState(runtime: Runtime, sessionId: string): SessionState {
  const existing = runtime.sessions.get(sessionId);
  if (existing) return existing;
  const created: SessionState = { buffer: [], lastDurableSeq: 0, emitted: new Set(), tools: new Map() };
  runtime.sessions.set(sessionId, created);
  return created;
}

function push(runtime: Runtime, sessionId: string, events: EngineSseEvent[]): void {
  if (!events.length) return;
  const state = sessionState(runtime, sessionId);
  for (const event of events) {
    if (!Number.isFinite(event.seq) || event.seq <= 0) continue;
    const existing = state.buffer.findIndex(item => item.seq === event.seq);
    if (existing >= 0) state.buffer[existing] = event;
    else state.buffer.push(event);
    if (event.engine?.seq && event.engine.seq > state.lastDurableSeq) state.lastDurableSeq = event.engine.seq;
    const listeners = runtime.listeners.get(sessionId);
    if (listeners) for (const listener of [...listeners]) {
      try { listener(event); } catch { /* a broken subscriber must not stop the pump */ }
    }
  }
  state.buffer.sort((a, b) => a.seq - b.seq);
  if (state.buffer.length > MAX_BUFFER) state.buffer.splice(0, state.buffer.length - MAX_BUFFER);
}

function eventBase(event: { durable?: { seq?: unknown }; seq?: unknown }): number {
  if (typeof event.durable?.seq === 'number') return event.durable.seq;
  if (typeof event.seq === 'number') return event.seq;
  return 0;
}

function isAssistantMessage(raw: unknown): boolean {
  return Boolean(raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'assistant');
}

function isUserMessage(raw: unknown): boolean {
  return Boolean(raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'user');
}

function messageCreatedAt(raw: unknown): number {
  const time = (raw as { time?: { created?: unknown } } | undefined)?.time;
  return typeof time?.created === 'number' ? time.created : 0;
}

async function deriveTurnMessages(runtime: Runtime, sessionId: string, base: number, fromCreatedAt: number | undefined, toCreatedAt: number | undefined, skipIds?: Set<string>): Promise<AdaptedEngineMessage[]> {
  const page = await runtime.host.message.list({ sessionID: sessionId, limit: MAX_MESSAGE_HISTORY });
  const raw = [...(page.data ?? [])]
    .filter(isAssistantMessage)
    .filter(message => {
      const created = messageCreatedAt(message);
      if (fromCreatedAt !== undefined && created < fromCreatedAt - 1_000) return false;
      if (toCreatedAt !== undefined && created > toCreatedAt + 1_000) return false;
      const id = (message as { id?: unknown }).id;
      if (skipIds && typeof id === 'string' && skipIds.has(id)) return false;
      return true;
    })
    .sort((a, b) => messageCreatedAt(a) - messageCreatedAt(b));
  const adapted = await adaptMessages(raw, {
    seqFor: () => base * 1_000,
    resolveJobResult: (jobId) => deps.jobs?.get(jobId)?.result,
  });
  return adapted;
}

function toMessageEvents(base: number, messages: AdaptedEngineMessage[]): EngineSseEvent[] {
  const events: EngineSseEvent[] = [];
  messages.forEach((message, index) => {
    const seq = base * 1_000 + Math.min(index + 1, 900);
    events.push({ seq, type: 'message', message: { ...message, seq }, engine: { type: 'derived.message' } });
  });
  return events;
}

/** The newest idle message carries the honest provider/tool error text. */
async function failureText(runtime: Runtime, sessionId: string, fallback: unknown): Promise<string> {
  try {
    const page = await runtime.host.message.list({ sessionID: sessionId, limit: 10, type: 'idle' });
    const idle = [...(page.data ?? [])].sort((a, b) => messageCreatedAt(b) - messageCreatedAt(a))
      .find(message => (message as { outcome?: unknown }).outcome === 'failed') as { error?: unknown } | undefined;
    if (idle?.error) return idleErrorText(idle.error);
  } catch { /* fall back to the event payload */ }
  return idleErrorText(fallback);
}

/**
 * The durable inbox event normally carries the message item, but older rows or
 * a provider retry can omit its payload. Fall back to the message list so a
 * user turn is never replayed as an empty bubble.
 */
async function inboxText(runtime: Runtime, sessionId: string, inboxID: string, item: { type?: unknown; payload?: { text?: unknown }; text?: unknown } | undefined): Promise<string> {
  if (item?.type === 'user') {
    if (typeof item.payload?.text === 'string') return item.payload.text;
    if (typeof item.text === 'string') return item.text;
  }
  if (!inboxID) return '';
  try {
    const page = await runtime.host.message.list({ sessionID: sessionId, limit: 50, type: 'user' });
    const match = (page.data ?? []).find(message => (message as { id?: unknown }).id === inboxID) as { text?: unknown } | undefined;
    return typeof match?.text === 'string' ? match.text : '';
  } catch { return ''; }
}

/**
 * Normalized tool activity events for the AgentActivity timeline. Each durable
 * tool event has its own seq; the plan update uses the next slot in the same
 * block so it can never collide with the next durable event.
 */
function toolActivityEvents(state: SessionState, item: { type: string; created?: number; durable?: { seq?: number }; data?: Record<string, unknown> }): EngineSseEvent[] {
  const data = item.data ?? {};
  const callId = typeof data.id === 'string' ? data.id : '';
  if (!callId) return [];
  const base = eventBase(item);
  const seq = base * 1_000;
  const created = typeof item.created === 'number' ? item.created : Date.now();
  const tracked = state.tools.get(callId);
  if (item.type === 'session.tool.input.started') {
    const name = typeof data.name === 'string' ? data.name : 'tool';
    state.tools.set(callId, { name, startedAt: created });
    return [{ seq, type: 'tool', callId, name, status: 'called', summary: toolActivitySummary(name, undefined, 'called'), engine: { type: item.type, seq: base } }];
  }
  if (item.type === 'session.tool.called') {
    const name = tracked?.name ?? (typeof data.name === 'string' ? data.name : 'tool');
    const startedAt = tracked?.startedAt ?? created;
    const input = data.input && typeof data.input === 'object' ? data.input as Record<string, unknown> : undefined;
    return [{ seq, type: 'tool', callId, name, status: 'running', summary: toolActivitySummary(name, input, 'running'), durationMs: Math.max(0, created - startedAt), engine: { type: item.type, seq: base } }];
  }
  if (item.type === 'session.tool.success' || item.type === 'session.tool.failed') {
    const name = tracked?.name ?? (typeof data.name === 'string' ? data.name : 'tool');
    const transportFailed = item.type === 'session.tool.failed';
    const metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata as Record<string, unknown> : undefined;
    const output = toolOutputFromContent(data.content) ?? (metadata && Array.isArray(metadata.todos) ? { todos: metadata.todos } : undefined);
    const outputFailed = output?.status === 'failed';
    const outputError = outputFailed && output?.error && typeof output.error === 'object' ? output.error as { code?: unknown; message?: unknown } : undefined;
    const error = transportFailed
      ? { code: typeof (data.error as { type?: unknown } | undefined)?.type === 'string' ? String((data.error as { type?: unknown }).type) : 'TOOL_FAILED', message: toolErrorText(data.error) }
      : outputFailed ? { code: typeof outputError?.code === 'string' ? outputError.code : 'TOOL_FAILED', message: typeof outputError?.message === 'string' ? outputError.message : 'The tool reported a failure.' } : undefined;
    const status: AgentToolActivity['status'] = error ? 'failed' : output?.status === 'running' ? 'running' : 'success';
    const activity: AgentToolActivity = {
      type: 'tool', name, status,
      summary: error ? error.message.slice(0, 180) : toolActivitySummary(name, output, status),
      ...(tracked ? { durationMs: Math.max(0, created - tracked.startedAt) } : {}),
      ...(error ? { error } : {}),
    };
    const events: EngineSseEvent[] = [{ seq, callId, ...activity, engine: { type: item.type, seq: base } }];
    if (name === 'todowrite' && output) {
      const todos = todosFromOutput(output);
      if (todos) events.push({ seq: seq + 1, type: 'todo', todos, engine: { type: item.type, seq: base } });
    }
    state.tools.delete(callId);
    return events;
  }
  return [];
}

async function handleDurableEvent(runtime: Runtime, sessionId: string, event: { type: string; created?: number; durable?: { seq?: number }; data?: Record<string, unknown> }): Promise<void> {
  const state = sessionState(runtime, sessionId);
  const base = eventBase(event);
  if (base > state.lastDurableSeq) state.lastDurableSeq = base;
  const seq = base * 1_000;
  const created = typeof event.created === 'number' ? event.created : Date.now();

  switch (event.type) {
    case 'session.inbox.delivered': {
      const data = event.data ?? {};
      const inboxID = typeof data.inboxID === 'string' ? data.inboxID : '';
      const item = data.item && typeof data.item === 'object' ? data.item as { type?: unknown; payload?: { text?: unknown }; text?: unknown } : undefined;
      if (inboxID) {
        const text = await inboxText(runtime, sessionId, inboxID, item);
        state.index ??= { byMessageId: new Map(), lastSeq: 0 };
        state.index.byMessageId.set(inboxID, seq);
        state.index.lastSeq = Math.max(state.index.lastSeq, base);
        push(runtime, sessionId, [{
          seq,
          type: 'message',
          message: { id: inboxID, role: 'user', ...(text ? { text } : {}), timestamp: created, seq },
          engine: { type: event.type, seq: base },
        }]);
      }
      return;
    }
    case 'session.execution.started': {
      state.lastStartedAt = created;
      state.tools.clear();
      push(runtime, sessionId, [{ seq, type: 'status', status: 'working', engine: { type: event.type, seq: base } }]);
      return;
    }
    case 'session.tool.input.started':
    case 'session.tool.called':
    case 'session.tool.success':
    case 'session.tool.failed': {
      push(runtime, sessionId, toolActivityEvents(state, event));
      return;
    }
    case 'session.retry.scheduled': {
      push(runtime, sessionId, [{ seq, type: 'status', status: 'retrying', engine: { type: event.type, seq: base } }]);
      return;
    }
    case 'session.step.ended': {
      const data = event.data ?? {};
      const assistant = typeof data.assistantMessageID === 'string' ? data.assistantMessageID : undefined;
      if (assistant) {
        state.index ??= { byMessageId: new Map(), lastSeq: 0 };
        state.index.byMessageId.set(assistant, seq);
        state.index.lastSeq = Math.max(state.index.lastSeq, base);
      }
      return;
    }
    case 'session.execution.succeeded':
    case 'session.execution.failed':
    case 'session.execution.interrupted': {
      let turn: AdaptedEngineMessage[] = [];
      try { turn = await deriveTurnMessages(runtime, sessionId, base, state.lastStartedAt, created); }
      catch { /* fall through to the idle event: a mapping error is not a failed turn */ }
      for (const message of turn) state.emitted.add(message.id);
      push(runtime, sessionId, toMessageEvents(base, turn));
      if (event.type === 'session.execution.failed') {
        const data = event.data ?? {};
        const error = data.error ?? { type: 'execution_failed', message: 'The engine could not complete this turn.' };
        push(runtime, sessionId, [{ seq: base * 1_000 + 950, type: 'error', error: await failureText(runtime, sessionId, error), engine: { type: event.type, seq: base } }]);
      }
      push(runtime, sessionId, [{ seq: base * 1_000 + 999, type: 'idle', status: 'idle', engine: { type: event.type, seq: base } }]);
      state.lastStartedAt = undefined;
      state.lastEmittedAt = created;
      return;
    }
    default:
      return;
  }
}

async function handleLiveEvent(runtime: Runtime, event: { type: string; created?: number; durable?: { seq?: number }; data?: Record<string, unknown> }): Promise<void> {
  const data = event.data ?? {};
  const sessionId = typeof data.sessionID === 'string' ? data.sessionID : undefined;
  if (!sessionId) return;
  if (event.durable) {
    await handleDurableEvent(runtime, sessionId, event);
    return;
  }
  if (event.type === 'session.idle') {
    const state = sessionState(runtime, sessionId);
    const seq = state.lastDurableSeq * 1_000 + 999;
    if (state.buffer.at(-1)?.seq !== seq) {
      push(runtime, sessionId, [{ seq, type: 'idle', status: 'idle', engine: { type: event.type } }]);
    }
  }
}

async function pump(runtime: Runtime): Promise<void> {
  const controller = new AbortController();
  runtime.abort = controller;
  try {
    for await (const event of runtime.host.events.subscribe({})) {
      try { await handleLiveEvent(runtime, event as unknown as { type: string; created?: number; durable?: { seq?: number }; data?: Record<string, unknown> }); }
      catch (error) {
        console.error(JSON.stringify({ event: 'engine_event_error', message: (error as Error).message }));
      }
    }
  } catch (error) {
    if (!runtime.closed) console.error(JSON.stringify({ event: 'engine_event_stream_ended', message: (error as Error).message }));
  }
}

async function ensureHost(): Promise<Runtime> {
  if (runtime) return runtime;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (bootError?.code === 'ENGINE_CONFIG_FAILED') throw new EngineError(503, 'ENGINE_UNAVAILABLE', bootError.message);
    const built = buildEngineConfig(deps.env);
    const configDir = path.join(deps.rootDir, 'config');
    const workspace = path.join(deps.rootDir, 'workspace');
    const configHome = path.join(deps.rootDir, 'config-home');
    await fs.mkdir(configDir, { recursive: true });
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(configHome, { recursive: true });
    const configFile = await writeEngineConfig(configDir, built);
    boot = { built, configFile, warnings: built.warnings };
    if (!built.defaultModel) {
      throw new EngineError(503, 'ENGINE_UNAVAILABLE', 'The AI engine has no configured model. Add a provider key in Settings and try again. ' + (built.warnings[0] ?? ''));
    }
    for (const [key, value] of Object.entries(built.env)) process.env[key] = value;
    // Keep OpenCode's global config (and its MCP servers/plugins) out of this
    // embedded host: the engine may only use Stragy's own tools.
    process.env.OPENCODE_CONFIG_DIR = configHome;
    const host = testHostFactory ? await testHostFactory() : await (await loadEngineHostApi()).create({
      config: { directory: workspace, project: false, file: configFile },
      database: { path: path.join(deps.rootDir, 'stragy.db') },
      events: { persist: true },
      plugins: [createEnginePlugin(() => ({
        jobs: deps.jobs,
        dataMode: deps.dataMode,
        prepareBacktest: deps.prepareBacktest,
        rememberRun: deps.rememberRun,
        repository: deps.repository,
        approvals: engineApprovals,
        contexts,
      }))],
      log: { level: 'warn', emit: () => undefined },
    });
    const created: Runtime = {
      host,
      workspace,
      configFile,
      built,
      sessions: new Map(),
      listeners: new Map(),
      abort: new AbortController(),
      startedAt: Date.now(),
    };
    runtime = created;
    registerShutdownHooks();
    void pump(created);
    return created;
  })().catch((error: unknown) => {
    initPromise = null;
    if (error instanceof EngineError) throw error;
    const message = (error as Error)?.message || 'unknown host error';
    throw new EngineError(503, 'ENGINE_UNAVAILABLE', 'The embedded AI engine could not start: ' + message);
  });
  return initPromise;
}

/** Verify a session exists and belongs to the engine workspace. */
async function requireSession(runtime: Runtime, sessionId: string): Promise<EngineHostSessionInfo> {
  try {
    return await runtime.host.sessions.get({ sessionID: sessionId });
  } catch {
    throw new EngineError(404, 'ENGINE_SESSION_NOT_FOUND', 'That engine session does not exist.');
  }
}

/** The single mapping from SDK SessionInfo to the wire summary. */
function toSessionSummary(info: EngineHostSessionInfo): EngineSessionSummary {
  const input = info.tokens?.input;
  const output = info.tokens?.output;
  const hasTokens = typeof input === 'number' && Number.isFinite(input) && typeof output === 'number' && Number.isFinite(output);
  return {
    sessionId: info.id,
    ...(info.title ? { title: info.title } : {}),
    updatedAt: new Date(info.time?.updated ?? info.time?.created ?? Date.now()).toISOString(),
    ...(info.agent ? { agent: info.agent } : {}),
    ...(info.model ? { model: { providerID: info.model.providerID, id: info.model.id } } : {}),
    ...(typeof info.cost === 'number' && Number.isFinite(info.cost) ? { cost: info.cost } : {}),
    ...(hasTokens ? { tokens: { input, output } } : {}),
    ...(info.outcome ? { outcome: info.outcome } : {}),
  };
}

function inEngineWorkspace(runtime: Runtime, info: EngineHostSessionInfo): boolean {
  return typeof info.location?.directory === 'string' && path.resolve(info.location.directory) === path.resolve(runtime.workspace);
}

function errorText(error: unknown): string {
  const message = (error as Error)?.message || 'unknown engine error';
  return message.slice(0, 300);
}

export async function createSession(input: { title?: string; model?: { providerID: string; model: string } } = {}): Promise<{ sessionId: string; agent: string; model: { providerID: string; id: string } | null }> {
  const host = await ensureHost();
  if (!host.built.defaultModel) throw new EngineError(503, 'ENGINE_UNAVAILABLE', 'The AI engine has no configured model.');
  // Only models this config actually exposes may be selected; no hidden paid route.
  const selected = input.model ?? host.built.defaultModel;
  const allowed = host.built.models.some(entry => entry.providerId === selected.providerID && entry.model === selected.model);
  if (!allowed) throw new EngineError(422, 'ENGINE_MODEL_NOT_CONFIGURED', 'That model is not enabled in the engine configuration.');
  try {
    const session = await host.host.sessions.create({
      location: { directory: host.workspace },
      agent: ENGINE_AGENT_ID,
      model: { providerID: selected.providerID, id: selected.model },
      ...(input.title ? { title: input.title.slice(0, 200) } : { title: DEFAULT_SESSION_TITLE }),
    });
    sessionState(host, session.id);
    return { sessionId: session.id, agent: ENGINE_AGENT_ID, model: { providerID: selected.providerID, id: selected.model } };
  } catch (error) {
    if (error instanceof EngineError) throw error;
    throw new EngineError(502, 'ENGINE_SESSION_FAILED', 'The AI engine could not create a session: ' + errorText(error));
  }
}

export async function getSession(sessionId: string): Promise<EngineSessionSummary> {
  const host = await ensureHost();
  return toSessionSummary(await requireSession(host, sessionId));
}

export async function listSessions(input: { search?: string; limit?: number } = {}): Promise<EngineSessionSummary[]> {
  const host = await ensureHost();
  const requested = input.limit === undefined || !Number.isFinite(input.limit) ? MAX_SESSION_LIST : Math.trunc(input.limit);
  const limit = Math.min(MAX_SESSION_LIST, Math.max(1, requested));
  const search = input.search?.trim();
  try {
    const page = await host.host.sessions.list({
      limit,
      order: 'desc',
      ...(search ? { search } : {}),
    });
    return page.data
      .filter(session => inEngineWorkspace(host, session))
      .map(toSessionSummary);
  } catch (error) {
    throw new EngineError(502, 'ENGINE_LIST_FAILED', 'The AI engine could not list sessions: ' + errorText(error));
  }
}

/** Rename a session. The route validates 1..200 characters; this stays defensive. */
export async function renameSession(sessionId: string, title: string): Promise<EngineSessionSummary> {
  const host = await ensureHost();
  await requireSession(host, sessionId);
  const clean = title.trim();
  if (!clean || clean.length > 200) {
    throw new EngineError(422, 'ENGINE_TITLE_INVALID', 'A session title must be 1 to 200 characters.');
  }
  try {
    await host.host.sessions.update({ sessionID: sessionId, title: clean });
  } catch (error) {
    throw new EngineError(502, 'ENGINE_RENAME_FAILED', 'The AI engine could not rename this session: ' + errorText(error));
  }
  return toSessionSummary(await requireSession(host, sessionId));
}

/** Delete a session and every local stream/context entry that pointed at it. */
export async function deleteSession(sessionId: string): Promise<void> {
  const host = await ensureHost();
  await requireSession(host, sessionId);
  try {
    await host.host.sessions.remove({ sessionID: sessionId });
  } catch (error) {
    throw new EngineError(502, 'ENGINE_DELETE_FAILED', 'The AI engine could not delete this session: ' + errorText(error));
  }
  host.sessions.delete(sessionId);
  host.listeners.delete(sessionId);
  contexts.clear(sessionId);
}

/**
 * Switch a session's model. Only the config's exposed allow-list is accepted,
 * so a hidden paid model can never be selected through this route.
 */
export async function switchSessionModel(sessionId: string, model: { providerID: string; model: string }): Promise<EngineSessionSummary> {
  const host = await ensureHost();
  await requireSession(host, sessionId);
  const allowed = host.built.models.some(entry => entry.providerId === model.providerID && entry.model === model.model);
  if (!allowed) throw new EngineError(422, 'ENGINE_MODEL_NOT_CONFIGURED', 'That model is not enabled in the engine configuration.');
  try {
    await host.host.sessions.switchModel({ sessionID: sessionId, model: { providerID: model.providerID, id: model.model } });
  } catch (error) {
    throw new EngineError(502, 'ENGINE_MODEL_SWITCH_FAILED', 'The AI engine could not switch this session\'s model: ' + errorText(error));
  }
  return toSessionSummary(await requireSession(host, sessionId));
}

function modelOptions(built: BuiltEngineConfig | null): EngineModelsReport {
  if (!built) return { models: [], default: null };
  const models = built.models.map(entry => ({
    providerID: entry.providerId,
    id: entry.model,
    label: entry.label,
    free: entry.free,
    // A paid model exists here only because an explicit approval exposed it:
    // either AI_APPROVED_PAID_MODELS or the registry chain's paid approval.
    approvedPaid: !entry.free && (entry.paidApproved || entry.fromChain),
    default: built.defaultModel?.providerID === entry.providerId && built.defaultModel?.model === entry.model,
  }));
  return { models, default: built.defaultModel ? { ...built.defaultModel } : null };
}

/** Models the running host exposes. 503 ENGINE_UNAVAILABLE when it has no model. */
export async function availableModels(): Promise<EngineModelsReport> {
  const host = await ensureHost();
  return modelOptions(host.built);
}

/** Non-throwing catalog for status surfaces (GET /api/v2/providers). */
export function configuredModels(): EngineModelsReport {
  return modelOptions(boot?.built ?? null);
}

function markdownExport(session: EngineHostSessionInfo, messages: AdaptedEngineMessage[]): string {
  const lines: string[] = [];
  lines.push('# ' + ((session.title ?? '').trim() || 'Stragy research session'), '');
  lines.push('- Session: `' + session.id + '`');
  if (session.model) lines.push('- Model: `' + session.model.providerID + '/' + session.model.id + '`');
  if (typeof session.time?.created === 'number') lines.push('- Started: ' + new Date(session.time.created).toISOString());
  lines.push('- Exported: ' + new Date().toISOString(), '');
  for (const message of messages) {
    if (message.role === 'user') {
      const text = (message.text ?? '').trim();
      if (text) lines.push('## User', '', text, '');
      continue;
    }
    if (message.role !== 'assistant') continue; // tool rows are summarised with their turn
    const text = (message.text ?? '').trim();
    const activities = message.activities ?? [];
    const todos = message.todos ?? [];
    if (!text && !activities.length && !todos.length) continue;
    lines.push('## Assistant', '');
    if (text) lines.push(text, '');
    if (activities.length) {
      lines.push('### Tool activity', '');
      for (const activity of activities) {
        const summary = (activity.summary ?? activity.error?.message ?? '').trim();
        lines.push('- ' + humanToolName(activity.name) + ' · ' + activity.status + (summary ? ' · ' + summary : ''));
      }
      lines.push('');
    }
    if (todos.length) {
      lines.push('### Plan', '');
      for (const todo of todos) {
        const suffix = todo.status === 'in_progress' ? ' _(in progress)_' : todo.status === 'cancelled' ? ' _(cancelled)_' : '';
        lines.push('- [' + (todo.status === 'completed' ? 'x' : ' ') + '] ' + todo.content + suffix);
      }
      lines.push('');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * Markdown is built from stored messages (text, tool activity, plan); JSON is
 * the SDK's sanitized transfer document. Both are capped at 2 MB.
 */
export async function exportSession(sessionId: string, format: 'md' | 'json'): Promise<EngineExport> {
  const host = await ensureHost();
  const session = await requireSession(host, sessionId);
  let content: string;
  if (format === 'json') {
    try {
      content = JSON.stringify(await host.host.sessions.export({ sessionID: sessionId, sanitize: true }), null, 2);
    } catch (error) {
      throw new EngineError(502, 'ENGINE_EXPORT_FAILED', 'The AI engine could not export this session: ' + errorText(error));
    }
  } else {
    let page;
    try {
      page = await host.host.message.list({ sessionID: sessionId, limit: EXPORT_MESSAGE_LIMIT });
    } catch (error) {
      throw new EngineError(502, 'ENGINE_EXPORT_FAILED', 'The AI engine could not read this session: ' + errorText(error));
    }
    const ordered = [...(page.data ?? [])].sort((a, b) => messageCreatedAt(a) - messageCreatedAt(b));
    content = markdownExport(session, await adaptMessages(ordered, {}));
  }
  if (Buffer.byteLength(content, 'utf8') > EXPORT_MAX_BYTES) {
    throw new EngineError(413, 'ENGINE_EXPORT_TOO_LARGE', 'This session is larger than 2 MB and cannot be exported in one file.');
  }
  return { format, filename: 'stragy-session.' + format, content };
}

/**
 * Usage totals and provider limits. A failed SDK call stays null with a
 * warning: the UI must never render invented zeros as real usage.
 */
export async function usageReport(): Promise<EngineUsageReport> {
  const host = await ensureHost();
  const warnings: string[] = [];
  let stats: EngineHostStats | null = null;
  try {
    stats = await host.host.sessions.stats({});
  } catch (error) {
    warnings.push('Usage statistics are unavailable: ' + errorText(error));
  }
  let limits: EngineHostUsageLimits | null = null;
  try {
    limits = await host.host.usage.limits({});
  } catch (error) {
    warnings.push('Provider usage limits are unavailable: ' + errorText(error));
  }
  let sessions: EngineUsageSession[] = [];
  try {
    sessions = (await listSessions()).map(summary => ({
      sessionId: summary.sessionId,
      ...(summary.title ? { title: summary.title } : {}),
      ...(summary.updatedAt ? { updatedAt: summary.updatedAt } : {}),
      ...(summary.cost !== undefined ? { cost: summary.cost } : {}),
      ...(summary.tokens ? { tokens: summary.tokens } : {}),
    }));
  } catch (error) {
    warnings.push('Session usage is unavailable: ' + errorText(error));
  }
  return { stats, limits, sessions, warnings };
}

export interface EnginePromptInput {
  text: string;
  image?: EngineStagedImage;
}

/**
 * One clean title from the first user text; never invented. Fire-and-forget
 * after the prompt is accepted, and it only touches a default/empty title.
 */
async function autoTitleSession(runtime: Runtime, sessionId: string, fallbackText: string): Promise<void> {
  const info = await runtime.host.sessions.get({ sessionID: sessionId });
  const current = (info.title ?? '').trim();
  if (current && current !== DEFAULT_SESSION_TITLE) return;
  const clean = (value: string) => value.replace(/\s*\[Chart image attached:[\s\S]*$/i, ' ').replace(/\s+/g, ' ').trim();
  let first = fallbackText;
  try {
    const page = await runtime.host.message.list({ sessionID: sessionId, limit: 50, type: 'user' });
    const user = [...(page.data ?? [])]
      .filter(isUserMessage)
      .sort((a, b) => messageCreatedAt(a) - messageCreatedAt(b))[0] as { text?: unknown } | undefined;
    if (typeof user?.text === 'string' && clean(user.text)) first = user.text;
  } catch { /* fall back to the prompt that was just accepted */ }
  const title = clean(first).slice(0, AUTO_TITLE_MAX).trimEnd();
  if (!title) return;
  // Re-check after the message read: an operator rename must win the race.
  const latest = await runtime.host.sessions.get({ sessionID: sessionId });
  const latestTitle = (latest.title ?? '').trim();
  if (latestTitle && latestTitle !== DEFAULT_SESSION_TITLE) return;
  await runtime.host.sessions.update({ sessionID: sessionId, title });
}

export async function prompt(sessionId: string, input: EnginePromptInput): Promise<{ receiptId?: string }> {
  const host = await ensureHost();
  await requireSession(host, sessionId);
  let text = input.text.trim();
  const titleHint = text;
  if (input.image) {
    try {
      const attachment = contexts.addAttachment(sessionId, {
        dataUrl: input.image.dataUrl,
        mimeType: input.image.mimeType,
        name: input.image.name,
        hint: input.image.hint,
        currentStrategy: input.image.currentStrategy ? validateStrategy(input.image.currentStrategy).data : undefined,
      });
      text += (text ? '\n\n' : '') + '[Chart image attached: imageId=' + attachment.id + '. Call read_chart with this imageId, then get_chart_result with the jobId.]';
    } catch (error) {
      throw new EngineError(422, 'ENGINE_IMAGE_FAILED', 'The chart image could not be attached: ' + ((error as Error).message || 'unknown error'));
    }
  }
  if (!text) throw new EngineError(422, 'ENGINE_EMPTY_MESSAGE', 'A message needs text or a chart image.');
  try {
    const receipt = await host.host.sessions.prompt({ sessionID: sessionId, text: text.slice(0, 30_000) });
    // Auto-title never delays the 202 and never fails the prompt.
    void autoTitleSession(host, sessionId, titleHint).catch(error => {
      console.error(JSON.stringify({ event: 'engine_auto_title_failed', sessionId, message: errorText(error) }));
    });
    return { receiptId: typeof receipt?.id === 'string' ? receipt.id : undefined };
  } catch (error) {
    throw new EngineError(502, 'ENGINE_PROMPT_FAILED', 'The AI engine did not accept the message: ' + errorText(error));
  }
}

export function stageContext(sessionId: string, input: { currentStrategy?: unknown; screenContext?: unknown }): void {
  contexts.setContext(sessionId, input);
}

async function loadIndex(host: Runtime, sessionId: string): Promise<SessionState> {
  const state = sessionState(host, sessionId);
  if (state.index) return state;
  const items: unknown[] = [];
  try {
    for await (const item of host.host.sessions.log({ sessionID: sessionId, follow: false })) items.push(item);
  } catch {
    state.index = { byMessageId: new Map(), lastSeq: state.lastDurableSeq };
    return state;
  }
  const index = buildSeqIndex(items);
  state.index = index;
  if (index.lastSeq > state.lastDurableSeq) state.lastDurableSeq = index.lastSeq;
  return state;
}

export async function messages(sessionId: string): Promise<EngineMessagePage> {
  const host = await ensureHost();
  await requireSession(host, sessionId);
  const state = await loadIndex(host, sessionId);
  let page;
  try {
    page = await host.host.message.list({ sessionID: sessionId, limit: MAX_MESSAGE_HISTORY });
  } catch (error) {
    throw new EngineError(502, 'ENGINE_MESSAGES_FAILED', 'The AI engine could not read this session: ' + ((error as Error).message || 'unknown error'));
  }
  const raw = [...(page.data ?? [])].sort((a, b) => messageCreatedAt(a) - messageCreatedAt(b));
  const adapted = await adaptMessages(raw, {
    seqFor: (messageId) => state.index?.byMessageId.get(messageId) ?? 0,
    resolveJobResult: (jobId) => deps.jobs?.get(jobId)?.result,
  });
  // Every durable message usually maps to a step/inbox event. If a provider or
  // an older database skipped one, give it a bounded in-block seq rather than 0
  // so the polling fallback can still make progress.
  const ceiling = Math.max(1, state.lastDurableSeq, state.index?.lastSeq ?? 0);
  adapted.forEach((message, index) => {
    if (!message.seq) message.seq = Math.min(index + 1, ceiling) * 1_000;
  });
  return { messages: adapted, lastSeq: Math.max(state.lastDurableSeq, state.index?.lastSeq ?? 0) };
}

/** Durable log items after a seq cursor, mapped into the same wire events. */
async function replayFromLog(host: Runtime, sessionId: string, after: number): Promise<EngineSseEvent[]> {
  const state = sessionState(host, sessionId);
  const items: { type: string; created?: number; durable?: { seq?: number }; data?: Record<string, unknown>; seq?: number }[] = [];
  try {
    for await (const item of host.host.sessions.log({ sessionID: sessionId, follow: false, after: Math.max(0, Math.floor(after / 1_000)) })) {
      items.push(item as unknown as { type: string; created?: number; durable?: { seq?: number }; data?: Record<string, unknown>; seq?: number });
    }
  } catch {
    return [];
  }
  const events: EngineSseEvent[] = [];
  const emitted = new Set<string>();
  let lastStartedAt: number | undefined;
  for (const item of items) {
    if (item.type === 'log.synced') {
      const seq = typeof item.seq === 'number' ? item.seq : 0;
      if (seq > state.lastDurableSeq) state.lastDurableSeq = seq;
      continue;
    }
    const base = eventBase(item);
    if (!base) continue;
    const seq = base * 1_000;
    if (item.type === 'session.inbox.delivered') {
      const data = item.data ?? {};
      const inboxID = typeof data.inboxID === 'string' ? data.inboxID : '';
      const payloadItem = data.item && typeof data.item === 'object' ? data.item as { type?: unknown; payload?: { text?: unknown }; text?: unknown } : undefined;
      if (inboxID) {
        const text = await inboxText(host, sessionId, inboxID, payloadItem);
        events.push({ seq, type: 'message', message: { id: inboxID, role: 'user', ...(text ? { text } : {}), timestamp: item.created, seq }, engine: { type: item.type, seq: base } });
      }
      continue;
    }
    if (item.type === 'session.execution.started') {
      lastStartedAt = item.created;
      state.tools.clear();
      events.push({ seq, type: 'status', status: 'working', engine: { type: item.type, seq: base } });
      continue;
    }
    if (['session.tool.input.started', 'session.tool.called', 'session.tool.success', 'session.tool.failed'].includes(item.type)) {
      events.push(...toolActivityEvents(state, item));
      continue;
    }
    if (item.type === 'session.execution.succeeded' || item.type === 'session.execution.failed' || item.type === 'session.execution.interrupted') {
      const from = lastStartedAt ?? (state.lastEmittedAt ? state.lastEmittedAt + 1 : undefined);
      let turn: AdaptedEngineMessage[] = [];
      try { turn = await deriveTurnMessages(host, sessionId, base, from, item.created, emitted); }
      catch { /* still emit the idle marker below */ }
      for (const message of turn) emitted.add(message.id);
      events.push(...toMessageEvents(base, turn));
      if (item.type === 'session.execution.failed') {
        const data = item.data ?? {};
        events.push({ seq: base * 1_000 + 950, type: 'error', error: await failureText(host, sessionId, data.error), engine: { type: item.type, seq: base } });
      }
      events.push({ seq: base * 1_000 + 999, type: 'idle', status: 'idle', engine: { type: item.type, seq: base } });
      lastStartedAt = undefined;
      state.lastEmittedAt = item.created;
      continue;
    }
    if (item.type === 'session.retry.scheduled') { events.push({ seq, type: 'status', status: 'retrying', engine: { type: item.type, seq: base } }); continue; }
  }
  if (state.lastDurableSeq === 0) state.lastDurableSeq = items.reduce((max, item) => Math.max(max, eventBase(item)), 0);
  return events;
}

/** Everything after the cursor: recent buffer first, durable log when needed. */
export async function eventsAfter(sessionId: string, after: number): Promise<EngineSseEvent[]> {
  const host = await ensureHost();
  await requireSession(host, sessionId);
  const state = sessionState(host, sessionId);
  const cursor = Math.max(0, Math.floor(after));
  const buffered = state.buffer.filter(event => event.seq > cursor);
  const bufferCovers = state.buffer.length > 0 && state.buffer[0].seq <= cursor + 1;
  if (bufferCovers) return buffered;
  const replay = await replayFromLog(host, sessionId, cursor);
  const merged = new Map<number, EngineSseEvent>();
  for (const event of [...replay, ...buffered]) if (event.seq > cursor) merged.set(event.seq, event);
  return [...merged.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * Register a subscriber and replay after the cursor. Resolves once the replay
 * is flushed, so the caller may write headers before calling this, or after.
 */
export async function openSessionStream(sessionId: string, after: number, send: (event: EngineSseEvent) => void): Promise<() => void> {
  const host = await ensureHost();
  await requireSession(host, sessionId);
  let replaying = true;
  let closed = false;
  let maxSeq = Math.max(0, Math.floor(after));
  const pending: EngineSseEvent[] = [];
  const listener = (event: EngineSseEvent) => {
    if (closed) return;
    if (replaying) { pending.push(event); return; }
    if (event.seq <= maxSeq) return;
    maxSeq = event.seq;
    try { send(event); } catch { /* the HTTP response may have closed */ }
  };
  const set = host.listeners.get(sessionId) ?? new Set();
  set.add(listener);
  host.listeners.set(sessionId, set);
  const replay = await eventsAfter(sessionId, after);
  for (const event of replay) {
    if (event.seq <= maxSeq) continue;
    maxSeq = event.seq;
    try { send(event); } catch { /* closed */ }
  }
  replaying = false;
  pending.sort((a, b) => a.seq - b.seq);
  for (const event of pending) {
    if (event.seq <= maxSeq) continue;
    maxSeq = event.seq;
    try { send(event); } catch { /* closed */ }
  }
  return () => {
    closed = true;
    host.listeners.get(sessionId)?.delete(listener);
  };
}

export async function interrupt(sessionId: string): Promise<{ ok: boolean }> {
  const host = await ensureHost();
  await requireSession(host, sessionId);
  try {
    await host.host.sessions.interrupt({ sessionID: sessionId });
    return { ok: true };
  } catch (error) {
    throw new EngineError(502, 'ENGINE_INTERRUPT_FAILED', 'The AI engine could not interrupt this turn: ' + ((error as Error).message || 'unknown error'));
  }
}

/** Non-throwing status for health/QA surfaces. */
export function engineStatus(): { ready: boolean; hostStarted: boolean; defaultModel: { providerID: string; model: string } | null; warnings: string[]; configFile?: string; error?: { code: string; message: string } } {
  const built = boot?.built ?? null;
  return {
    ready: Boolean(built?.defaultModel),
    hostStarted: Boolean(runtime),
    defaultModel: built?.defaultModel ?? null,
    warnings: built?.warnings ?? [],
    ...(boot?.configFile ? { configFile: boot.configFile } : {}),
    ...(bootError ? { error: bootError } : {}),
  };
}

/** Close the host; safe to call more than once and from signal handlers. */
export async function closeEngine(): Promise<void> {
  const current = runtime;
  runtime = null;
  initPromise = null;
  if (!current) return;
  current.closed = true;
  try { current.abort.abort(); } catch { /* already aborted */ }
  try { await current.host.close(); } catch (error) {
    console.error(JSON.stringify({ event: 'engine_close_error', message: (error as Error).message }));
  }
}

function registerShutdownHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => { void closeEngine().catch(() => undefined); });
  }
}

/** Test seam: bypass the ESM SDK loader with a fake host factory. */
export function setEngineHostFactoryForTests(factory: (() => Promise<EngineHost>) | null): void {
  testHostFactory = factory;
}

/** Test seam: forget a session's buffered events/context (the host keeps history). */
export function resetEngineSessionCache(sessionId: string): void {
  runtime?.sessions.delete(sessionId);
  contexts.clear(sessionId);
}
