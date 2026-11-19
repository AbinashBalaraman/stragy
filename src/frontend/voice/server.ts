import type { Lang } from '../i18n';
import type { StartOptions, VoiceEngine, VoiceModel, VoiceState } from './types';

export type TtsCapability = {
  available: boolean;
  engine: string;
  languages: string[];
  maxText: number;
  note: string;
};

let capabilityCache: Promise<TtsCapability> | null = null;
/** GET /tts is a cheap capability probe; cache it for the session. */
export function ttsCapability(): Promise<TtsCapability> {
  if (!capabilityCache) {
    capabilityCache = fetch('/tts').then((r) => (r.ok ? r.json() as Promise<TtsCapability> : Promise.reject(new Error(`tts ${r.status}`))))
      .catch(() => ({ available: false, engine: 'none', languages: [], maxText: 0, note: 'Local TTS service unreachable.' }));
  }
  return capabilityCache;
}

export function resetTtsCapability(): void {
  capabilityCache = null;
}

let sttCache: Promise<{ configured: boolean; model: string }> | null = null;
export function serverSttStatus(): Promise<{ configured: boolean; model: string }> {
  if (!sttCache) {
    sttCache = fetch('/api/v2/voice/status')
      .then((r) => (r.ok ? r.json() as Promise<{ configured: boolean; model: string }> : { configured: false, model: '' }))
      .catch(() => ({ configured: false, model: '' }));
  }
  return sttCache;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read recorded audio.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Server fallback. TTS: an authenticated `/tts` route runs espeak-ng locally
 * (robotic, but always available on the host) and returns a WAV we play when
 * the device has no system voice. STT is best-effort via the existing
 * MediaRecorder -> /api/v2/voice/transcribe path, only when configured.
 */
export class ServerVoice implements VoiceEngine {
  readonly kind = 'server' as const;
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private onStateCb: ((s: VoiceState) => void) | null = null;

  async available(_lang: Lang): Promise<boolean> {
    return (await ttsCapability()).available;
  }

  async listModels(): Promise<VoiceModel[]> {
    const cap = await ttsCapability();
    return [{ model: cap.engine, provider: 'local', transports: ['tts'], available: cap.available }];
  }

  async sttAvailable(): Promise<boolean> {
    return typeof MediaRecorder !== 'undefined' && !!(navigator.mediaDevices?.getUserMedia) && (await serverSttStatus()).configured;
  }

  async detail(lang: Lang): Promise<string> {
    const cap = await ttsCapability();
    const stt = await this.sttAvailable();
    if (!cap.available) return 'Local espeak-ng TTS service is not available.';
    return `Local espeak-ng ${lang === 'ta' ? 'Tamil' : 'English'} TTS (robotic). Server STT ${stt ? 'configured' : 'not configured'}.`;
  }

  async start(opts: StartOptions): Promise<void> {
    this.onStateCb = opts.onState;
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      opts.onState('unavailable');
      throw new Error('MediaRecorder / microphone capture is not available in this browser.');
    }
    if (!(await serverSttStatus()).configured) {
      opts.onState('unavailable');
      throw new Error('Server transcription is not configured. Use the browser microphone or type instead.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.stream = stream;
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/wav'].find((m) => MediaRecorder.isTypeSupported(m));
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    this.recorder = recorder;
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      this.releaseStream();
      opts.onState('transcribing');
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        // Keep the base64 well under the Stragy 10 MB route cap.
        if (blob.size > 6 * 1024 * 1024) throw new Error('Recording too long (max ~10 s).');
        const format = /wav/i.test(recorder.mimeType) ? 'wav' : /ogg/i.test(recorder.mimeType) ? 'ogg' : 'webm';
        const res = await fetch('/api/v2/voice/transcribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ audio: await blobToDataUrl(blob), format }),
        });
        if (!res.ok) throw new Error(`Transcription failed (${res.status}).`);
        const data = await res.json() as { text?: string };
        if (data.text) {
          // The chat turn owns the state from here (thinking/speaking).
          opts.onTranscript(data.text, true);
        } else {
          this.lastDetail = 'No speech was transcribed. Tap the mic and try again.';
          opts.onState('unavailable');
        }
      } catch (err) {
        this.lastDetail = err instanceof Error ? err.message : String(err);
        opts.onState('unavailable');
      }
    };
    recorder.start();
    opts.onState('listening');
  }

  private lastDetail = '';
  detailText(): string { return this.lastDetail; }

  stop(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    } else {
      this.releaseStream();
    }
  }

  private releaseStream(): void {
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    this.stream = null;
    this.recorder = null;
  }

  /** Play a WAV from the local /tts route. Returns false if it has no voice. */
  async speak(text: string, lang: Lang, onEnd?: () => void): Promise<boolean> {
    const cap = await ttsCapability();
    if (!cap.available) return false;
    const spoken = text.trim().slice(0, cap.maxText || 1200);
    if (!spoken) return false;
    try {
      const res = await fetch('/tts', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: spoken, lang: lang === 'ta' ? 'ta' : 'en' }),
      });
      if (!res.ok) return false;
      const blob = await res.blob();
      this.stopSpeaking();
      this.objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(this.objectUrl);
      this.audio = audio;
      const done = () => {
        if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
        this.audio = null;
        onEnd?.();
      };
      audio.onended = done;
      audio.onerror = done;
      await audio.play();
      return true;
    } catch {
      return false;
    }
  }

  stopSpeaking(): void {
    try { this.audio?.pause(); } catch { /* ignore */ }
    this.audio = null;
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
  }

  dispose(): void {
    try { if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop(); } catch { /* ignore */ }
    this.releaseStream();
    this.stopSpeaking();
    this.onStateCb = null;
  }
}
