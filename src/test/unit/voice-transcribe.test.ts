import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ffmpeg is exercised for real in the live suite; unit tests replace only spawn so
// conversion arguments, failures and timeouts are deterministic and offline.
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import {
  decodeAudioDataUrl, transcribeAudio, VoiceError, VOICE_MAX_AUDIO_BYTES, VOICE_MODEL,
} from '../../server/voice/transcribe';
import { createVoiceRateLimiter } from '../../server/voice/rateLimit';

const KEY = 'unit-test-key-not-a-real-credential';
const tempRoots: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'stragy-voice-unit-'));
  tempRoots.push(dir);
  return dir;
}

function wavBytes(payload = Buffer.from([1, 2, 3, 4])): Buffer {
  const bytes = Buffer.alloc(44 + payload.length);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + payload.length, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24); bytes.writeUInt32LE(32_000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(payload.length, 40); payload.copy(bytes, 44);
  return bytes;
}

function dataUrl(bytes: Buffer, mime = 'audio/wav'): string {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakeChild(): EventEmitter & { stderr: EventEmitter; kill: ReturnType<typeof vi.fn> } {
  const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: ReturnType<typeof vi.fn> };
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

/** Simulates ffmpeg writing 16 kHz mono wav to the final argument. */
function succeedingFfmpeg(output = wavBytes()) {
  return (_command: string, args: string[]) => {
    const child = fakeChild();
    writeFileSync(args[args.length - 1], output);
    process.nextTick(() => child.emit('close', 0));
    return child;
  };
}

beforeEach(() => {
  spawnMock.mockReset();
  vi.stubEnv('OPENROUTER_API_KEY', KEY);
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('voice request validation', () => {
  it('rejects a missing or unknown format before any provider call', async () => {
    const fetchMock = vi.fn();
    await expect(transcribeAudio({}, { fetchImpl: fetchMock as unknown as typeof fetch })).rejects.toMatchObject({ code: 'VOICE_BAD_FORMAT', status: 422 });
    await expect(transcribeAudio({ audio: 'x', format: 'flac' }, { fetchImpl: fetchMock as unknown as typeof fetch })).rejects.toMatchObject({ code: 'VOICE_BAD_FORMAT', status: 422 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed data URLs and invalid base64', async () => {
    expect(() => decodeAudioDataUrl('set my stop loss to five percent')).toThrow(VoiceError);
    expect(() => decodeAudioDataUrl('data:audio/wav;base64,***')).toThrow(VoiceError);
    await expect(transcribeAudio({ audio: 'https://example.test/clip.wav', format: 'wav' }, { apiKey: KEY })).rejects.toMatchObject({ code: 'VOICE_BAD_FORMAT' });
  });

  it('accepts data URLs with codec parameters', () => {
    const bytes = Buffer.from([1, 2, 3, 4]);
    expect(decodeAudioDataUrl(`data:audio/webm;codecs=opus;base64,${bytes.toString('base64')}`)).toEqual(bytes);
  });

  it('enforces the 4 MB decoded size cap without touching the provider', async () => {
    const fetchMock = vi.fn();
    const oversized = Buffer.alloc(VOICE_MAX_AUDIO_BYTES + 1);
    await expect(transcribeAudio({ audio: dataUrl(oversized), format: 'wav' }, { fetchImpl: fetchMock as unknown as typeof fetch, apiKey: KEY }))
      .rejects.toMatchObject({ code: 'VOICE_TOO_LARGE', status: 413 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports VOICE_NOT_CONFIGURED when no key is present', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const fetchMock = vi.fn();
    await expect(transcribeAudio({ audio: dataUrl(wavBytes()), format: 'wav' }, { fetchImpl: fetchMock as unknown as typeof fetch }))
      .rejects.toMatchObject({ code: 'VOICE_NOT_CONFIGURED', status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('voice provider call', () => {
  it('transcribes a wav byte-for-byte with the live-proven request shape', async () => {
    const wav = wavBytes(Buffer.from('pretend speech bytes'));
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '  "Set my stop loss to 5%."  ' } }] }));
    let clock = 1_000;
    const result = await transcribeAudio(
      { audio: dataUrl(wav), format: 'wav' },
      { fetchImpl: fetchMock as unknown as typeof fetch, apiKey: KEY, now: () => (clock += 420) - 420 },
    );
    expect(result.text).toBe('Set my stop loss to 5%.');
    expect(result.provider).toEqual({ model: VOICE_MODEL });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(spawnMock).not.toHaveBeenCalled();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    const sent = JSON.parse(String(init.body));
    expect(sent.model).toBe(VOICE_MODEL);
    expect(sent.messages[0].content[0]).toEqual({ type: 'text', text: 'Transcribe this audio exactly. Reply with only the transcription, no commentary.' });
    expect(sent.messages[0].content[1]).toEqual({ type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } });
  });

  it('converts webm to 16 kHz mono wav before calling the provider', async () => {
    const converted = wavBytes(Buffer.from('converted speech'));
    spawnMock.mockImplementation(succeedingFfmpeg(converted));
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'converted' } }] }));
    const result = await transcribeAudio(
      { audio: dataUrl(Buffer.from('webm bytes'), 'audio/webm'), format: 'webm' },
      { fetchImpl: fetchMock as unknown as typeof fetch, apiKey: KEY, tempRoot: tempRoot(), ffmpegPath: 'ffmpeg' },
    );
    expect(result.text).toBe('converted');
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin, args] = spawnMock.mock.calls[0] as unknown as [string, string[]];
    expect(bin).toBe('ffmpeg');
    expect(args).toEqual(expect.arrayContaining(['-ar', '16000', '-ac', '1', '-f', 'wav']));
    expect(args[args.length - 1]).toMatch(/output\.wav$/);
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent.messages[0].content[1].input_audio).toEqual({ data: converted.toString('base64'), format: 'wav' });
  });

  it('maps an ffmpeg failure to VOICE_BAD_FORMAT', async () => {
    spawnMock.mockImplementation(() => {
      const child = fakeChild();
      process.nextTick(() => child.emit('close', 1));
      return child;
    });
    const fetchMock = vi.fn();
    await expect(transcribeAudio(
      { audio: dataUrl(Buffer.from('broken webm'), 'audio/webm'), format: 'webm' },
      { fetchImpl: fetchMock as unknown as typeof fetch, apiKey: KEY, tempRoot: tempRoot(), ffmpegTimeoutMs: 2_000 },
    )).rejects.toMatchObject({ code: 'VOICE_BAD_FORMAT', status: 422 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('kills an ffmpeg conversion that exceeds its bounded timeout', async () => {
    let killed: ReturnType<typeof vi.fn> | undefined;
    spawnMock.mockImplementation(() => {
      const child = fakeChild();
      killed = child.kill;
      return child;
    });
    const fetchMock = vi.fn();
    await expect(transcribeAudio(
      { audio: dataUrl(Buffer.from('stuck webm'), 'audio/webm'), format: 'webm' },
      { fetchImpl: fetchMock as unknown as typeof fetch, apiKey: KEY, tempRoot: tempRoot(), ffmpegTimeoutMs: 20 },
    )).rejects.toMatchObject({ code: 'VOICE_TRANSCRIBE_TIMEOUT', status: 504 });
    expect(killed).toHaveBeenCalledWith('SIGKILL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the provider HTTP status without leaking the provider body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: `bad key ${KEY}` } }), { status: 502 }));
    await expect(transcribeAudio({ audio: dataUrl(wavBytes()), format: 'wav' }, { fetchImpl: fetchMock as unknown as typeof fetch, apiKey: KEY }))
      .rejects.toMatchObject({ code: 'VOICE_PROVIDER_FAILED', status: 502, details: { providerStatus: 502 } });
  });

  it('treats an empty transcript as VOICE_EMPTY with a friendly message', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '   ' } }] }));
    const failure = transcribeAudio({ audio: dataUrl(wavBytes()), format: 'wav' }, { fetchImpl: fetchMock as unknown as typeof fetch, apiKey: KEY });
    await expect(failure).rejects.toMatchObject({ code: 'VOICE_EMPTY', status: 422 });
    await expect(failure).rejects.toThrow(/could not hear any speech/i);
  });

  it('maps a reasoning-truncated completion to VOICE_PROVIDER_FAILED, not VOICE_EMPTY', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ finish_reason: 'length', message: { content: '' } }] }));
    await expect(transcribeAudio({ audio: dataUrl(wavBytes()), format: 'wav' }, { fetchImpl: fetchMock as unknown as typeof fetch, apiKey: KEY }))
      .rejects.toMatchObject({ code: 'VOICE_PROVIDER_FAILED', status: 502, details: { finishReason: 'length' } });
  });

  it('times out at the deadline even when the transport ignores the abort signal', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    await expect(transcribeAudio(
      { audio: dataUrl(wavBytes()), format: 'wav' },
      { fetchImpl: fetchMock as unknown as typeof fetch, apiKey: KEY, deadlineMs: 25 },
    )).rejects.toMatchObject({ code: 'VOICE_TRANSCRIBE_TIMEOUT', status: 504 });
  });

  it('maps transport failures and malformed provider JSON to VOICE_PROVIDER_FAILED', async () => {
    const offline = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(transcribeAudio({ audio: dataUrl(wavBytes()), format: 'wav' }, { fetchImpl: offline as unknown as typeof fetch, apiKey: KEY }))
      .rejects.toMatchObject({ code: 'VOICE_PROVIDER_FAILED', status: 502 });
    const malformed = vi.fn(async () => new Response('not json', { status: 200 }));
    await expect(transcribeAudio({ audio: dataUrl(wavBytes()), format: 'wav' }, { fetchImpl: malformed as unknown as typeof fetch, apiKey: KEY }))
      .rejects.toMatchObject({ code: 'VOICE_PROVIDER_FAILED', status: 502 });
  });
});

describe('voice rate limiter', () => {
  it('allows 10 clips per minute per client and isolates clients', () => {
    let now = 10_000;
    const limiter = createVoiceRateLimiter({ limit: 10, windowMs: 60_000, now: () => now });
    for (let i = 0; i < 10; i++) expect(limiter.take('1.2.3.4')).toBe(true);
    expect(limiter.take('1.2.3.4')).toBe(false);
    expect(limiter.take('5.6.7.8')).toBe(true);
    now += 60_000;
    expect(limiter.take('1.2.3.4')).toBe(true);
  });

  it('reset clears the window', () => {
    const limiter = createVoiceRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
    expect(limiter.take('ip')).toBe(true);
    expect(limiter.take('ip')).toBe(false);
    limiter.reset();
    expect(limiter.take('ip')).toBe(true);
  });
});
