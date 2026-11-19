import { opencode, type ApiError, type VoiceModels } from '../opencode/client';
import type { Lang } from '../i18n';
import { languageInstruction } from '../i18n';
import type { StartOptions, VoiceEngine, VoiceModel, VoiceState } from './types';

/** Honest error for the upstream billing blocker found in the pass-08 spike. */
export class RealtimeUnavailableError extends Error {
  constructor(message: string, public readonly creditsRequired: boolean, public readonly status = 0) {
    super(message);
    this.name = 'RealtimeUnavailableError';
  }
}

function waitForIce(pc: RTCPeerConnection, timeoutMs = 6000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => { if (pc.iceGatheringState === 'complete') finish(); };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
    check();
  });
}

/**
 * Tier 1 — OpenCode realtime speech-to-speech, WebRTC transport ONLY. The gate
 * destroys WebSocket tokens by redaction, and the spike proved `gpt-live-1`
 * rejects websocket anyway. A session is usable only when `voice/session`
 * returns a real SDP answer; 503 insufficient credits is surfaced honestly.
 */
export class RealtimeVoice implements VoiceEngine {
  readonly kind = 'realtime' as const;
  private pc: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private channel: RTCDataChannel | null = null;
  private onStateCb: ((s: VoiceState) => void) | null = null;
  private transcriptCb: StartOptions['onTranscript'] | null = null;
  private model = 'gpt-live-1';

  private async models(): Promise<VoiceModels> {
    return opencode.voiceModels();
  }

  async listModels(): Promise<VoiceModel[]> {
    try {
      const data = await this.models();
      return (data.models || []).map((m) => ({
        model: m.model, provider: m.provider, transports: m.transports, available: m.available,
      }));
    } catch {
      return [];
    }
  }

  /** Config presence only — a billable session is checked by start(). */
  async available(): Promise<boolean> {
    const list = await this.listModels();
    return list.some((m) => m.available && m.transports.includes('webrtc'));
  }

  async start(opts: StartOptions): Promise<void> {
    this.onStateCb = opts.onState;
    this.transcriptCb = opts.onTranscript;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      opts.onState('unavailable');
      throw new RealtimeUnavailableError('WebRTC voice is not supported in this browser.', false);
    }

    let models: VoiceModels;
    try { models = await this.models(); }
    catch (err) { opts.onState('unavailable'); throw new RealtimeUnavailableError(`Voice models unavailable: ${String(err)}`, false); }
    const usable = (models.models || []).find((m) => m.available && m.transports.includes('webrtc'));
    if (!usable) {
      opts.onState('unavailable');
      throw new RealtimeUnavailableError('No realtime voice model is configured for WebRTC.', false);
    }
    this.model = models.default || usable.model;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.pc = new RTCPeerConnection();
      for (const track of this.stream.getTracks()) this.pc.addTrack(track, this.stream);
      this.channel = this.pc.createDataChannel('stragy-voice', { id: 1 });
      this.channel.onmessage = (event) => this.handleData(event.data);
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await waitForIce(this.pc);
      const sdp = this.pc.localDescription?.sdp || '';
      if (!sdp) throw new RealtimeUnavailableError('Could not create a WebRTC offer.', false);

      let answer: { transport?: { type?: string; sdp?: string } };
      try {
        answer = await opencode.createVoiceSession({
          model: this.model,
          session: {
            instructions: langInstructions(opts.lang),
            ...(opts.lang === 'ta' ? { locale: 'ta-IN' } : {}),
          },
          transport: { type: 'webrtc', sdp, dcid: 1 },
        });
      } catch (err) {
        throw this.mapSessionError(err);
      }
      const answerSdp = answer?.transport?.sdp || '';
      if (answer?.transport?.type !== 'webrtc' || !answerSdp || /redacted_by_stragy_gate/i.test(answerSdp)) {
        throw new RealtimeUnavailableError('The voice service did not return a usable WebRTC answer.', false);
      }
      await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      opts.onState('listening');
    } catch (err) {
      this.stop();
      opts.onState('unavailable');
      throw err instanceof RealtimeUnavailableError ? err
        : new RealtimeUnavailableError(String(err), false);
    }
  }

  private mapSessionError(err: unknown): RealtimeUnavailableError {
    const api = err as ApiError;
    const status = Number(api?.status || 0);
    const message = String(api?.message || err || '');
    if (status === 503 && /insufficient|credit|balance|pay.as.you.go/i.test(message)) {
      return new RealtimeUnavailableError('Realtime unavailable — OpenCode Models credits required.', true, status);
    }
    return new RealtimeUnavailableError(`Realtime voice unavailable (${status || 'error'}): ${message.slice(0, 200)}`, false, status);
  }

  private handleData(raw: unknown): void {
    let event: Record<string, unknown>;
    try { event = typeof raw === 'string' ? JSON.parse(raw) as Record<string, unknown> : raw as Record<string, unknown>; }
    catch { return; }
    const type = String(event.type || '');
    const text = typeof event.transcript === 'string' ? event.transcript
      : typeof event.delta === 'string' ? event.delta : '';
    if (!text) return;
    const final = /completed|done$/i.test(type) || /input_audio_transcription\.completed/.test(type);
    this.transcriptCb?.(text, final);
  }

  stop(): void {
    try { this.channel?.close(); } catch { /* ignore */ }
    this.channel = null;
    try { this.pc?.close(); } catch { /* ignore */ }
    this.pc = null;
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    this.stream = null;
    this.onStateCb?.('idle');
  }

  dispose(): void {
    this.stop();
    this.onStateCb = null;
    this.transcriptCb = null;
  }
}

function langInstructions(lang: Lang): string {
  const base = lang === 'ta'
    ? 'You are a Tamil-speaking research assistant. Reply in Tamil (தமிழ்). Keep tickers, dates, indicator names and all numbers in Latin digits.'
    : 'You are a research assistant. Reply in English.';
  return `${base} ${languageInstruction(lang)}`;
}
