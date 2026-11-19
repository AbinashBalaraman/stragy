import { openEventStream } from './client';

export type OcEvent = {
  id?: string;
  type: string;
  data?: Record<string, unknown>;
};

type Listener = (event: OcEvent) => void;
type StatusListener = (status: 'connecting' | 'connected' | 'reconnecting' | 'stopped') => void;

/**
 * SSE parser with Last-Event-ID reconnect. The browser EventSource handles
 * reconnects itself, but this wrapper tracks the last id so a manual restart
 * after a deep outage can resume. Backoff avoids reconnect storms, event ids
 * are deduplicated, and a synthetic `session.resumed` makes consumers re-fetch
 * authoritative messages so no final answer or tool card is lost or duplicated.
 */
export class EventBridge {
  private source: EventSource | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private lastId: string | undefined;
  private seen = new Set<string>();
  private retried = 0;
  private stopped = true;
  private disconnected = false;
  status: 'connecting' | 'connected' | 'reconnecting' | 'stopped' = 'stopped';

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(s: typeof this.status) {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.source?.close();
    this.source = null;
    this.setStatus('stopped');
  }

  /** Force a reconnect (e.g. after a killed stream). Resumes from the last id. */
  reconnect() {
    if (this.stopped) return;
    this.source?.close();
    this.source = null;
    this.disconnected = true;
    this.setStatus('reconnecting');
    this.connect();
  }

  private emit(event: OcEvent) {
    for (const l of this.listeners) l(event);
  }

  private connect() {
    if (this.stopped) return;
    if (!this.disconnected) this.setStatus(this.retried ? 'reconnecting' : 'connecting');
    this.source = openEventStream(this.lastId);
    this.source.onopen = () => {
      this.retried = 0;
      this.setStatus('connected');
      if (this.disconnected) {
        this.disconnected = false;
        this.emit({ type: 'session.resumed', data: { lastEventId: this.lastId || null } });
      }
    };
    this.source.onmessage = (e) => {
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(e.data); } catch { /* ignore malformed */ }
      // The gate frames events without an SSE `id:` line; the durable event id
      // lives inside the JSON payload. Use it for dedup and resume.
      const id = String(parsed.id || e.lastEventId || '') || undefined;
      const event: OcEvent = { id, type: String(parsed.type || 'message'), data: parsed.data as Record<string, unknown> };
      if (id) {
        if (this.seen.has(id)) return; // replayed event — never duplicate a tool row
        this.seen.add(id);
        if (this.seen.size > 2000) this.seen = new Set(Array.from(this.seen).slice(-1000));
        this.lastId = id;
      }
      for (const l of this.listeners) l(event);
    };
    this.source.onerror = () => {
      this.source?.close();
      this.source = null;
      if (this.stopped) return;
      this.disconnected = true;
      this.setStatus('reconnecting');
      const delay = Math.min(1000 * 2 ** this.retried++, 15000);
      setTimeout(() => this.connect(), delay);
    };
  }
}

/** Tool state transitions from SSE: called -> running -> success/failed. */
export function toolStatusFromEvent(type: string): { callID?: string; status?: string } {
  const m = type.match(/^session\.tool\.(.+)$/);
  if (!m) return {};
  const kind = m[1];
  if (kind === 'called') return { status: 'called' };
  if (kind.startsWith('input.')) return { status: 'running' };
  if (kind === 'success') return { status: 'success' };
  if (kind === 'failed') return { status: 'failed' };
  return { status: kind };
}
