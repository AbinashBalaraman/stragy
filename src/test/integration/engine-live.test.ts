import 'dotenv/config';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app';
import { parseConfig } from '../../server/config';
import { ResearchRepository } from '../../server/storage/repository';
import { closeEngine } from '../../server/ai/engine';

/**
 * Live contract test against a real model. Opt-in so the normal suite stays
 * deterministic and offline:
 *
 *   STRAGY_ENGINE_LIVE=1 npx vitest run --configLoader native src/test/integration/engine-live.test.ts
 *
 * It uses the repository's .env keys (loaded above) and the real OpenCode Go
 * free model, proves one real answer, replays SSE from after=0, then closes and
 * rebuilds the host on the same SQLite file to prove restart durability.
 */
const LIVE = process.env.STRAGY_ENGINE_LIVE === '1';
// Captured before the offline test setup replaces global fetch.
const realFetch = globalThis.fetch;
const repositories: ResearchRepository[] = [];
let folder = '';
let app: Express;
let server: Server | null = null;
let base = '';

async function boot(): Promise<void> {
  const config = parseConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATA_MODE: 'demo',
    STORAGE_MODE: 'ephemeral',
    AI_COST_POLICY: 'free-only',
    STRAGY_ENGINE_DIR: folder,
  });
  const repository = await ResearchRepository.open({ maxRuns: 2 });
  repositories.push(repository);
  app = await createApp({ config, repository, enableVite: false });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', () => resolve()));
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
}

async function pollFor<T>(check: () => Promise<T | null>, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== null) return value;
    if (Date.now() >= deadline) return null;
    await new Promise(resolve => setTimeout(resolve, 4_000));
  }
}

interface WireEvent { seq: number; type: string; message?: { role?: string; text?: string }; error?: string }

async function readSse(url: string, timeoutMs: number): Promise<{ status: number; contentType: string; events: WireEvent[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'text/event-stream' } });
  const events: WireEvent[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary < 0) break;
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try { events.push(JSON.parse(line.slice(6)) as WireEvent); } catch { /* heartbeat */ }
        }
      }
      if (events.some(event => event.type === 'message' && event.message?.role === 'assistant') && events.some(event => event.type === 'idle')) break;
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    clearTimeout(timer);
    try { await reader.cancel(); } catch { /* closed */ }
    controller.abort();
  }
  return { status: response.status, contentType: response.headers.get('content-type') ?? '', events };
}

afterAll(async () => {
  server?.close();
  await closeEngine();
  await Promise.all(repositories.splice(0).map(repository => repository.close().catch(() => undefined)));
  if (folder) await rm(folder, { recursive: true, force: true });
});

describe.runIf(LIVE)('engine live integration', () => {
  it('answers through the real express routes, replays SSE and survives a host restart', async () => {
    // The shared test setup denies network; this opt-in suite needs the real
    // provider. Restore fetch and the provider env for this test only.
    vi.stubGlobal('fetch', realFetch);
    process.env.AI_PROVIDER = 'opencode-go';
    process.env.DATA_MODE = 'demo';
    await mkdir(path.resolve('src/test/.tmp'), { recursive: true });
    folder = await mkdtemp(path.resolve('src/test/.tmp/engine-live-'));
    process.env.STRAGY_ENGINE_DIR = folder;
    await boot();

    // Honest validation before any model call.
    const empty = await request(app).post('/api/v2/engine/sessions').send({ title: 'live' });
    expect(empty.status).toBe(201);
    const sessionId = empty.body.sessionId as string;
    expect(sessionId).toMatch(/^ses_/);

    const noText = await request(app).post('/api/v2/engine/sessions/' + sessionId + '/messages').send({});
    expect(noText.status).toBe(422);
    expect(noText.body.error.code).toBe('ENGINE_EMPTY_MESSAGE');

    const badImage = await request(app).post('/api/v2/engine/sessions/' + sessionId + '/messages').send({ image: 'data:image/png;base64,not-base64' });
    expect(badImage.status).toBe(422);

    const prompt = 'What is a stop loss? One sentence.';
    const asked = await request(app).post('/api/v2/engine/sessions/' + sessionId + '/messages').send({ text: prompt });
    expect(asked.status).toBe(202);

    let activeSession = sessionId;
    let page = await pollFor(async () => {
      const response = await request(app).get('/api/v2/engine/sessions/' + activeSession + '/messages');
      if (response.status !== 200) return null;
      const messages = response.body.messages as { role: string; text?: string }[];
      return messages.some(message => message.role === 'assistant' && String(message.text ?? '').trim()) ? response.body : null;
    }, 90_000);
    if (!page) {
      // Free-tier 429 or a provider failure: retry once on the verified
      // OpenRouter free model, exactly as the proof script does.
      await new Promise(resolve => setTimeout(resolve, 5_000));
      const retry = await request(app).post('/api/v2/engine/sessions').send({ title: 'live fallback', model: { providerID: 'openrouter', model: 'openrouter/free' } });
      expect(retry.status).toBe(201);
      activeSession = retry.body.sessionId;
      const askedRetry = await request(app).post('/api/v2/engine/sessions/' + activeSession + '/messages').send({ text: prompt });
      expect(askedRetry.status).toBe(202);
      page = await pollFor(async () => {
        const response = await request(app).get('/api/v2/engine/sessions/' + activeSession + '/messages');
        if (response.status !== 200) return null;
        const messages = response.body.messages as { role: string; text?: string }[];
        return messages.some(message => message.role === 'assistant' && String(message.text ?? '').trim()) ? response.body : null;
      }, 90_000);
    }
    if (!page) {
      const debug = await request(app).get('/api/v2/engine/sessions/' + activeSession + '/messages');
      console.log('ENGINE_LIVE_DEBUG', JSON.stringify({ status: debug.status, body: debug.body }).slice(0, 3000));
    }
    expect(page).not.toBeNull();
    const assistant = (page!.messages as { role: string; text?: string }[]).find(message => message.role === 'assistant' && String(message.text ?? '').trim());
    expect(assistant?.text).toMatch(/stop[\s-]?loss/i);
    expect(page!.lastSeq).toBeGreaterThan(0);

    const sse = await readSse(base + '/api/v2/engine/sessions/' + activeSession + '/events?after=0', 20_000);
    expect(sse.status).toBe(200);
    expect(sse.contentType).toMatch(/text\/event-stream/);
    const replayedUser = sse.events.find(event => event.type === 'message' && event.message?.role === 'user');
    const replayedAssistant = sse.events.find(event => event.type === 'message' && event.message?.role === 'assistant');
    expect(replayedUser?.message?.text).toBe(prompt);
    expect(replayedAssistant?.message?.text).toMatch(/stop[\s-]?loss/i);
    for (let index = 1; index < sse.events.length; index++) expect(sse.events[index].seq).toBeGreaterThan(sse.events[index - 1].seq);

    // Restart durability: close the host (SQLite stays), rebuild a new app,
    // and read the same session from the new host.
    server?.close();
    server = null;
    await closeEngine();
    await boot();
    const afterRestart = await request(app).get('/api/v2/engine/sessions/' + activeSession + '/messages');
    expect(afterRestart.status).toBe(200);
    const survived = (afterRestart.body.messages as { role: string; text?: string }[]).find(message => message.role === 'assistant' && String(message.text ?? '').trim());
    expect(survived?.text).toBe(assistant?.text);
    const list = await request(app).get('/api/v2/engine/sessions');
    expect(list.body.sessions.some((entry: { sessionId: string }) => entry.sessionId === activeSession)).toBe(true);
  }, 320_000);
});
