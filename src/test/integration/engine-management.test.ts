import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../../server/app';
import { parseConfig, type RuntimeConfig } from '../../server/config';
import { ResearchRepository } from '../../server/storage/repository';
import { closeEngine, setEngineHostFactoryForTests } from '../../server/ai/engine';
import { initializeProviderRegistry, resetProviderRegistryCache } from '../../server/ai/providerRegistry';

/**
 * Offline route contract for the engine management surface. The OpenCode host
 * is faked through the runtime seam; Express, zod validation, middleware,
 * error envelopes and the real engine mapping code are exercised.
 */
const DEFAULT_TITLE = 'New research conversation';
const repositories: ResearchRepository[] = [];
const folders: string[] = [];

interface FakeSession {
  id: string;
  title?: string;
  agent?: string;
  model?: { providerID: string; id: string };
  location: { directory: string };
  time: { created: number; updated: number };
  cost?: number;
  tokens?: { input: number; output: number };
  outcome?: string;
}

interface FakeMessage {
  id: string;
  type: 'user' | 'assistant';
  text?: string;
  time: { created: number };
  model?: { providerID: string; id: string };
  content?: Array<Record<string, unknown>>;
  outcome?: string;
}

function fakeHost(workspace: string) {
  const sessions = new Map<string, FakeSession>();
  const messages: FakeMessage[] = [];
  const listInputs: Record<string, unknown>[] = [];
  const updates: Array<{ sessionID: string; title?: string }> = [];
  const removals: string[] = [];
  const switches: Array<{ sessionID: string; model: { providerID: string; id: string } }> = [];
  const exportInputs: Array<{ sessionID: string; sanitize?: boolean }> = [];
  const counters = { stats: 0, limits: 0, prompt: 0 };
  let created = 0;
  let statsFail = false;
  let limitsFail = false;
  let clock = 1_700_000_000_000;

  const getOrThrow = (sessionID: string): FakeSession => {
    const session = sessions.get(sessionID);
    if (!session) throw new Error('Session not found');
    return session;
  };

  const host = {
    sessions: {
      create: async (input: Record<string, unknown>) => {
        const id = 'ses_' + (++created);
        const model = input.model as { providerID: string; id: string } | undefined;
        const session: FakeSession = {
          id,
          title: typeof input.title === 'string' ? input.title : DEFAULT_TITLE,
          agent: 'stragy',
          ...(model ? { model } : {}),
          location: { directory: workspace },
          time: { created: clock += 1_000, updated: clock += 1_000 },
          cost: 0,
          tokens: { input: 0, output: 0 },
        };
        sessions.set(id, session);
        return session;
      },
      get: async ({ sessionID }: { sessionID: string }) => getOrThrow(sessionID),
      list: async (input: Record<string, unknown> = {}) => {
        listInputs.push(input);
        return { data: [...sessions.values()] };
      },
      update: async ({ sessionID, title }: { sessionID: string; title?: string }) => {
        const session = getOrThrow(sessionID);
        updates.push({ sessionID, ...(title !== undefined ? { title } : {}) });
        if (title !== undefined) session.title = title;
        session.time.updated = clock += 1_000;
      },
      remove: async ({ sessionID }: { sessionID: string }) => {
        if (!sessions.delete(sessionID)) throw new Error('Session not found');
        removals.push(sessionID);
      },
      switchModel: async ({ sessionID, model }: { sessionID: string; model: { providerID: string; id: string } }) => {
        const session = getOrThrow(sessionID);
        switches.push({ sessionID, model });
        session.model = { ...model };
        session.time.updated = clock += 1_000;
      },
      stats: async () => {
        counters.stats += 1;
        if (statsFail) throw new Error('stats unavailable');
        return {
          range: { from: 1_700_000_000_000, to: 1_700_100_000_000 },
          sessions: 2,
          subagents: 0,
          prompts: 4,
          steps: 9,
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 1.25,
          models: [{ model: { providerID: 'opencode-go', id: 'hy4-flash-free' }, steps: 9, tokens: { input: 100, output: 50 }, cost: 1.25 }],
        };
      },
      export: async (input: { sessionID: string; sanitize?: boolean }) => {
        exportInputs.push(input);
        return { info: getOrThrow(input.sessionID), messages: [{ id: 'u1', type: 'user', text: 'Hello' }] };
      },
      prompt: async ({ sessionID, text }: { sessionID: string; text: string }) => {
        counters.prompt += 1;
        getOrThrow(sessionID);
        messages.push({ id: 'u_' + counters.prompt, type: 'user', text, time: { created: clock += 1_000 } });
        return { id: 'msg_' + counters.prompt };
      },
      interrupt: async () => ({ ok: true }),
      log: async function* () { /* no durable items in this fixture */ },
    },
    message: {
      list: async ({ sessionID, limit, type }: { sessionID: string; limit?: number; type?: string }) => {
        getOrThrow(sessionID);
        const filtered = messages.filter(message => !type || message.type === type);
        return { data: filtered.slice(0, limit ?? 200) };
      },
    },
    usage: {
      limits: async () => {
        counters.limits += 1;
        if (limitsFail) throw new Error('limits unavailable');
        return {
          location: { directory: workspace },
          data: { workspace: { id: 'ws_test', name: 'Test', usageURL: 'https://example.test/usage' }, budgets: [] },
        };
      },
    },
    events: { subscribe: async function* () { /* immediately idle */ } },
    close: async () => undefined,
  };

  return {
    host,
    sessions,
    messages,
    listInputs,
    updates,
    removals,
    switches,
    exportInputs,
    counters,
    failStats: () => { statsFail = true; },
    failLimits: () => { limitsFail = true; },
  };
}

async function setup(overrides: Partial<RuntimeConfig> = {}, withJobs = false): Promise<{ app: Express; fake: ReturnType<typeof fakeHost>; folder: string }> {
  resetProviderRegistryCache();
  await initializeProviderRegistry(process.env);
  await mkdir(path.resolve('src/test/.tmp'), { recursive: true });
  const folder = await mkdtemp(path.resolve('src/test/.tmp/engine-management-'));
  folders.push(folder);
  vi.stubEnv('STRAGY_ENGINE_DIR', folder);
  const fake = fakeHost(path.join(folder, 'workspace'));
  fake.sessions.set('ses_1', {
    id: 'ses_1', title: 'First research', agent: 'stragy', model: { providerID: 'opencode-go', id: 'hy4-flash-free' },
    location: { directory: path.join(folder, 'workspace') }, time: { created: 1_700_000_000_000, updated: 1_700_000_100_000 },
    cost: 0.25, tokens: { input: 120, output: 80 }, outcome: 'succeeded',
  });
  fake.sessions.set('ses_2', {
    id: 'ses_2', title: 'Second research', agent: 'stragy', model: { providerID: 'opencode-go', id: 'hy4-flash-free' },
    location: { directory: path.join(folder, 'workspace') }, time: { created: 1_700_000_200_000, updated: 1_700_000_300_000 },
    cost: 0, tokens: { input: 1, output: 1 },
  });
  // Another workspace must never leak into Stragy's history.
  fake.sessions.set('ses_other', {
    id: 'ses_other', title: 'Elsewhere', location: { directory: path.join(folder, 'other-workspace') },
    time: { created: 1_700_000_400_000, updated: 1_700_000_500_000 },
  });
  fake.messages.push(
    { id: 'u1', type: 'user', text: 'Compare RELIANCE and TCS on the daily chart', time: { created: 1_700_000_010_000 } },
    {
      id: 'a1', type: 'assistant', time: { created: 1_700_000_020_000 }, model: { providerID: 'opencode-go', id: 'hy4-flash-free' },
      content: [
        { type: 'text', text: 'RELIANCE closed higher than TCS on the last session.' },
        {
          type: 'tool', id: 't1', name: 'todowrite',
          state: {
            status: 'completed',
            metadata: { todos: [{ content: 'Check RELIANCE', status: 'completed' }, { content: 'Compare TCS', status: 'in_progress' }] },
            content: [{ type: 'text', text: '1/2 plan steps done' }],
          },
          time: { created: 1_700_000_012_000, completed: 1_700_000_013_000 },
        },
        {
          type: 'tool', id: 't2', name: 'get_quote',
          state: { status: 'completed', content: [{ type: 'text', text: JSON.stringify({ quotes: [], errors: [] }) }] },
          time: { created: 1_700_000_014_000, completed: 1_700_000_015_000 },
        },
      ],
    },
  );
  setEngineHostFactoryForTests(async () => fake.host as never);
  const config = { ...parseConfig({
    NODE_ENV: 'test', DATA_MODE: 'demo', AI_PROVIDER: 'opencode-go', STORAGE_MODE: 'ephemeral',
    MAX_BODY_BYTES: '1024', MAX_JOB_MS: '1000',
  }), ...overrides };
  const repository = await ResearchRepository.open({ maxRuns: 3 });
  repositories.push(repository);
  const app = await createApp({ config, repository, ...(withJobs ? { jobs: {
    enqueue: vi.fn(() => ({ id: 'job_chart_1', status: 'queued' })),
    get: vi.fn(() => undefined),
    cancel: vi.fn(() => ({ ok: true })),
  } } : {}), enableVite: false });
  return { app, fake, folder };
}

beforeEach(() => {
  vi.stubEnv('AI_PROVIDER', 'opencode-go');
  vi.stubEnv('AI_MODEL', 'hy4-flash-free');
  vi.stubEnv('AI_COST_POLICY', 'free-only');
  vi.stubEnv('OPENCODE_API_KEY', 'engine-test-key-opencode-0001');
  vi.stubEnv('OPENROUTER_API_KEY', 'engine-test-key-openrouter-0001');
  vi.stubEnv('DEEPSEEK_API_KEY', 'engine-test-key-deepseek-0001');
  vi.stubEnv('AI_APPROVED_PAID_MODELS', 'deepseek:deepseek-v4.1-flash');
  vi.stubEnv('AI_PROVIDERS_FILE', '/nonexistent/ai-providers.json');
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('DATABASE_URL_UNPOOLED', '');
});

afterEach(async () => {
  await closeEngine();
  setEngineHostFactoryForTests(null);
  resetProviderRegistryCache();
  await Promise.all(repositories.splice(0).map(repository => repository.close().catch(() => undefined)));
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('engine session history', () => {
  it('lists only this workspace and passes search/limit to the SDK', async () => {
    const { app, fake } = await setup();
    const all = await request(app).get('/api/v2/engine/sessions');
    expect(all.status).toBe(200);
    expect(all.body.sessions.map((session: { sessionId: string }) => session.sessionId)).toEqual(['ses_1', 'ses_2']);
    expect(all.body.sessions[0]).toMatchObject({ sessionId: 'ses_1', title: 'First research', cost: 0.25, tokens: { input: 120, output: 80 } });
    expect(fake.listInputs.at(-1)).toEqual({ limit: 50, order: 'desc' });

    const search = await request(app).get('/api/v2/engine/sessions').query({ q: ' First ', limit: '2' });
    expect(search.status).toBe(200);
    expect(fake.listInputs.at(-1)).toEqual({ limit: 2, order: 'desc', search: 'First' });

    const tooMany = await request(app).get('/api/v2/engine/sessions').query({ limit: '51' });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('renames, switches model and deletes a session', async () => {
    const { app, fake } = await setup();
    const renamed = await request(app).patch('/api/v2/engine/sessions/ses_1').send({ title: '  RSI study  ' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.session).toMatchObject({ sessionId: 'ses_1', title: 'RSI study' });
    expect(fake.updates.at(-1)).toEqual({ sessionID: 'ses_1', title: 'RSI study' });

    const switched = await request(app).post('/api/v2/engine/sessions/ses_1/model').send({ providerID: 'openrouter', model: 'openrouter/free' });
    expect(switched.status).toBe(200);
    expect(switched.body.session.model).toEqual({ providerID: 'openrouter', id: 'openrouter/free' });
    expect(fake.switches.at(-1)).toEqual({ sessionID: 'ses_1', model: { providerID: 'openrouter', id: 'openrouter/free' } });

    const deleted = await request(app).delete('/api/v2/engine/sessions/ses_2');
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ deleted: true });
    expect(fake.removals).toEqual(['ses_2']);
    const gone = await request(app).get('/api/v2/engine/sessions/ses_2/messages');
    expect(gone.status).toBe(404);
    expect(gone.body.error.code).toBe('ENGINE_SESSION_NOT_FOUND');
  });

  it('rejects unknown sessions and invalid inputs with typed errors', async () => {
    const { app } = await setup();
    for (const response of [
      await request(app).patch('/api/v2/engine/sessions/ses_missing').send({ title: 'x' }),
      await request(app).post('/api/v2/engine/sessions/ses_missing/model').send({ providerID: 'opencode-go', model: 'hy4-flash-free' }),
      await request(app).delete('/api/v2/engine/sessions/ses_missing'),
      await request(app).get('/api/v2/engine/sessions/ses_missing/export'),
    ]) {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('ENGINE_SESSION_NOT_FOUND');
    }
    const emptyTitle = await request(app).patch('/api/v2/engine/sessions/ses_1').send({ title: '   ' });
    expect(emptyTitle.status).toBe(422);
    expect(emptyTitle.body.error.code).toBe('VALIDATION_FAILED');
    const badModel = await request(app).post('/api/v2/engine/sessions/ses_1/model').send({ providerID: 'openai', model: 'gpt-4o' });
    expect(badModel.status).toBe(422);
    expect(badModel.body.error.code).toBe('ENGINE_MODEL_NOT_CONFIGURED');
    const badFormat = await request(app).get('/api/v2/engine/sessions/ses_1/export').query({ format: 'pdf' });
    expect(badFormat.status).toBe(422);
    expect(badFormat.body.error.code).toBe('VALIDATION_FAILED');
    const badTitleType = await request(app).patch('/api/v2/engine/sessions/ses_1').send({ title: 42 });
    expect(badTitleType.status).toBe(422);
  });
});

describe('engine models and usage', () => {
  it('lists the exposed free and approved-paid models with a default', async () => {
    const { app } = await setup();
    const response = await request(app).get('/api/v2/engine/models');
    expect(response.status).toBe(200);
    const models = response.body.models as Array<{ providerID: string; id: string; free: boolean; approvedPaid: boolean; default: boolean; label: string }>;
    expect(models).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerID: 'opencode-go', id: 'hy4-flash-free', free: true, approvedPaid: false, default: true }),
      expect.objectContaining({ providerID: 'deepseek', id: 'deepseek-v4.1-flash', free: false, approvedPaid: true, default: false }),
    ]));
    expect(models.every(model => typeof model.label === 'string' && model.label.length > 0)).toBe(true);
    expect(response.body.default).toEqual({ providerID: 'opencode-go', model: 'hy4-flash-free' });
  });

  it('returns 503 ENGINE_UNAVAILABLE instead of an empty model list when the engine cannot start', async () => {
    vi.stubEnv('AI_PROVIDER', 'none');
    vi.stubEnv('OPENCODE_API_KEY', '');
    vi.stubEnv('OPENROUTER_API_KEY', '');
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    const { app } = await setup();
    const response = await request(app).get('/api/v2/engine/models');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('ENGINE_UNAVAILABLE');
  });

  it('reports stats, limits and per-session cost without inventing zeros', async () => {
    const { app, fake } = await setup();
    const response = await request(app).get('/api/v2/engine/usage');
    expect(response.status).toBe(200);
    expect(response.body.stats).toMatchObject({ sessions: 2, prompts: 4, steps: 9, cost: 1.25, tokens: { input: 100, output: 50 } });
    expect(response.body.limits).toMatchObject({ location: { directory: expect.any(String) }, data: { workspace: { id: 'ws_test' } } });
    expect(response.body.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: 'ses_1', cost: 0.25, tokens: { input: 120, output: 80 } }),
    ]));
    expect(response.body.sessions.some((session: { sessionId: string }) => session.sessionId === 'ses_other')).toBe(false);
    expect(response.body.warnings).toEqual([]);

    fake.failStats();
    fake.failLimits();
    const degraded = await request(app).get('/api/v2/engine/usage');
    expect(degraded.status).toBe(200);
    expect(degraded.body.stats).toBeNull();
    expect(degraded.body.limits).toBeNull();
    expect(degraded.body.warnings.join(' ')).toMatch(/statistics are unavailable/i);
    expect(degraded.body.warnings.join(' ')).toMatch(/limits are unavailable/i);
  });
});

describe('engine export', () => {
  it('builds sanitized JSON through sessions.export', async () => {
    const { app, fake } = await setup();
    const response = await request(app).get('/api/v2/engine/sessions/ses_1/export').query({ format: 'json' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ format: 'json', filename: 'stragy-session.json' });
    expect(JSON.parse(response.body.content)).toMatchObject({ info: { id: 'ses_1' }, messages: [{ id: 'u1', text: 'Hello' }] });
    expect(fake.exportInputs.at(-1)).toEqual({ sessionID: 'ses_1', sanitize: true });
  });

  it('builds markdown with the title, user/assistant text, tool activity and plan', async () => {
    const { app } = await setup();
    const response = await request(app).get('/api/v2/engine/sessions/ses_1/export');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ format: 'md', filename: 'stragy-session.md' });
    const content = response.body.content as string;
    expect(content).toMatch(/^# First research/);
    expect(content).toContain('- Model: `opencode-go/hy4-flash-free`');
    expect(content).toContain('## User');
    expect(content).toContain('Compare RELIANCE and TCS on the daily chart');
    expect(content).toContain('## Assistant');
    expect(content).toContain('RELIANCE closed higher than TCS');
    expect(content).toContain('### Tool activity');
    expect(content).toContain('plan update');
    expect(content).toContain('### Plan');
    expect(content).toContain('- [x] Check RELIANCE');
    expect(content).toContain('- [ ] Compare TCS _(in progress)_');
  });
  it('returns 413 instead of streaming an export larger than 2 MB', async () => {
    const { app, fake } = await setup();
    fake.messages.push({ id: 'u_huge', type: 'user', text: 'x'.repeat(2 * 1024 * 1024 + 100), time: { created: 1_700_000_030_000 } });
    const response = await request(app).get('/api/v2/engine/sessions/ses_1/export');
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('ENGINE_EXPORT_TOO_LARGE');
  });
});

describe('engine auto-title', () => {
  it('renames a default session from the first user text without blocking the 202', async () => {
    const { app, fake } = await setup();
    const created = await request(app).post('/api/v2/engine/sessions').send({ title: DEFAULT_TITLE });
    expect(created.status).toBe(201);
    const sessionId = created.body.sessionId as string;
    const accepted = await request(app).post('/api/v2/engine/sessions/' + sessionId + '/messages').send({
      text: 'How do I read an RSI divergence on NIFTY 50 daily bars?\nSecond line ignored.',
    });
    expect(accepted.status).toBe(202);
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && fake.sessions.get(sessionId)?.title === DEFAULT_TITLE) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const title = fake.sessions.get(sessionId)?.title ?? '';
    expect(title).toBe('How do I read an RSI divergence on NIFTY 50 daily bars? Seco');
    expect(title.length).toBe(60);
    expect(title).not.toContain('\n');
  });

  it('never overwrites a title the operator chose', async () => {
    const { app, fake } = await setup();
    const accepted = await request(app).post('/api/v2/engine/sessions/ses_1/messages').send({ text: 'A much newer question' });
    expect(accepted.status).toBe(202);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(fake.sessions.get('ses_1')?.title).toBe('First research');
  });
});

describe('provider status', () => {
  it('reports engine, market and voice status without secrets or login calls', async () => {
    const { app } = await setup();
    const response = await request(app).get('/api/v2/providers');
    expect(response.status).toBe(200);
    expect(response.body.ai).toMatchObject({ ready: true, hostStarted: false });
    expect(response.body.ai.models).toEqual(expect.arrayContaining([expect.objectContaining({ providerID: 'opencode-go', id: 'hy4-flash-free' })]));
    expect(response.body.engine.modelChain).toEqual(response.body.ai.models);
    expect(response.body.market).toMatchObject({
      configured: false,
      connected: false,
      credentials: { configured: false, missing: expect.any(Array), envSource: 'NONE' },
      session: { connected: false, obtainedAt: null, expiresAt: null },
      rate: { requests: 0, candleRequests: 0, quoteRequests: 0, throttles: 0, retrySleepMs: 0, relogins: 0, loginRequests: 0 },
    });
    expect(response.body.voice).toMatchObject({ configured: true, free: true });
    expect(typeof response.body.voice.model).toBe('string');
    const serialized = JSON.stringify(response.body);
    for (const secret of ['engine-test-key-opencode-0001', 'engine-test-key-openrouter-0001', 'engine-test-key-deepseek-0001']) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe('middleware and removed v1 routes', () => {
  it('keeps auth in front of the management routes', async () => {
    const { app } = await setup({ NODE_ENV: 'production', EXPOSURE_MODE: 'private', API_ACCESS_TOKEN: 'router-test-token' });
    const unauthorized = await request(app).get('/api/v2/engine/models');
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.body.error.code).toBe('UNAUTHORIZED');
    const authorized = await request(app).get('/api/v2/engine/models').set('Authorization', 'Bearer router-test-token');
    expect(authorized.status).toBe(200);
  });

  it('rejects a cross-origin write but allows the same host', async () => {
    const { app } = await setup();
    const rejected = await request(app).patch('/api/v2/engine/sessions/ses_1').set('Origin', 'https://evil.example').send({ title: 'Hijacked' });
    expect(rejected.status).toBe(403);
    expect(rejected.body.error.code).toBe('ORIGIN_REJECTED');
    const allowed = await request(app).patch('/api/v2/engine/sessions/ses_1').set('Host', '127.0.0.1:3909').set('Origin', 'http://127.0.0.1:3909').send({ title: 'Same host' });
    expect(allowed.status).toBe(200);
  });

  it('serves a 404 envelope for the removed first-version chat routes and keeps chart-analysis', async () => {
    const { app } = await setup({ AI_PROVIDER: 'none' }, true);
    for (const route of ['/api/v2/research-chat', '/api/ai/chat']) {
      const response = await request(app).post(route).send({ message: 'hello' });
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ success: false, error: { code: 'ROUTE_NOT_FOUND' } });
    }
    const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');
    const chart = await request(app).post('/api/v2/chart-analysis').send({ image: png });
    expect(chart.status).toBe(202);
    expect(chart.body).toMatchObject({ schemaVersion: 2, jobId: 'job_chart_1' });
    const proposal = await request(app).post('/api/v2/ai/proposals').send({ prompt: 'nr7 narrow range breakout', allowLocalFallback: true });
    expect(proposal.status).toBe(200);
    expect(proposal.body).toMatchObject({ ok: true, proposal: { method: 'local_heuristic' } });
    const parsed = await request(app).post('/api/ai/parse-strategy').send({ prompt: 'nr7 narrow range breakout' });
    expect(parsed.status).toBe(200);
    expect(parsed.body).toMatchObject({ success: true, providerUsed: 'local_heuristic' });
  });
});
