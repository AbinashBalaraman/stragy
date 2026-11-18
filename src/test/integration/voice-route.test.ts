import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app';
import { parseConfig } from '../../server/config';
import { ResearchRepository } from '../../server/storage/repository';
import { VOICE_MAX_AUDIO_BYTES, VOICE_MODEL } from '../../server/voice/transcribe';

// Offline integration: the real Express app, middleware, zod validation, error
// contract and rate limiter. Only the OpenRouter HTTP call is replaced.
const KEY = 'integration-test-key-not-a-real-credential';
const repositories: ResearchRepository[] = [];

function wavBytes(payload = Buffer.from([9, 8, 7, 6, 5])): Buffer {
  const bytes = Buffer.alloc(44 + payload.length);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + payload.length, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24); bytes.writeUInt32LE(32_000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(payload.length, 40); payload.copy(bytes, 44);
  return bytes;
}
const dataUrl = (bytes: Buffer, mime = 'audio/wav') => `data:${mime};base64,${bytes.toString('base64')}`;

async function setup(): Promise<Express> {
  vi.stubEnv('OPENROUTER_API_KEY', KEY);
  const config = parseConfig({ NODE_ENV: 'test', DATA_MODE: 'demo', AI_PROVIDER: 'none', STORAGE_MODE: 'ephemeral', MAX_BODY_BYTES: '1024' });
  const repository = await ResearchRepository.open({ maxRuns: 3 });
  repositories.push(repository);
  return createApp({ config, repository, enableVite: false });
}

function providerOk(text: string) {
  return vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
}

beforeEach(() => {
  vi.stubEnv('DATA_MODE', 'demo');
  vi.stubEnv('AI_PROVIDER', 'none');
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('DATABASE_URL_UNPOOLED', '');
});
afterEach(async () => {
  await Promise.all(repositories.splice(0).map(repository => repository.close()));
  vi.unstubAllEnvs();
});

describe('POST /api/v2/voice/transcribe', () => {
  it('returns the transcript, model and latency for a wav clip', async () => {
    const fetchMock = providerOk('Set my stop loss to five percent.');
    vi.stubGlobal('fetch', fetchMock);
    const app = await setup();
    const wav = wavBytes();
    const response = await request(app).post('/api/v2/voice/transcribe').send({ audio: dataUrl(wav), format: 'wav' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ text: 'Set my stop loss to five percent.', provider: { model: VOICE_MODEL } });
    expect(typeof response.body.latencyMs).toBe('number');
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent.messages[0].content[1].input_audio).toEqual({ data: wav.toString('base64'), format: 'wav' });
  });

  it('validates the body honestly', async () => {
    const app = await setup();
    const empty = await request(app).post('/api/v2/voice/transcribe').send({});
    expect(empty.status).toBe(422);
    expect(empty.body.error.code).toBe('VOICE_BAD_FORMAT');
    const wrongFormat = await request(app).post('/api/v2/voice/transcribe').send({ audio: dataUrl(wavBytes()), format: 'flac' });
    expect(wrongFormat.status).toBe(422);
    expect(wrongFormat.body.error.code).toBe('VOICE_BAD_FORMAT');
  });

  it('rejects clips above 4 MB with VOICE_TOO_LARGE', async () => {
    const app = await setup();
    const oversized = Buffer.alloc(VOICE_MAX_AUDIO_BYTES + 1);
    const response = await request(app).post('/api/v2/voice/transcribe').send({ audio: dataUrl(oversized), format: 'wav' });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('VOICE_TOO_LARGE');
  });

  it('reports VOICE_NOT_CONFIGURED without a key', async () => {
    const app = await setup();
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const response = await request(app).post('/api/v2/voice/transcribe').send({ audio: dataUrl(wavBytes()), format: 'wav' });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('VOICE_NOT_CONFIGURED');
  });

  it('surfaces the provider status in a typed failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"busy"}', { status: 429 })));
    const app = await setup();
    const response = await request(app).post('/api/v2/voice/transcribe').send({ audio: dataUrl(wavBytes()), format: 'wav' });
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('VOICE_PROVIDER_FAILED');
    expect(response.body.error.message).toContain('HTTP 429');
  });

  it('limits each client to 10 clips per minute', async () => {
    vi.stubGlobal('fetch', providerOk('ok'));
    const app = await setup();
    const clip = { audio: dataUrl(wavBytes()), format: 'wav' };
    for (let i = 0; i < 10; i++) {
      const response = await request(app).post('/api/v2/voice/transcribe').send(clip);
      expect(response.status).toBe(200);
    }
    const limited = await request(app).post('/api/v2/voice/transcribe').send(clip);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('VOICE_RATE_LIMITED');
  });
});

describe('GET /api/v2/voice/status', () => {
  it('tells the client whether the fallback is configured', async () => {
    const app = await setup();
    const configured = await request(app).get('/api/v2/voice/status');
    expect(configured.status).toBe(200);
    expect(configured.body).toEqual({ configured: true, model: VOICE_MODEL, free: true });
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const missing = await request(app).get('/api/v2/voice/status');
    expect(missing.body).toEqual({ configured: false, model: VOICE_MODEL, free: true });
  });
});
