// @vitest-environment jsdom
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EngineError, createEngineSession, getEngineMessages, getEngineUsage, isEngineUnavailable, listEngineSessions,
  listJobs, getMarketCache, postEngineMessage,
  normalizeEngineTodos, normalizeToolActivities,
  readStoredEngineSession, subscribeEngineEvents, writeStoredEngineSession, ENGINE_SESSION_KEY,
} from '../../client/engine';

let dom: JSDOM;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(event: { data: string }) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: { data: string }) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  fail() { this.onerror?.(); }
  close() { this.closed = true; }
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  dom = new JSDOM('', { url: 'https://engine-client.test' });
  vi.stubGlobal('localStorage', dom.window.localStorage);
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  dom.window.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('engine REST client', () => {
  it('creates a session and validates the receipt', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ sessionId: 'ses_1' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    expect(await createEngineSession()).toBe('ses_1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v2/engine/sessions');
  });

  it('surfaces a missing engine route as a typed unavailable error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Not found' }, 404)));
    const error = await createEngineSession().catch(caught => caught);
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).status).toBe(404);
    expect(isEngineUnavailable(error)).toBe(true);
  });

  it('posts the prompt and accepts the 202 receipt', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ accepted: true }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    await postEngineMessage('ses_1', { text: 'Set my stop loss to 3%' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v2/engine/sessions/ses_1/messages');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body)).text).toBe('Set my stop loss to 3%');
  });

  it('rejects an image-only message with no image', async () => {
    await expect(postEngineMessage('ses_1', {})).rejects.toBeInstanceOf(EngineError);
  });

  it('loads the durable message list and keeps a usable cursor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      lastSeq: 4,
      messages: [
        { id: 'm1', role: 'user', text: 'hello', seq: 1 },
        { id: 'm2', role: 'assistant', text: 'hi', seq: 2, payload: { kind: 'conversation' } },
        { id: 'broken' },
      ],
    })));
    const page = await getEngineMessages('ses_1');
    expect(page.messages.map(message => message.id)).toEqual(['m1', 'm2']);
    expect(page.lastSeq).toBe(4);
  });

  it('persists and restores { sessionId, lastSeq } defensively', () => {
    expect(readStoredEngineSession()).toBeNull();
    expect(writeStoredEngineSession({ sessionId: 'ses_1', lastSeq: 3.7 })).toBe(true);
    expect(JSON.parse(localStorage.getItem(ENGINE_SESSION_KEY) ?? '{}')).toEqual({ sessionId: 'ses_1', lastSeq: 3 });
    expect(readStoredEngineSession()).toEqual({ sessionId: 'ses_1', lastSeq: 3 });
    localStorage.setItem(ENGINE_SESSION_KEY, '{not json');
    expect(readStoredEngineSession()).toBeNull();
    localStorage.setItem(ENGINE_SESSION_KEY, JSON.stringify({ sessionId: '', lastSeq: -1 }));
    expect(readStoredEngineSession()).toBeNull();
  });
});

describe('engine tool activity and plan normalization', () => {
  it('maps status aliases, typed errors, durations and drops malformed entries', () => {
    const entries = normalizeToolActivities([
      { name: 'check_symbol', status: 'completed', summary: 'Checked TCS against 3 conditions', durationMs: 180 },
      { tool: 'scan_market', status: 'in-progress', durationMs: -5 },
      { name: 'run_backtest', status: 'error', error: { code: 'JOB_FAILED', message: 'The provider was busy.' } },
      { status: 'success' },
      'not an activity',
    ]);
    expect(entries.map(entry => [entry.name, entry.status])).toEqual([
      ['check_symbol', 'success'],
      ['scan_market', 'running'],
      ['run_backtest', 'failed'],
    ]);
    expect(entries[0].durationMs).toBe(180);
    expect(entries[2].error).toEqual({ code: 'JOB_FAILED', message: 'The provider was busy.' });
  });

  it('normalizes todo aliases from an object, a list, or a todo-tool result', () => {
    expect(normalizeEngineTodos({ todos: [
      { content: 'Check RSI', status: 'done' },
      { text: 'Scan NIFTY 50', status: 'in-progress' },
      { title: 'Review matches', status: 'pending' },
      { content: 'Cancelled step', status: 'skipped' },
    ] }).map(item => [item.content, item.status])).toEqual([
      ['Check RSI', 'completed'],
      ['Scan NIFTY 50', 'in_progress'],
      ['Review matches', 'pending'],
      ['Cancelled step', 'cancelled'],
    ]);
    expect(normalizeEngineTodos(['One', 'Two']).map(item => item.status)).toEqual(['pending', 'pending']);
    expect(normalizeEngineTodos({ content: 'Single', status: 'active' })).toEqual([]);
  });

  it('delivers tool and todo SSE events with their normalized payload', async () => {
    const events: Array<{ type: string; name?: string; todos?: unknown }> = [];
    const subscription = subscribeEngineEvents('ses_tool', 0, {
      onEvent: event => events.push({ type: event.type, ...(event.activity ? { name: event.activity.name } : {}), ...(event.todos ? { todos: event.todos } : {}) }),
      onCursor: () => undefined,
    });
    const source = FakeEventSource.instances[0];
    source.emit({
      seq: 1,
      type: 'tool',
      activity: { type: 'tool', name: 'scan_market', status: 'running', summary: 'Scanning NIFTY 50' },
    });
    source.emit({ seq: 2, type: 'todo', todos: [{ content: 'Check RSI', status: 'done' }, { content: 'Scan', status: 'in_progress' }] });
    expect(events).toEqual([
      { type: 'tool', name: 'scan_market' },
      { type: 'todo', todos: [{ content: 'Check RSI', status: 'completed' }, { content: 'Scan', status: 'in_progress' }] },
    ]);
    subscription.close();
  });
});

describe('engine SSE subscription', () => {
  it('reconnects from the cursor and never delivers a seq twice', async () => {
    vi.useFakeTimers();
    const events: number[] = [];
    const onCursor = vi.fn();
    const subscription = subscribeEngineEvents('ses_1', 0, {
      onEvent: event => events.push(event.seq),
      onCursor,
    });
    const first = FakeEventSource.instances[0];
    expect(first.url).toContain('/api/v2/engine/sessions/ses_1/events?after=0');
    first.onopen?.();
    first.emit({ seq: 1, type: 'message', message: { id: 'm1', role: 'user', text: 'hello' } });
    first.emit({ seq: 2, type: 'status', status: 'working' });
    first.fail();
    await vi.advanceTimersByTimeAsync(600);
    const second = FakeEventSource.instances[1];
    expect(second).toBeDefined();
    expect(second.url).toContain('after=2');
    // The replay starts at the cursor: seq 2 again is dropped, seq 3 is new.
    second.emit({ seq: 2, type: 'status', status: 'working' });
    second.emit({ seq: 3, type: 'message', message: { id: 'm2', role: 'assistant', text: 'hi' } });
    expect(events).toEqual([1, 2, 3]);
    expect(onCursor).toHaveBeenLastCalledWith(3);
    expect(subscription.cursor()).toBe(3);
    // Simulate a server restart: the transport drops again, still cursor-first.
    second.fail();
    await vi.advanceTimersByTimeAsync(1_200);
    expect(FakeEventSource.instances[2].url).toContain('after=3');
    subscription.close();
    expect(FakeEventSource.instances[2].closed).toBe(true);
  });

  it('falls back to polling the message list without EventSource and dedupes by id', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', undefined);
    const pages = [
      { lastSeq: 2, messages: [{ id: 'm1', role: 'user', text: 'hello', seq: 1 }, { id: 'm2', role: 'assistant', text: 'one', seq: 2 }] },
      { lastSeq: 3, messages: [{ id: 'm2', role: 'assistant', text: 'one', seq: 2 }, { id: 'm3', role: 'assistant', text: 'two', seq: 3 }] },
    ];
    const fetchMock = vi.fn(async () => jsonResponse(pages.length > 1 ? pages.shift() : pages[0]));
    vi.stubGlobal('fetch', fetchMock);
    const seen: string[] = [];
    subscribeEngineEvents('ses_2', 0, { onEvent: event => seen.push(event.message?.id ?? ''), pollMs: 1_000 });
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(1_100);
    await vi.advanceTimersByTimeAsync(50);
    expect(seen).toEqual(['m1', 'm2', 'm3']);
    expect(readStoredEngineSession()).toEqual({ sessionId: 'ses_2', lastSeq: 3 });
  });
});


describe('engine management client', () => {
  it('encodes the history search query', async () => {
    const fetchMock = vi.fn(async (_url: string) => jsonResponse({ sessions: [{ sessionId: 'ses_1', title: 'RSI scan' }] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await listEngineSessions('RSI & breakout')).toEqual([{ sessionId: 'ses_1', title: 'RSI scan' }]);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v2/engine/sessions?q=RSI%20%26%20breakout');
    await listEngineSessions();
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v2/engine/sessions');
  });

  it('keeps stats null instead of inventing zeros when the stats call failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ stats: null, limits: null, sessions: [], warnings: ['stats_unavailable'] })));
    const usage = await getEngineUsage();
    expect(usage.stats).toBeNull();
    expect(usage.warnings).toEqual(['stats_unavailable']);
    expect(usage.sessions).toEqual([]);
  });

  it('reads the nested SDK model entry in usage stats', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      stats: {
        sessions: 1, prompts: 1, steps: 2, tokens: { input: 10, output: 5 }, cost: 0,
        models: [{ model: { id: 'hy4-flash-free', providerID: 'opencode-go', variant: 'default' }, steps: 2, tokens: { input: 10, output: 5 }, cost: 0 }],
      },
      limits: null,
      sessions: [],
    })));
    const usage = await getEngineUsage();
    expect(usage.stats?.models[0]).toMatchObject({ providerID: 'opencode-go', id: 'hy4-flash-free', label: 'hy4-flash-free', cost: 0 });
  });

  it('parses real usage numbers and per-model cost', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      stats: {
        sessions: 2, prompts: 5, steps: 9,
        tokens: { input: 1200, output: 300 },
        cost: 0.0042,
        models: [{ providerID: 'opencode-go', id: 'hy4-flash-free', cost: 0, tokens: { input: 1100, output: 250 } }],
      },
      limits: null,
      sessions: [{ sessionId: 'ses_1', title: 'One', cost: 0.0042, tokens: { input: 1100, output: 250 } }],
      windowDays: 30,
    })));
    const usage = await getEngineUsage();
    expect(usage.stats?.cost).toBe(0.0042);
    expect(usage.stats?.tokens).toEqual({ input: 1200, output: 300 });
    expect(usage.stats?.models[0]?.cost).toBe(0);
    expect(usage.windowDays).toBe(30);
  });

  it('parses the job list with progress and resumability', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      jobs: [{ id: 'job_1', kind: 'scan', status: 'running', progress: { processed: 120, total: 200 }, resumable: false, universe: 'NIFTY_50' }],
    })));
    const jobs = await listJobs(20);
    expect(jobs).toEqual([{
      id: 'job_1', kind: 'scan', status: 'running',
      progress: { processed: 120, total: 200 }, resumable: false, universe: 'NIFTY_50',
    }]);
  });

  it('reads the market cache stats from either shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ stats: { symbols: 3, bars: 300, dbBytes: 2048, hits: 4, misses: 1 } })));
    expect(await getMarketCache()).toMatchObject({ symbols: 3, bars: 300, dbBytes: 2048, hits: 4, misses: 1, firstDate: null });
  });
});
