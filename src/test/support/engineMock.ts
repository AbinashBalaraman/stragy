import { vi } from 'vitest';
import type { EngineEvent } from '../../client/engine';

/**
 * In-memory stand-in for the engine client used by component tests. It models
 * the real contract: prompt -> 202, then assistant message events over the
 * subscription. Tests hand it a ResearchChatResponse-shaped payload (the
 * engine adapter's wire shape) or a function that builds one.
 */

type EngineInput = {
  text?: string;
  image?: { dataUrl: string; mimeType: string; name: string };
  hint?: string;
  history?: Array<{ role: string; text: string }>;
  currentStrategy?: unknown;
  screenContext?: unknown;
};

type Responder = (input: EngineInput, sessionId: string) => unknown | Promise<unknown>;

let replies: Array<Responder | unknown> = [];
let defaultReply: Responder | unknown | null = null;
let emitTo: ((event: EngineEvent) => void) | null = null;
let seq = 0;
let nextSessionId = 'ses_test';
let sessions: Array<Record<string, unknown>> = [];
let stored: { sessionId: string; lastSeq: number } | null = null;

const emit = (event: Omit<EngineEvent, 'seq'>) => {
  seq += 1;
  emitTo?.({ ...event, seq } as EngineEvent);
};

const resolveReply = async (input: EngineInput, sessionId: string): Promise<unknown> => {
  const entry = replies.length ? replies.shift() : defaultReply;
  if (entry === null || entry === undefined) return undefined;
  return typeof entry === 'function' ? await (entry as Responder)(input, sessionId) : await entry;
};

const assetResponse = (raw: unknown): unknown => {
  if (raw instanceof Error) throw raw;
  if (raw && typeof raw === 'object' && '__engineError' in raw) {
    const spec = raw as { message?: string; code?: string; status?: number };
    throw Object.assign(new Error(spec.message ?? 'Engine failed'), { code: spec.code ?? 'ENGINE_FAILED', status: spec.status ?? 0 });
  }
  return raw;
};

export const createEngineSession = vi.fn(async () => nextSessionId);
export const getEngineMessages = vi.fn(async () => ({ messages: [] as unknown[], lastSeq: 0 }));
export const getJobStatus = vi.fn(async (jobId: string) => ({ id: jobId, kind: 'scan', status: 'interrupted' as const }));
export const interruptEngineSession = vi.fn(async () => undefined);
export const isEngineUnavailable = vi.fn((error: unknown) => (error as { status?: number } | null)?.status === 404);
export const listEngineSessions = vi.fn(async (query?: string) => {
  const search = (query ?? '').trim().toLowerCase();
  const rows = search
    ? sessions.filter(session => String(session.title ?? '').toLowerCase().includes(search))
    : sessions;
  return rows.map(row => ({ ...row }));
});
export const listEngineModels = vi.fn(async () => ({
  models: [
    { providerID: 'opencode-go', id: 'hy4-flash-free', label: 'Hy4 Flash (free)', free: true, approvedPaid: false, default: true },
    { providerID: 'openrouter', id: 'openrouter/free', label: 'OpenRouter free', free: true, approvedPaid: false, default: false },
    { providerID: 'opencode-go', id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash (paid)', free: false, approvedPaid: true, default: false },
  ],
  default: { providerID: 'opencode-go', model: 'hy4-flash-free' },
}));
export const getEngineUsage = vi.fn(async () => ({
  stats: { sessions: 0, prompts: 0, steps: 0, tokens: {}, cost: null, models: [] },
  limits: null,
  sessions: [],
}));
export const getProviderStatus = vi.fn(async () => ({
  ai: { ready: false, models: [] as string[] },
  market: { configured: false, connected: false },
  voice: { configured: false },
}));
export const getMarketCache = vi.fn(async () => ({
  symbols: 0, bars: 0, firstDate: null, lastDate: null, dbBytes: 0,
  hits: 0, misses: 0, incrementalFetches: 0, lastFetchAt: null, dbPath: '',
}));
export const refreshMarketCache = vi.fn(async () => ({ status: 'done', refreshed: 0, failed: 0 }));
export const listJobs = vi.fn(async () => [] as Array<Record<string, unknown>>);
export const cancelJob = vi.fn(async () => undefined);
export const resumeJob = vi.fn(async () => undefined);
export const renameEngineSession = vi.fn(async (sessionId: string, title: string) => {
  sessions = sessions.map(session => session.sessionId === sessionId ? { ...session, title } : session);
  return { sessionId, title };
});
export const deleteEngineSession = vi.fn(async (sessionId: string) => {
  sessions = sessions.filter(session => session.sessionId !== sessionId);
});
export const switchEngineModel = vi.fn(async (sessionId: string, choice: { providerID: string; model: string }) => ({
  sessionId,
  model: { providerID: choice.providerID, id: choice.model },
}));
export const exportEngineSession = vi.fn(async (_sessionId: string, format: 'md' | 'json' = 'md') => ({
  format,
  filename: 'stragy-session.' + format,
  content: format === 'json' ? '{"messages":[]}' : '# Stragy chat\n',
}));
export const postEngineApproval = vi.fn(async () => undefined);
export const resumeInterruptedJob = vi.fn(async () => undefined);
export const readStoredEngineSession = vi.fn(() => stored);
export const writeStoredEngineSession = vi.fn((session: { sessionId: string; lastSeq: number }) => { stored = session; return true; });
export const clearStoredEngineSession = vi.fn(() => { stored = null; });
export const rememberEngineCursor = vi.fn();
export const writeSessionUrl = vi.fn();

export const normalizeToolActivities = (input: unknown): unknown[] => {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  return [input];
};
export const normalizeEngineTodos = (input: unknown): unknown[] => {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === 'object' && input && Array.isArray((input as { todos?: unknown[] }).todos)) return (input as { todos: unknown[] }).todos;
  return [];
};

type ToolPlan = { name: string; run: () => Promise<{ result?: unknown; error?: { code?: string; message?: string; jobId?: string } }> };
type HarnessReply = { message?: string; __engineTool?: ToolPlan };

export const postEngineMessage = vi.fn(async (sessionId: string, input: EngineInput) => {
  const raw = assetResponse(await resolveReply(input, sessionId));
  if (raw === undefined) return;
  const payload = raw as HarnessReply;
  const { __engineTool: tool, ...wire } = payload;
  emit({
    type: 'message',
    message: {
      id: 'ses_msg_' + seq,
      role: 'assistant',
      text: typeof payload.message === 'string' ? payload.message : '',
      payload: wire,
    },
  } as Omit<EngineEvent, 'seq'>);
  if (tool) {
    const outcome = await tool.run();
    emit({
      type: 'message',
      message: {
        id: 'ses_tool_' + seq,
        role: 'tool',
        tool: tool.name,
        ...(outcome.result !== undefined ? { result: outcome.result } : {}),
        ...(outcome.error ? { error: outcome.error } : {}),
      },
    } as Omit<EngineEvent, 'seq'>);
  }
  emit({ type: 'idle' });
});

export const subscribeEngineEvents = vi.fn((_sessionId: string, afterSeq: number, options: { onEvent: (event: EngineEvent) => void; onState?: (state: string) => void }) => {
  emitTo = options.onEvent;
  options.onState?.('open');
  return {
    close: vi.fn(),
    cursor: () => afterSeq,
    transport: () => 'sse' as const,
  };
});

/** Queue one reply; each prompt consumes the next entry. */
export function engineReply(value: Responder | unknown): void {
  replies = [value];
  defaultReply = value;
}

/** Queue an extra reply after the current one. */
export function engineReplyOnce(value: Responder | unknown): void {
  replies.push(value);
}

/** A reply used for every prompt (until reset). */
export function engineReplyDefault(value: Responder | unknown): void {
  defaultReply = value;
}

export function resetEngineReplies(): void {
  replies = [];
  defaultReply = null;
}

export function setEngineSessions(rows: Array<Record<string, unknown>>): void {
  sessions = rows.map(row => ({ ...row }));
}

export function setStoredEngineSession(session: { sessionId: string; lastSeq: number } | null): void {
  stored = session;
}

export function emitEngineEvent(event: Omit<EngineEvent, 'seq'>): void {
  emit(event);
}

export function resetEngineHarness(): void {
  replies = [];
  defaultReply = null;
  emitTo = null;
  seq = 0;
  nextSessionId = 'ses_test';
  sessions = [];
  stored = null;
  createEngineSession.mockClear();
  getEngineMessages.mockClear();
  interruptEngineSession.mockClear();
  listEngineSessions.mockClear();
  listEngineModels.mockClear();
  getEngineUsage.mockClear();
  getProviderStatus.mockClear();
  getMarketCache.mockClear();
  refreshMarketCache.mockClear();
  listJobs.mockClear();
  cancelJob.mockClear();
  resumeJob.mockClear();
  renameEngineSession.mockClear();
  deleteEngineSession.mockClear();
  switchEngineModel.mockClear();
  exportEngineSession.mockClear();
  postEngineApproval.mockClear();
  postEngineMessage.mockClear();
  subscribeEngineEvents.mockClear();
  writeStoredEngineSession.mockClear();
  clearStoredEngineSession.mockClear();
  rememberEngineCursor.mockClear();
  resumeInterruptedJob.mockClear();
  getJobStatus.mockClear();
}
