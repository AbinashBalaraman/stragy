import type { Lang } from '../i18n';
import type { StartOptions, VoiceEngine, VoiceModel, VoiceState } from './types';
import { pickSpeechVoice, plainSpeech, recognitionLang, systemVoices } from './speech';

/** Minimal Web Speech recognition shape (not in lib.dom). */
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
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechRecognitionSupported(): boolean {
  return recognitionCtor() !== null;
}

export function speechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function';
}

/**
 * Tier 2 — the primary free path on Android Chrome. `SpeechRecognition` with a
 * Tamil/English locale feeds interim + final transcripts into the composer;
 * `speechSynthesis` reads the assistant answer aloud when the device has a
 * matching voice. No server round trip for audio.
 */
export class BrowserVoice implements VoiceEngine {
  readonly kind = 'browser' as const;
  private recognition: RecognitionLike | null = null;
  private listening = false;
  private onStateCb: ((s: VoiceState) => void) | null = null;
  private lastDetail = '';
  private voices: SpeechSynthesisVoice[] = [];
  private speakToken = 0;

  sttAvailable(): boolean {
    return speechRecognitionSupported();
  }

  ttsVoices(lang: Lang): SpeechSynthesisVoice[] {
    const voices = systemVoices();
    this.voices = voices;
    return voices.filter((v) => (lang === 'ta' ? /^ta([-_]|$)/i.test(v.lang) : /^en([-_]|$)/i.test(v.lang)));
  }

  hasTtsVoice(lang: Lang): boolean {
    return this.ttsVoices(lang).length > 0;
  }

  detail(lang: Lang): string {
    if (this.lastDetail) return this.lastDetail;
    if (!this.sttAvailable()) return 'Web Speech recognition is not available in this browser.';
    if (!this.hasTtsVoice(lang)) {
      return `Speech recognition is present, but this device has no ${lang === 'ta' ? 'Tamil' : 'English'} system voice; TTS will fall back to the local espeak service.`;
    }
    return `On-device recognition (${recognitionLang(lang)}) and ${this.ttsVoices(lang).length} matching voice(s).`;
  }

  async available(lang: Lang): Promise<boolean> {
    return this.sttAvailable() && this.hasTtsVoice(lang);
  }

  async listModels(lang: Lang): Promise<VoiceModel[]> {
    return this.ttsVoices(lang).map((v) => ({
      model: v.name, provider: 'device', transports: ['tts'], available: true,
    }));
  }

  async start(opts: StartOptions): Promise<void> {
    const Ctor = recognitionCtor();
    this.onStateCb = opts.onState;
    this.lastDetail = '';
    if (!Ctor) {
      opts.onState('unavailable');
      throw new Error('Speech recognition is not available in this browser.');
    }
    if (this.listening) return;
    const rec = new Ctor();
    this.recognition = rec;
    rec.lang = recognitionLang(opts.lang);
    // One utterance per turn: the browser ends recognition on a natural pause,
    // which makes speech feel like a conversation instead of an open mic the
    // user must tap again. Interim text still streams while speaking.
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let deliveredFinal = false;
    let errored = false;
    let watchdog: number | undefined;
    const clearWatchdog = () => { if (watchdog !== undefined) { window.clearTimeout(watchdog); watchdog = undefined; } };
    const armWatchdog = () => {
      clearWatchdog();
      watchdog = window.setTimeout(() => {
        if (deliveredFinal) return;
        errored = true;
        this.lastDetail = 'No speech was detected. Tap the mic and try again.';
        try { rec.abort(); } catch { /* already closed */ }
        this.listening = false;
        opts.onState('unavailable');
      }, 15_000);
    };
    rec.onresult = (event) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result?.[0]?.transcript || '';
        if (result?.isFinal) final += text;
        else interim += text;
      }
      if (interim) { armWatchdog(); opts.onTranscript(interim, false); }
      if (final.trim() && !deliveredFinal) {
        deliveredFinal = true;
        clearWatchdog();
        opts.onTranscript(final.trim(), true);
      }
    };
    rec.onerror = (event) => {
      clearWatchdog();
      const code = String(event?.error || '');
      if (code === 'aborted') return;
      if (code === 'no-speech') {
        // Honest, actionable feedback instead of silently dropping to idle.
        errored = true;
        this.lastDetail = 'No speech was detected. Tap the mic and try again.';
        opts.onState('unavailable');
        return;
      }
      errored = true;
      this.lastDetail = code === 'language-not-supported'
        ? `Recognition locale ${recognitionLang(opts.lang)} is not supported on this device.`
        : code === 'not-allowed' || code === 'service-not-allowed'
          ? 'Microphone permission was denied.'
          : code === 'network'
            ? 'Speech recognition needs a network connection to the browser speech service.'
            : `Recognition error: ${code || 'unknown'}.`;
      opts.onState('unavailable');
    };
    rec.onend = () => {
      clearWatchdog();
      this.listening = false;
      this.recognition = null;
      // A delivered final belongs to the chat turn (thinking/speaking), and a
      // real error owns the unavailable state; only an unremarkable end is idle.
      if (!deliveredFinal && !errored) this.onStateCb?.('idle');
    };
    try {
      rec.start();
      this.listening = true;
      opts.onState('listening');
      armWatchdog();
    } catch (err) {
      clearWatchdog();
      this.listening = false;
      this.recognition = null;
      this.lastDetail = String(err);
      opts.onState('unavailable');
      throw err;
    }
  }

  /** Push-to-talk release: stop capture; final results arrive via onresult. */
  stop(): void {
    if (!this.recognition || !this.listening) return;
    try { this.recognition.stop(); } catch { /* already stopped */ }
    this.listening = false;
  }

  abort(): void {
    try { this.recognition?.abort(); } catch { /* ignore */ }
    this.listening = false;
    this.recognition = null;
  }

  async speak(text: string, lang: Lang, onEnd?: () => void): Promise<boolean> {
    if (!speechSynthesisSupported()) return false;
    const spoken = plainSpeech(text);
    if (!spoken) return false;
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new window.SpeechSynthesisUtterance(spoken);
      const voice = pickSpeechVoice(this.voices.length ? this.voices : systemVoices(), lang);
      if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
      else utterance.lang = recognitionLang(lang);
      utterance.rate = 1;
      utterance.pitch = 1;
      // Token guard: a cancelled/old utterance must never reset the state of a
      // newer turn (barge-in race), and errors must end the speaking state
      // instead of leaving the strip stuck on "speaking" forever.
      const token = ++this.speakToken;
      return await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
        utterance.onstart = () => finish(true);
        utterance.onerror = () => { finish(false); if (this.speakToken === token) onEnd?.(); };
        utterance.onend = () => { if (this.speakToken === token) onEnd?.(); };
        synth.speak(utterance);
        // Engines that never fire onstart still count as playing.
        window.setTimeout(() => finish(true), 600);
      });
    } catch {
      return false;
    }
  }

  stopSpeaking(): void {
    this.speakToken++;
    if (!speechSynthesisSupported()) return;
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  }

  dispose(): void {
    this.abort();
    this.stopSpeaking();
    this.onStateCb = null;
  }
}
