import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app';
import { parseConfig } from '../../server/config';
import { ResearchRepository } from '../../server/storage/repository';

/**
 * LIVE integration: real Express app -> real ffmpeg -> real OpenRouter free omni
 * model. This file is intentionally separate from the offline suite so CI without
 * keys stays green; it skips with a clear note when prerequisites are missing.
 */
const PHRASE = 'Set my stop loss to five percent';
const realFetch = globalThis.fetch;
const keyPresent = typeof process.env.OPENROUTER_API_KEY === 'string' && process.env.OPENROUTER_API_KEY.trim() !== '';
const espeakOk = spawnSync('espeak-ng', ['--version'], { stdio: 'ignore' }).status === 0;
const ffmpegOk = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const live = keyPresent && espeakOk && ffmpegOk;

if (!live) {
  console.warn(`[voice-live] skipped live transcription: ${[
    keyPresent ? undefined : 'OPENROUTER_API_KEY is not set',
    espeakOk ? undefined : 'espeak-ng is not installed',
    ffmpegOk ? undefined : 'ffmpeg is not installed',
  ].filter(Boolean).join('; ')}. Offline voice suites still cover the route.`);
}

let app: Express;
let repository: ResearchRepository;
let workDir: string;
let wavPath: string;
let webmPath: string;

function audioDataUrl(file: string, mime: string): string {
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
}

async function transcribe(file: string, format: 'wav' | 'webm', mime: string) {
  const send = () => request(app).post('/api/v2/voice/transcribe').send({ audio: audioDataUrl(file, mime), format });
  let response = await send();
  // The free tier can answer 429 when several agents probe at once, and the
  // reasoning model can rarely return an empty transcript; one short retry keeps
  // the proof honest without hiding a real provider outage.
  const transient = response.status === 502 && /HTTP 429/.test(String(response.body?.error?.message))
    || response.status === 422 && response.body?.error?.code === 'VOICE_EMPTY';
  if (transient) {
    await new Promise(resolve => setTimeout(resolve, 3_000));
    response = await send();
  }
  return response;
}

describe.skipIf(!live)('live voice transcription (OpenRouter free omni)', () => {
  beforeAll(async () => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'stragy-voice-live-'));
    wavPath = path.join(workDir, 'phrase.wav');
    webmPath = path.join(workDir, 'phrase.webm');
    const spoken = spawnSync('espeak-ng', ['-v', 'en-us', '-s', '145', '-w', wavPath, PHRASE], { encoding: 'utf8' });
    if (spoken.status !== 0) throw new Error(`espeak-ng failed: ${spoken.stderr}`);
    const encoded = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wavPath, '-c:a', 'libopus', '-b:a', '32k', webmPath], { encoding: 'utf8' });
    if (encoded.status !== 0) throw new Error(`ffmpeg webm encode failed: ${encoded.stderr}`);
    const config = parseConfig({ NODE_ENV: 'test', DATA_MODE: 'demo', AI_PROVIDER: 'none', STORAGE_MODE: 'ephemeral' });
    // Keep the live proof off the production database; transcription needs no DB.
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('DATABASE_URL_UNPOOLED', '');
    repository = await ResearchRepository.open({ maxRuns: 3 });
    app = await createApp({ config, repository, enableVite: false });
  }, 60_000);

  beforeEach(() => {
    // setup.ts denies network globally; this suite is the documented exception.
    vi.stubGlobal('fetch', realFetch);
  });

  afterAll(async () => {
    await repository?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('transcribes a real espeak-ng wav through the live route', async () => {
    const response = await transcribe(wavPath, 'wav', 'audio/wav');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.provider.model).toBe('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free');
    expect(response.body.text).toMatch(/stop\s*loss/i);
    expect(response.body.text).toMatch(/\b(five|5)\b/i);
    expect(response.body.latencyMs).toBeGreaterThan(0);
    expect(response.body.latencyMs).toBeLessThan(25_000);
    writeFileSync(path.join(workDir, 'wav-response.json'), JSON.stringify({ text: response.body.text, latencyMs: response.body.latencyMs }, null, 2));
  }, 60_000);

  it('transcribes a real webm clip through the ffmpeg conversion path', async () => {
    const response = await transcribe(webmPath, 'webm', 'audio/webm');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.text).toMatch(/stop\s*loss/i);
    expect(response.body.text).toMatch(/\b(five|5)\b/i);
    writeFileSync(path.join(workDir, 'webm-response.json'), JSON.stringify({ text: response.body.text, latencyMs: response.body.latencyMs }, null, 2));
  }, 60_000);

  it('reports the live status contract', async () => {
    const response = await request(app).get('/api/v2/voice/status');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ configured: true, free: true });
  });
});
