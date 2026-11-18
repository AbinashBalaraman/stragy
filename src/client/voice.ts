/**
 * Browser voice for the research composer.
 *
 * STT: `SpeechRecognition` / `webkitSpeechRecognition` (interim results into the
 * composer, push-to-talk). When the browser has no recognition API, or the API
 * fails for a reason other than microphone denial, a MediaRecorder capture is
 * posted to Agent D's `/api/v2/voice/transcribe` route.
 *
 * TTS: the browser `speechSynthesis` (free, offline); an en-IN voice is picked
 * when the platform offers one. Transcripts always land in the textarea first:
 * the user sends with the send button or Enter, never automatically.
 *
 * Preferences live in this browser, separate from the workspace preferences so
 * no shared contract changes are needed.
 */

export const VOICE_PREFERENCES_KEY = 'stragy.voice.preferences';

export interface VoicePreferences {
  /** Speak assistant answers aloud. */
  voiceMode: boolean;
}

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = { voiceMode: false };

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function readVoicePreferences(storage: StorageLike | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): VoicePreferences {
  if (!storage) return DEFAULT_VOICE_PREFERENCES;
  try {
    const raw = storage.getItem(VOICE_PREFERENCES_KEY);
    if (!raw) return DEFAULT_VOICE_PREFERENCES;
    const parsed = JSON.parse(raw) as { voiceMode?: unknown };
    return { voiceMode: parsed.voiceMode === true };
  } catch {
    return DEFAULT_VOICE_PREFERENCES;
  }
}

export function writeVoicePreferences(preferences: VoicePreferences, storage: StorageLike | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): boolean {
  if (!storage) return false;
  try {
    storage.setItem(VOICE_PREFERENCES_KEY, JSON.stringify({ voiceMode: preferences.voiceMode === true }));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ speech */

/** Supported when the platform exposes an active speechSynthesis instance. */
export function speechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function';
}

export function cancelSpeech(): void {
  if (!speechSynthesisSupported()) return;
  try { window.speechSynthesis.cancel(); } catch { /* a missing voice engine is not an app error */ }
}

/**
 * Plain speech text: markdown furniture, tables, code fences, URLs and currency
 * glyphs are removed or spoken ("rupees 2,900"), so an answer reads naturally
 * instead of "hash hash table pipe pipe".
 */
export function plainSpeech(text: string): string {
  if (!text) return '';
  let value = text.replace(/\r\n/g, '\n');
  // Fenced code is not useful read aloud.
  value = value.replace(/```[\s\S]*?```/g, ' Code block omitted. ');
  // Images and links keep their human label.
  value = value.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  value = value.replace(/\[([^\]]+)\]\((?:https?:\/\/|\/)[^)]*\)/g, '$1');
  // Tables: keep cell text, drop separator rows.
  value = value.split('\n')
    .filter(line => !/^\s*\|?[\s:|-]+\|[\s:|-]+$/.test(line))
    .map(line => line.replace(/\s*\|\s*/g, ', '))
    .join('\n');
  value = value.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  value = value.replace(/^\s{0,3}>\s?/gm, '');
  value = value.replace(/^\s*[-*+]\s+/gm, '');
  value = value.replace(/^\s*\d+[.)]\s+/gm, '');
  value = value.replace(/`([^`]+)`/g, '$1');
  value = value.replace(/(\*\*|__)(.*?)\1/g, '$2');
  value = value.replace(/(\*|_)([^*_\n]+)\1/g, '$2');
  value = value.replace(/~~([^~]+)~~/g, '$1');
  // A ticker/thousands separator in prose is still a comma read as a pause.
  value = value.replace(/₹\s?/g, 'rupees ');
  value = value.replace(/\bRs\.?\s?(?=\d)/gi, 'rupees ');
  value = value.replace(/&nbsp;/g, ' ');
  value = value.replace(/[•·]/g, ', ');
  value = value.replace(/[→←↔]/g, ' to ');
  value = value.replace(/[—–]/g, ', ');
  value = value.replace(/[ \t]+/g, ' ');
  value = value.replace(/\n{2,}/g, '. ');
  value = value.replace(/\n/g, ', ');
  value = value.replace(/\s+([.,!?;:])/g, '$1');
  value = value.replace(/([,.]\s*){3,}/g, '. ');
  return value.trim();
}

/** The best available Indian-English voice, else any English voice. */
export function pickSpeechVoice(voices: readonly SpeechSynthesisVoice[] | undefined): SpeechSynthesisVoice | null {
  if (!voices || !voices.length) return null;
  const en = voices.filter(voice => /^en([-_]|$)/i.test(voice.lang));
  return en.find(voice => /^en[-_]IN$/i.test(voice.lang))
    ?? en.find(voice => /^en[-_]IN/i.test(voice.lang))
    ?? en.find(voice => /^en[-_](GB|US)$/i.test(voice.lang))
    ?? en[0]
    ?? null;
}

export interface SpeakOptions {
  onEnd?: () => void;
  rate?: number;
  voices?: readonly SpeechSynthesisVoice[];
}

/** Speak one assistant answer. Returns false when speech is unsupported. */
export function speak(text: string, options: SpeakOptions = {}): boolean {
  if (!speechSynthesisSupported()) return false;
  const spoken = plainSpeech(text);
  if (!spoken) return false;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new window.SpeechSynthesisUtterance(spoken);
    const voice = pickSpeechVoice(options.voices ?? synth.getVoices());
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang; } else { utterance.lang = 'en-IN'; }
    utterance.rate = options.rate ?? 1;
    utterance.pitch = 1;
    if (options.onEnd) utterance.onend = () => options.onEnd?.();
    synth.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------------- STT */

export class VoiceError extends Error {
  constructor(message: string, public code = 'VOICE_FAILED') {
    super(message);
  }
}

/** Minimal shape of the Web Speech recognition API (not in lib.dom). */
interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string }; length: number }>;
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor });
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

export function speechRecognitionSupported(): boolean {
  return recognitionCtor() !== null;
}

export function mediaRecorderSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof window.MediaRecorder === 'function'
    && typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia;
}

export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'error';

export interface VoiceInputCallbacks {
  /** Cumulative transcript for the current listening turn; final marks the end. */
  onTranscript(text: string, final: boolean): void;
  onState?(state: VoiceState): void;
  /** One plain, honest sentence. Text input always still works. */
  onError?(message: string): void;
}

export interface VoiceInputController {
  /** Begin push-to-talk. Returns false when no capture path is available. */
  start(): Promise<boolean>;
  stop(): void;
  toggle(): Promise<void>;
  dispose(): void;
  listening(): boolean;
  transport(): 'browser' | 'recorder' | 'none';
}

const PERMISSION_DENIED = 'Microphone access was denied. Type your message instead — text always works.';
const RECORDER_UNAVAILABLE = 'Voice recording is not available in this browser. Type your message instead.';
const TRANSCRIBE_UNAVAILABLE = 'Voice transcription is not available on this server yet. Type your message instead.';

function isPermissionError(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? '';
  return /NotAllowedError|PermissionDeniedError|SecurityError/i.test(name);
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') { reject(new VoiceError('The recording could not be read.')); return; }
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new VoiceError('The recording could not be read.'));
    reader.onerror = () => reject(new VoiceError('The recording could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/** Agent D's server-side fallback: audio data URL in, text out. */
export async function transcribeAudio(dataUrl: string, format: string, signal?: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch('/api/v2/voice/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: dataUrl, format }),
      signal,
    });
  } catch {
    throw new VoiceError('The voice service could not be reached. Type your message instead.', 'VOICE_UNREACHABLE');
  }
  let raw: unknown = null;
  try { raw = await response.json(); } catch { raw = null; }
  if (response.status === 404) throw new VoiceError(TRANSCRIBE_UNAVAILABLE, 'VOICE_NOT_DEPLOYED');
  if (!response.ok) {
    const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const error = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : undefined;
    throw new VoiceError(typeof error?.message === 'string' ? error.message : 'The recording could not be transcribed. Type your message instead.', 'VOICE_FAILED');
  }
  const text = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).text : undefined;
  if (typeof text !== 'string' || !text.trim()) throw new VoiceError('The recording did not contain recognizable speech. Nothing was sent.', 'VOICE_EMPTY');
  return text.trim().slice(0, 4000);
}

/**
 * One push-to-talk controller. The browser recognizer is preferred; when it is
 * missing or genuinely fails, MediaRecorder captures one clip and the server
 * transcribes it. A denied microphone is never silently retried.
 */
export function createVoiceInput(callbacks: VoiceInputCallbacks): VoiceInputController {
  let active = false;
  let disposed = false;
  let recognition: RecognitionLike | null = null;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let sessionFinal = '';
  let cycle: number = 0;

  const state = (next: VoiceState) => { if (!disposed) callbacks.onState?.(next); };
  const fail = (message: string) => { state('error'); callbacks.onError?.(message); };
  const releaseStream = () => {
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    recorder = null;
    chunks = [];
  };

  const finishBrowser = (emitFinal: boolean) => {
    if (emitFinal && sessionFinal.trim()) callbacks.onTranscript(sessionFinal.trim(), true);
    recognition = null;
    active = false;
    if (!disposed) state('idle');
  };

  const startBrowser = (): boolean => {
    const Ctor = recognitionCtor();
    if (!Ctor) return false;
    let instance: RecognitionLike;
    try { instance = new Ctor(); } catch { return false; }
    recognition = instance;
    sessionFinal = '';
    instance.lang = 'en-IN';
    instance.continuous = true;
    instance.interimResults = true;
    instance.maxAlternatives = 1;
    instance.onresult = event => {
      let interim = '';
      let finalChunk = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? '';
        if (result?.isFinal) finalChunk += transcript; else interim += transcript;
      }
      if (finalChunk) sessionFinal += (sessionFinal ? ' ' : '') + finalChunk.trim();
      const display = [sessionFinal, interim.trim()].filter(Boolean).join(' ');
      if (display) callbacks.onTranscript(display, false);
    };
    instance.onerror = event => {
      const code = event?.error ?? '';
      recognition = null;
      active = false;
      if (/not-allowed|service-not-allowed/.test(code)) {
        releaseStream();
        fail(PERMISSION_DENIED);
        return;
      }
      // A real recognizer failure: try the recorder fallback before giving up.
      void startRecorder(sessionFinal);
    };
    instance.onend = () => { if (recognition === instance) finishBrowser(true); };
    try {
      instance.start();
    } catch {
      recognition = null;
      return false;
    }
    active = true;
    state('listening');
    return true;
  };

  const startRecorder = async (prefix = ''): Promise<boolean> => {
    if (!mediaRecorderSupported()) { fail(RECORDER_UNAVAILABLE); return false; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      fail(isPermissionError(error) ? PERMISSION_DENIED : 'The microphone could not be opened. Type your message instead.');
      return false;
    }
    if (disposed) { releaseStream(); return false; }
    chunks = [];
    const mime = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.('audio/webm') ? 'audio/webm'
      : typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.('audio/mp4') ? 'audio/mp4'
        : '';
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      releaseStream();
      fail(RECORDER_UNAVAILABLE);
      return false;
    }
    const ownedCycle = ++cycle;
    recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      if (disposed || ownedCycle !== cycle) { releaseStream(); return; }
      const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
      releaseStream();
      active = false;
      if (!blob.size) { finishRecorder(prefix, ''); return; }
      state('transcribing');
      void (async () => {
        try {
          const dataUrl = await readBlob(blob);
          const format = /mp4|m4a/i.test(blob.type) ? 'mp4' : /wav/i.test(blob.type) ? 'wav' : 'webm';
          const text = await transcribeAudio(dataUrl, format);
          finishRecorder(prefix, text);
        } catch (error) {
          if (disposed || ownedCycle !== cycle) return;
          fail(error instanceof VoiceError ? error.message : TRANSCRIBE_UNAVAILABLE);
        }
      })();
    };
    recorder.start();
    active = true;
    state('listening');
    return true;
  };

  const finishRecorder = (prefix: string, text: string) => {
    const merged = [prefix, text].filter(Boolean).join(' ').trim();
    if (merged) callbacks.onTranscript(merged, true);
    if (!disposed) state('idle');
  };

  const stopBrowser = () => {
    const current = recognition;
    if (!current) return;
    try { current.stop(); } catch { /* already stopped */ }
    // Some browsers never fire onend after stop(); do not stay stuck.
    window.setTimeout(() => { if (recognition === current) finishBrowser(true); }, 400);
  };

  const controller: VoiceInputController = {
    async start() {
      if (disposed || active) return active;
      if (recognitionCtor()) return startBrowser();
      if (mediaRecorderSupported()) return startRecorder();
      fail('Voice input is not available in this browser. Type your message instead.');
      return false;
    },
    stop() {
      if (!active) return;
      if (recognition) { stopBrowser(); return; }
      if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch { releaseStream(); } }
    },
    async toggle() {
      if (active) { controller.stop(); return; }
      await controller.start();
    },
    dispose() {
      disposed = true;
      recognition?.abort?.();
      recognition = null;
      try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch { /* ignore */ }
      releaseStream();
      cycle += 1;
      state('idle');
    },
    listening: () => active,
    transport: () => recognitionCtor() ? 'browser' : mediaRecorderSupported() ? 'recorder' : 'none',
  };
  return controller;
}
