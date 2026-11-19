/** Typed fetch wrapper for the OpenCode gate, reached same-origin at /opencode. */
export const BASE = '/opencode/api';

export type ApiError = Error & { status?: number };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`OpenCode ${res.status}: ${text.slice(0, 300)}`) as ApiError;
    err.status = res.status;
    throw err;
  }
  const json = await res.json().catch(() => ({}));
  return (json && typeof json === 'object' && 'data' in json ? json.data : json) as T;
}

export type ModelRef = { id: string; providerID: string; variant?: string };
export type SessionInfo = {
  id: string;
  title?: string;
  agent?: string;
  model?: ModelRef;
  time?: { created: number; updated: number; idle?: number };
  location?: { directory: string };
};

export type ToolPart = {
  type: 'tool';
  id: string;
  name: string;
  state?: {
    status: string;
    input?: unknown;
    output?: unknown;
    error?: string;
    title?: string;
  };
};
export type TextPart = { type: 'text'; text: string };
export type FilePart = { type: 'file'; uri?: string; data?: string; mime?: string; name?: string };
export type ReasoningPart = { type: 'reasoning'; text?: string };
export type MessagePart = TextPart | ToolPart | FilePart | ReasoningPart | { type: string; [k: string]: unknown };

export type Message = {
  id: string;
  type: 'user' | 'assistant' | 'idle' | string;
  text?: string;
  files?: Array<{ data?: string; uri?: string; mime?: string; name?: string }>;
  content?: MessagePart[];
  time?: { created: number };
  metadata?: { displayText?: string };
};

export type VoiceModelInfo = { model: string; provider: string; transports: string[]; available: boolean };
export type VoiceModels = { models: VoiceModelInfo[]; default: string };

export const opencode = {
  info: () => request<Record<string, unknown>>('/info'),

  listSessions: () => request<SessionInfo[]>('/session'),
  createSession: () => request<SessionInfo>('/session', { method: 'POST', body: '{}' }),
  getSession: (id: string) => request<SessionInfo>(`/session/${encodeURIComponent(id)}`),
  renameSession: (id: string, title: string) =>
    request<SessionInfo>(`/session/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  deleteSession: (id: string) =>
    request<void>(`/session/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getMessages: (id: string) => request<Message[]>(`/session/${encodeURIComponent(id)}/message`),
  inspectMessage: (sessionId: string, messageId: string) =>
    request<Message>(`/session/${encodeURIComponent(sessionId)}/message/${encodeURIComponent(messageId)}`),

  /** Text or inline-image prompt. files[].uri is a data: URI; source.type is inline. */
  prompt: (id: string, body: { text: string; files?: Array<{ uri: string; source: { type: 'inline' }; name?: string; description?: string }> }) =>
    request<unknown>(`/session/${encodeURIComponent(id)}/prompt`, { method: 'POST', body: JSON.stringify(body) }),

  command: (id: string, body: { name: string; text: string; files?: unknown[] }) =>
    request<unknown>(`/session/${encodeURIComponent(id)}/command`, { method: 'POST', body: JSON.stringify(body) }),

  interrupt: (id: string) =>
    request<unknown>(`/session/${encodeURIComponent(id)}/interrupt`, { method: 'POST', body: '{}' }),

  setModel: (id: string, model: ModelRef) =>
    request<unknown>(`/session/${encodeURIComponent(id)}/model`, { method: 'POST', body: JSON.stringify({ model }) }),

  listModels: () => request<Array<{ id: string; providerID: string; name?: string }>>('/model'),
  listAgents: () => request<Array<{ name: string; description?: string; hidden?: boolean }>>('/agent'),
  listCommands: () => request<Array<{ name: string; description?: string }>>('/command'),

  /** Best-effort language instruction entry. Experimental; failures are non-fatal. */
  setLanguageInstruction: (sessionId: string, lang: 'en' | 'ta') =>
    request<unknown>(
      `/experimental/session/${encodeURIComponent(sessionId)}/instructions/entries/stragy.language`,
      {
        method: 'PUT',
        body: JSON.stringify({
          value: lang === 'ta'
            ? { language: 'ta', reply_in: 'Tamil (தமிழ்)', note: 'All prose replies must be in Tamil; keep tickers, numbers, indicators and tool names in Latin.' }
            : { language: 'en', reply_in: 'English' },
        }),
      },
    ),

  voiceModels: () => request<VoiceModels>('/experimental/voice/models'),
  createVoiceSession: (body: { model: string; session?: Record<string, unknown>; transport: { type: 'webrtc'; sdp: string; dcid?: number } }) =>
    request<{ transport: { type: string; sdp?: string } }>('/experimental/voice/session', {
      method: 'POST', body: JSON.stringify(body),
    }),

  schedules: (sessionId: string) =>
    request<{ data?: unknown[] } | unknown[]>(`/experimental/schedule?sessionID=${encodeURIComponent(sessionId)}`),
};

/** Open the SSE event stream. Reconnect with Last-Event-ID in events.ts. */
export function openEventStream(lastEventId?: string): EventSource {
  const url = `${BASE}/event`;
  // EventSource cannot set the Last-Event-ID header manually; the browser
  // restores it automatically on native reconnect. We pass it as a query
  // fallback for servers that read it there.
  const src = new EventSource(lastEventId ? `${url}?lastEventId=${encodeURIComponent(lastEventId)}` : url);
  return src;
}
