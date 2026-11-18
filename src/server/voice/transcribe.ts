/**
 * Server-side speech-to-text (fallback for browsers without SpeechRecognition).
 *
 * The client posts a data URL of a short voice clip; we hand it to OpenRouter's
 * free omni model, which accepts wav bytes through `input_audio` content parts.
 * PM live-proved this exact model/call: HTTP 200, ~1.4 s, correct transcription,
 * $0 (free tier). Browser TTS/STT stays client-side; this module is transcribe-only.
 *
 * Rules:
 * - Never log or echo audio bytes, the API key, or the provider request body.
 * - Every failure is a typed VoiceError with an honest, user-readable message.
 * - Non-wav formats are converted to 16 kHz mono wav with ffmpeg, bounded to 10 s.
 * - The provider call has a 25 s deadline.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const VOICE_MODEL = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';
export const VOICE_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
/** Decoded audio cap. Base64 inflates by ~4/3, so route JSON is allowed 10 MB. */
export const VOICE_MAX_AUDIO_BYTES = 4 * 1024 * 1024;
export const VOICE_DEADLINE_MS = 25_000;
export const VOICE_FFMPEG_TIMEOUT_MS = 10_000;
export const VOICE_PROMPT = 'Transcribe this audio exactly. Reply with only the transcription, no commentary.';
export const VOICE_FORMATS = ['wav', 'webm', 'mp3', 'ogg'] as const;
export type VoiceFormat = typeof VOICE_FORMATS[number];

export type VoiceErrorCode =
  | 'VOICE_TOO_LARGE'
  | 'VOICE_BAD_FORMAT'
  | 'VOICE_TRANSCRIBE_TIMEOUT'
  | 'VOICE_PROVIDER_FAILED'
  | 'VOICE_NOT_CONFIGURED'
  | 'VOICE_EMPTY';

const VOICE_MESSAGES: Record<VoiceErrorCode, string> = {
  VOICE_TOO_LARGE: 'That voice clip is too large. Keep it under 4 MB (about a minute of speech).',
  VOICE_BAD_FORMAT: 'That voice clip could not be read. Send a wav, webm, mp3 or ogg recording.',
  VOICE_TRANSCRIBE_TIMEOUT: 'Transcription took too long. Try a shorter clip, or use your browser\'s speech recognition.',
  VOICE_PROVIDER_FAILED: 'The transcription service did not answer correctly. Try again in a moment.',
  VOICE_NOT_CONFIGURED: 'Server transcription is not configured on this deployment. Use your browser\'s speech recognition instead.',
  VOICE_EMPTY: 'I could not hear any speech in that clip. Try recording again, a little closer to the microphone.',
};

export class VoiceError extends Error {
  constructor(
    public code: VoiceErrorCode,
    public status: number,
    message: string = VOICE_MESSAGES[code],
    public details?: unknown,
  ) { super(message); this.name = 'VoiceError'; }
}

export const VoiceRequestSchema = z.object({
  // The route's own JSON parser bounds the body at 10 MB; the decoded 4 MB cap is
  // enforced below so oversized clips get VOICE_TOO_LARGE, not a format error.
  audio: z.string().min(1),
  format: z.enum(VOICE_FORMATS),
}).strict();
export type VoiceRequest = z.infer<typeof VoiceRequestSchema>;

export interface VoiceTranscription {
  text: string;
  provider: { model: string };
  latencyMs: number;
}

export interface VoiceDeps {
  /** Provider transport seam (unit tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** ffmpeg binary; defaults to ffmpeg on PATH. */
  ffmpegPath?: string;
  ffmpegTimeoutMs?: number;
  /** Provider deadline; defaults to VOICE_DEADLINE_MS. */
  deadlineMs?: number;
  /** Key override; defaults to OPENROUTER_API_KEY. */
  apiKey?: string;
  /** Temp root; defaults to VOICE_TMP_DIR or /data/tmp/opencode/voice. */
  tempRoot?: string;
  now?: () => number;
}

export function isVoiceConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return typeof env.OPENROUTER_API_KEY === 'string' && env.OPENROUTER_API_KEY.trim().length > 0;
}

const DATA_URL = /^data:audio\/[a-z0-9.+-]+(?:;[^,;]*)*;base64,([A-Za-z0-9+/=\s]+)$/i;

/** Decode a `data:audio/...;base64,` URL. Throws VOICE_BAD_FORMAT on malformed input. */
export function decodeAudioDataUrl(audio: string): Buffer {
  const match = DATA_URL.exec(audio.trim());
  if (!match) throw new VoiceError('VOICE_BAD_FORMAT', 422);
  const base64 = match[1].replace(/\s+/g, '');
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new VoiceError('VOICE_BAD_FORMAT', 422);
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) throw new VoiceError('VOICE_BAD_FORMAT', 422);
  return buffer;
}

function conversionFailure(): VoiceError {
  return new VoiceError('VOICE_BAD_FORMAT', 422);
}

async function conversionRoot(deps: VoiceDeps): Promise<string> {
  const preferred = deps.tempRoot ?? process.env.VOICE_TMP_DIR ?? path.join('/data/tmp/opencode', 'voice');
  try {
    await fs.mkdir(preferred, { recursive: true, mode: 0o700 });
    return preferred;
  } catch {
    // Non-instabox deployments may not have /data/tmp; fall back to the OS temp dir.
    const fallback = path.join(os.tmpdir(), 'stragy-voice');
    await fs.mkdir(fallback, { recursive: true, mode: 0o700 });
    return fallback;
  }
}

function runFfmpeg(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'ignore'] });
    const finish = (error?: VoiceError) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      finish(new VoiceError('VOICE_TRANSCRIBE_TIMEOUT', 504));
    }, timeoutMs);
    child.once('error', () => finish(conversionFailure()));
    child.once('close', code => finish(code === 0 ? undefined : conversionFailure()));
  });
}

/** Convert any accepted container to 16 kHz mono wav, then remove the temp files. */
export async function convertToWav(audio: Buffer, format: VoiceFormat, deps: VoiceDeps = {}): Promise<Buffer> {
  if (format === 'wav') return audio;
  const root = await conversionRoot(deps);
  const workDir = path.join(root, `clip-${randomUUID()}`);
  const inputPath = path.join(workDir, `input.${format}`);
  const outputPath = path.join(workDir, 'output.wav');
  try {
    await fs.mkdir(workDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(inputPath, audio, { mode: 0o600 });
    await runFfmpeg(
      deps.ffmpegPath ?? 'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath, '-vn', '-ar', '16000', '-ac', '1', '-f', 'wav', outputPath],
      deps.ffmpegTimeoutMs ?? VOICE_FFMPEG_TIMEOUT_MS,
    );
    return await fs.readFile(outputPath);
  } catch (error) {
    if (error instanceof VoiceError) throw error;
    throw conversionFailure();
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '')).join('');
  }
  return '';
}

/** Models sometimes wrap the transcript in quotes; remove one matching pair only. */
function cleanTranscript(raw: string): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  if (text.length > 1 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1).trim();
  return text;
}

/**
 * Transcribe a validated voice request. Throws VoiceError for every expected
 * failure; unexpected errors are surfaced as VOICE_PROVIDER_FAILED so a route
 * never leaks provider diagnostics.
 */
export async function transcribeAudio(input: unknown, deps: VoiceDeps = {}): Promise<VoiceTranscription> {
  const parsed = VoiceRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new VoiceError('VOICE_BAD_FORMAT', 422, 'Expected { audio: dataURL, format: "wav" | "webm" | "mp3" | "ogg" }.', parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })));
  }
  const request = parsed.data;
  const decoded = decodeAudioDataUrl(request.audio);
  if (decoded.length > VOICE_MAX_AUDIO_BYTES) {
    throw new VoiceError('VOICE_TOO_LARGE', 413, undefined, { maxBytes: VOICE_MAX_AUDIO_BYTES, bytes: decoded.length });
  }
  const apiKey = (deps.apiKey ?? process.env.OPENROUTER_API_KEY ?? '').trim();
  if (!apiKey) throw new VoiceError('VOICE_NOT_CONFIGURED', 503);

  const isWav = request.format === 'wav';
  const wav = isWav ? decoded : await convertToWav(decoded, request.format, deps);
  if (wav.length > VOICE_MAX_AUDIO_BYTES) throw new VoiceError('VOICE_TOO_LARGE', 413, undefined, { maxBytes: VOICE_MAX_AUDIO_BYTES, bytes: wav.length });

  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const controller = new AbortController();
  const body = JSON.stringify({
    model: VOICE_MODEL,
    // The omni model is a reasoning model: 100 tokens can be consumed entirely by
    // hidden reasoning, leaving an empty transcript. 400 keeps that from truncating.
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: VOICE_PROMPT },
        { type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } },
      ],
    }],
  });

  const startedAt = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new VoiceError('VOICE_TRANSCRIBE_TIMEOUT', 504));
    }, deps.deadlineMs ?? VOICE_DEADLINE_MS);
  });
  try {
    const call = fetchImpl(VOICE_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'x-title': 'Stragy' },
      body,
      signal: controller.signal,
    });
    // If the deadline wins, the losing fetch rejection must not go unhandled.
    call.catch(() => undefined);
    let response: Response;
    try {
      response = await Promise.race([call, timeout]);
    } catch (error) {
      if (error instanceof VoiceError) throw error;
      if (controller.signal.aborted) throw new VoiceError('VOICE_TRANSCRIBE_TIMEOUT', 504);
      throw new VoiceError('VOICE_PROVIDER_FAILED', 502);
    }
    if (!response.ok) {
      throw new VoiceError('VOICE_PROVIDER_FAILED', 502, `The transcription service returned HTTP ${response.status}. Try again in a moment.`, { providerStatus: response.status });
    }
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw controller.signal.aborted ? new VoiceError('VOICE_TRANSCRIBE_TIMEOUT', 504) : new VoiceError('VOICE_PROVIDER_FAILED', 502); }
    const choice = (payload as { choices?: { message?: { content?: unknown }; finish_reason?: string }[] })?.choices?.[0];
    const text = cleanTranscript(messageText(choice?.message?.content));
    if (!text) {
      // A reasoning model that burns the whole completion budget returns no
      // transcript; that is a provider failure, not "the clip was silent".
      if (choice?.finish_reason === 'length') throw new VoiceError('VOICE_PROVIDER_FAILED', 502, 'The transcription service ran out of room for that clip. Try a shorter recording.', { finishReason: 'length' });
      throw new VoiceError('VOICE_EMPTY', 422);
    }
    return { text, provider: { model: VOICE_MODEL }, latencyMs: Math.max(0, Math.round(now() - startedAt)) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
