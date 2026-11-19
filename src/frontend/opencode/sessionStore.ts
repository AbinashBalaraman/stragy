import type { Message, SessionInfo, ToolPart } from './client';

export type ToolState = {
  id: string;
  name: string;
  status: 'called' | 'running' | 'success' | 'failed' | 'pending';
  input?: unknown;
  output?: unknown;
  error?: string;
};

export type ViewMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  imageUris: string[];
  tools: ToolState[];
  /** Epoch milliseconds from the OpenCode message, when present. */
  time?: number;
};

/** Hide the transport instructions the UI adds from the user's own bubble. */
function withoutPromptScaffolding(text: string): string {
  return text
    .replace(/^Reply in (?:English|Tamil \(தமிழ்\))\.(?: Keep tickers[^\n]*)?\n\n/, '')
    .replace(/\n\nThis is a spoken turn: answer in at most two short sentences\.\s*$/, '')
    .trim();
}

/**
 * Normalize an image reference to something an <img> can load.
 * Raw base64 is NOT a URL: JPEG base64 starts with "/9j/", so a naive
 * startsWith('/') check turns every stored JPEG into a broken relative
 * request (GET /9j/4AAQ...). Only short, route-like paths pass through.
 */
export function normalizeImageUri(uri: string, mime?: string): string {
  if (uri.startsWith('data:') || uri.startsWith('blob:')) return uri;
  const isRoute = uri.startsWith('/') && uri.length < 512
    && (/^\/(api|opencode|assets|tts)\//.test(uri) || /\.[a-z0-9]{2,5}$/i.test(uri));
  if (isRoute) return uri;
  return `data:${mime || 'image/png'};base64,${uri}`;
}

/** OpenCode tool parts carry results in state.content[].text, not state.output. */
function toolOutput(st: Record<string, unknown> | undefined): unknown {
  if (!st) return undefined;
  if (st.output != null) return st.output;
  if (Array.isArray(st.content)) {
    const texts = (st.content as Array<Record<string, unknown>>)
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string);
    if (texts.length) return texts.join('\n');
  }
  return undefined;
}

/** Derive a flat, renderable message list from OpenCode message parts. */
export function deriveMessages(messages: Message[]): ViewMessage[] {
  const list = messages
    .filter((m) => m.type === 'user' || m.type === 'assistant')
    .map((m) => {
      const imageUris: string[] = [];
      const tools: ToolState[] = [];
      let text = m.text || m.metadata?.displayText || '';

      const parts = m.content || [];
      const texts: string[] = [];
      for (const part of parts) {
        const p = part as Record<string, unknown>;
        switch (p.type) {
          case 'text':
            if (typeof p.text === 'string') texts.push(p.text);
            break;
          case 'file': {
            const uri = (p.uri as string) || (p.data as string);
            if (uri) imageUris.push(normalizeImageUri(uri, p.mime as string | undefined));
            break;
          }
          case 'tool': {
            const st = p.state as Record<string, unknown> | undefined;
            const raw = String(st?.status || 'pending').toLowerCase();
            // OpenCode uses "completed"; the plan/UI vocabulary uses "success".
            const status: ToolState['status'] =
              raw === 'completed' || raw === 'success' ? 'success'
              : raw === 'failed' || raw === 'error' ? 'failed'
              : raw === 'running' || raw === 'in_progress' || raw === 'called' ? 'running'
              : 'pending';
            tools.push({
              id: String(p.id || p.name || 'tool'),
              name: String(p.name || 'tool'),
              status,
              input: st?.input,
              output: toolOutput(st),
              error: st?.error ? String(st.error) : undefined,
            });
            break;
          }
          case 'reasoning':
            break;
          default:
            break;
        }
      }
      if (texts.length) text = texts.join('\n');
      // user messages carry files separately from content
      for (const f of m.files || []) {
        const uri = f.uri || f.data;
        if (uri) imageUris.push(normalizeImageUri(uri, f.mime));
      }
      return {
        id: m.id,
        role: m.type === 'user' ? 'user' as const : 'assistant' as const,
        text: m.type === 'user' ? withoutPromptScaffolding(text) : text,
        imageUris,
        tools,
        time: m.time?.created,
      };
    });
  // OpenCode returns newest-first; the transcript is chronological.
  return list.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}

/** Merge an SSE tool event into an existing message list without duplicates. */
export function upsertTool(messages: ViewMessage[], toolId: string, patch: Partial<ToolState>): ViewMessage[] {
  let touched = false;
  const next = messages.map((m) => {
    const idx = m.tools.findIndex((t) => t.id === toolId);
    if (idx < 0) return m;
    touched = true;
    const tools = m.tools.slice();
    tools[idx] = { ...tools[idx], ...patch };
    return { ...m, tools };
  });
  return touched ? next : messages;
}

export function sortSessions(sessions: SessionInfo[]): SessionInfo[] {
  return sessions.slice().sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0));
}

export function toolTitle(tool: ToolState): string {
  return tool.name.replace(/_/g, ' ');
}

export function toolOutputPreview(output: unknown): string {
  if (output == null) return '';
  if (typeof output === 'string') return output;
  try { return JSON.stringify(output); } catch { return String(output); }
}

export type { ToolPart };
