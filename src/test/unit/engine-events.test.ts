import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The host is faked through the runtime shim's test seam; the engine's own
 * fan-out, durable cursor and replay logic are the real code. This keeps the
 * SSE contract test offline, deterministic, and exercises the same ESM bridge
 * the production bundle uses.
 */
import { initializeProviderRegistry, resetProviderRegistryCache } from '../../server/ai/providerRegistry';

interface FakeEvent { type: string; created?: number; durable?: { seq: number }; data?: Record<string, unknown> }

function eventStream() {
  const queue: FakeEvent[] = [];
  const waiters: ((value: IteratorResult<FakeEvent>) => void)[] = [];
  let closed = false;
  return {
    push(event: FakeEvent) {
      if (waiters.length) waiters.shift()!({ value: event, done: false });
      else queue.push(event);
    },
    close() {
      closed = true;
      for (const waiter of waiters.splice(0)) waiter({ value: undefined as never, done: true });
    },
    async *[Symbol.asyncIterator]() {
      while (!closed || queue.length) {
        if (queue.length) { yield queue.shift()!; continue; }
        const next = await new Promise<IteratorResult<FakeEvent>>(resolve => waiters.push(resolve));
        if (next.done) return;
        yield next.value;
      }
    },
  };
}

function createFakeHost() {
  const sessions = new Map<string, { id: string; title?: string; location: { directory: string }; agent?: string; model?: { providerID: string; id: string }; time: { created: number; updated: number } }>();
  const stream = eventStream();
  const state = { logItems: [] as unknown[], messageItems: [] as unknown[] };
  const host = {
    sessions: {
      create: async (input: { location: { directory: string }; title?: string }) => {
        const info = { id: 'ses_test', title: input.title ?? 'test', location: input.location, agent: 'stragy', model: { providerID: 'opencode-go', id: 'hy4-flash-free' }, time: { created: 1, updated: 2 } };
        sessions.set(info.id, info);
        return info;
      },
      get: async ({ sessionID }: { sessionID: string }) => {
        const info = sessions.get(sessionID);
        if (!info) throw new Error('Session not found');
        return info;
      },
      list: async () => ({ data: [...sessions.values()], cursor: {} }),
      prompt: async () => ({ id: 'msg_user' }),
      interrupt: async () => ({}),
      log: async function* (input: { after?: number }) {
        for (const item of state.logItems as { durable?: { seq?: number }; seq?: number }[]) {
          const seq = item.durable?.seq ?? item.seq ?? 0;
          if (seq > (input.after ?? -1)) yield item;
        }
      },
    },
    message: { list: async () => ({ data: state.messageItems, cursor: {} }) },
    events: { subscribe: () => stream },
    close: async () => { stream.close(); },
  };
  return { host, stream, state };
}

type EngineModule = typeof import('../../server/ai/engine');
let engine: EngineModule;
let fakeHost: ReturnType<typeof createFakeHost>;
let folder: string;

const user = { id: 'u1', type: 'user', text: 'Hello', time: { created: 900 } };
const assistant = { id: 'a1', type: 'assistant', time: { created: 1100 }, content: [{ type: 'text', text: 'A stop loss caps the loss per trade.' }], finish: 'stop' };

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('condition not met');
}

beforeEach(async () => {
  vi.stubEnv('AI_PROVIDER', 'opencode-go');
  vi.stubEnv('OPENCODE_API_KEY', 'test-key');
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
  vi.stubEnv('AI_PROVIDERS_FILE', '/nonexistent/ai-providers.json');
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('DATABASE_URL_UNPOOLED', '');
  resetProviderRegistryCache();
  await initializeProviderRegistry(process.env);
  fakeHost = createFakeHost();
  await mkdir(path.resolve('src/test/.tmp'), { recursive: true });
  folder = await mkdtemp(path.resolve('src/test/.tmp/engine-events-'));
  engine = await import('../../server/ai/engine');
  engine.setEngineHostFactoryForTests(async () => fakeHost.host as never);
  engine.configureEngine({ rootDir: folder, env: process.env, dataMode: 'demo' });
  await engine.initializeEngine();
  fakeHost.state.logItems = [
    { type: 'session.inbox.enqueued', durable: { seq: 1 }, created: 800, data: { sessionID: 'ses_test', inboxID: 'u1', item: { type: 'user', payload: { text: 'Hello' } } } },
    { type: 'session.inbox.delivered', durable: { seq: 2 }, created: 850, data: { sessionID: 'ses_test', inboxID: 'u1', item: { type: 'user', payload: { text: 'Hello' } } } },
    { type: 'session.execution.started', durable: { seq: 3 }, created: 1000, data: { sessionID: 'ses_test' } },
    { type: 'session.step.ended', durable: { seq: 4 }, created: 1900, data: { sessionID: 'ses_test', assistantMessageID: 'a1' } },
    { type: 'session.execution.succeeded', durable: { seq: 5 }, created: 2000, data: { sessionID: 'ses_test' } },
    { type: 'log.synced', seq: 5 },
  ];
  fakeHost.state.messageItems = [user, assistant, { id: 'idle1', type: 'idle', outcome: 'succeeded', time: { created: 2100 } }];
});

afterEach(async () => {
  await engine.closeEngine();
  engine.setEngineHostFactoryForTests(null);
  resetProviderRegistryCache();
  vi.unstubAllEnvs();
  await rm(folder, { recursive: true, force: true });
});

describe('engine event fan-out and durable cursor', () => {
  it('replays user, status, assistant and idle in strictly increasing seq order', async () => {
    const session = await engine.createSession();
    expect(session.sessionId).toBe('ses_test');
    const events = await engine.eventsAfter('ses_test', 0);
    const types = events.map(event => event.type);
    expect(types).toContain('status');
    expect(types).toContain('message');
    expect(types).toContain('idle');
    const userEvent = events.find(event => event.type === 'message' && event.message?.role === 'user')!;
    expect(userEvent.seq).toBe(2000);
    expect(userEvent.message?.text).toBe('Hello');
    const assistantEvent = events.find(event => event.type === 'message' && event.message?.role === 'assistant')!;
    expect(assistantEvent.seq).toBe(5001);
    expect(assistantEvent.message?.text).toMatch(/stop loss/i);
    const idle = events.find(event => event.type === 'idle')!;
    expect(idle.seq).toBe(5999);
    for (let index = 1; index < events.length; index++) expect(events[index].seq).toBeGreaterThan(events[index - 1].seq);
  });

  it('reconnects after a cursor without replaying what the client already has', async () => {
    await engine.createSession();
    const events = await engine.eventsAfter('ses_test', 3000);
    expect(events.every(event => event.seq > 3000)).toBe(true);
    expect(events.some(event => event.message?.role === 'user')).toBe(false);
    expect(events.some(event => event.type === 'status')).toBe(false);
    expect(events.some(event => event.message?.role === 'assistant')).toBe(true);
  });

  it('streams live durable events after the replay and keeps seq monotonic', async () => {
    await engine.createSession();
    const received: { seq: number; type: string }[] = [];
    const unsubscribe = await engine.openSessionStream('ses_test', 0, event => received.push({ seq: event.seq, type: event.type }));
    const replayCount = received.length;
    expect(replayCount).toBeGreaterThan(0);
    fakeHost.stream.push({ type: 'session.execution.started', durable: { seq: 6 }, created: 2500, data: { sessionID: 'ses_test' } });
    await waitFor(() => received.length > replayCount);
    expect(received.at(-1)).toEqual({ seq: 6000, type: 'status' });
    const before = received.length;
    unsubscribe();
    fakeHost.stream.push({ type: 'session.execution.succeeded', durable: { seq: 7 }, created: 2600, data: { sessionID: 'ses_test' } });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(received.length).toBe(before);
  });

  it('streams normalized tool activity and the todo plan from the durable log', async () => {
    fakeHost.state.logItems = [
      { type: 'session.inbox.delivered', durable: { seq: 1 }, created: 800, data: { sessionID: 'ses_test', inboxID: 'u1', item: { type: 'user', payload: { text: 'Plan it' } } } },
      { type: 'session.execution.started', durable: { seq: 2 }, created: 900, data: { sessionID: 'ses_test' } },
      { type: 'session.tool.input.started', durable: { seq: 3 }, created: 1000, data: { sessionID: 'ses_test', assistantMessageID: 'a1', id: 'call_todo', name: 'todowrite' } },
      { type: 'session.tool.called', durable: { seq: 4 }, created: 1010, data: { sessionID: 'ses_test', assistantMessageID: 'a1', id: 'call_todo', input: { todos: [] } } },
      { type: 'session.tool.success', durable: { seq: 5 }, created: 1120, data: { sessionID: 'ses_test', assistantMessageID: 'a1', id: 'call_todo', content: [{ type: 'text', text: 'Todos updated: 1 in progress, 1 pending' }], metadata: { todos: [{ content: 'Scan', status: 'in_progress' }, { content: 'Backtest', status: 'pending' }] } } },
      { type: 'session.execution.succeeded', durable: { seq: 6 }, created: 2000, data: { sessionID: 'ses_test' } },
      { type: 'log.synced', seq: 6 },
    ];
    await engine.createSession();
    const events = await engine.eventsAfter('ses_test', 0);
    const toolEvents = events.filter(event => event.type === 'tool');
    expect(toolEvents.map(event => event.status)).toEqual(['called', 'running', 'success']);
    expect(toolEvents[0]).toMatchObject({ name: 'todowrite', callId: 'call_todo' });
    expect(toolEvents[2]).toMatchObject({ name: 'todowrite', status: 'success', durationMs: 120, summary: '0/2 plan steps done' });
    const todo = events.find(event => event.type === 'todo')!;
    expect(todo.todos).toEqual([{ content: 'Scan', status: 'in_progress' }, { content: 'Backtest', status: 'pending' }]);
    expect(todo.seq).toBe(5001);
    expect(events.every((event, index) => index === 0 || event.seq > events[index - 1].seq)).toBe(true);
  });

  it('returns durable messages with stable seq values for the client cursor', async () => {
    await engine.createSession();
    const page = await engine.messages('ses_test');
    expect(page.lastSeq).toBe(5);
    expect(page.messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(page.messages[0]).toMatchObject({ id: 'u1', text: 'Hello', seq: 2000 });
    expect(page.messages[1]).toMatchObject({ id: 'a1', seq: 4000 });
    expect(page.messages[1].text).toMatch(/stop loss/i);
  });
});
