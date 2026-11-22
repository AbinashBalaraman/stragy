import type { Lang } from '../i18n';
import captureWorkletUrl from './capture-worklet.js?url';

/** Events from the live voice service (services/voice-live). */
export type LiveEvent =
  | { type: 'ready' }
  | { type: 'speech_start' }
  | { type: 'speech_end' }
  | { type: 'transcript'; text: string }
  | { type: 'thinking'; model?: string }
  | { type: 'assistant_started_speaking' }
  | { type: 'audio_chunk'; audio: string }
  | { type: 'assistant_finished_speaking'; model?: string }
  | { type: 'interrupted' }
  | { type: 'error'; message: string };

function b64FromBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(bin);
}

function pcmFromB64(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
  return out;
}

/**
 * One WebSocket = one hands-free conversation. The server does VAD turn
 * taking, so there is no stop button: speak, pause, it answers; speak over
 * it and it yields (barge-in). Playback is a gapless queue of 16 kHz buffers.
 *
 * Startup is stepwise with honest per-step errors (mic / audio module /
 * server). The capture worklet is a same-origin asset: the proxy CSP
 * (script-src 'self') rejects blob: module URLs.
 */
export class LiveVoice {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private mic: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private playing = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private stopped = false;
  private reconnected = false;
  private lang: Lang = 'en';
  onEvent: ((ev: LiveEvent) => void) | null = null;
  onClose: (() => void) | null = null;

  async start(lang: Lang): Promise<void> {
    this.lang = lang;
    this.stopped = false;

    // 1. Microphone — the only step that needs a hardware permission.
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      throw new Error(`Microphone: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 2. Audio graph. Resume inside the user gesture (autoplay policy).
    try {
      this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      await this.ctx.audioWorklet.addModule(captureWorkletUrl);
      this.source = this.ctx.createMediaStreamSource(this.mic);
      this.node = new AudioWorkletNode(this.ctx, 'stragy-capture');
      this.node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'audio_chunk', audio: b64FromBuffer(e.data) }));
        }
      };
      this.source.connect(this.node);
    } catch (e) {
      this.teardownAudio();
      throw new Error(`Audio capture: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 3. Conversation socket.
    await this.connect();
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/voice/ws`);
      this.ws = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'start', lang: this.lang }));
        resolve();
      };
      ws.onerror = () => {
        if (ws.readyState !== WebSocket.OPEN) {
          if (this.ws === ws) this.ws = null;
          reject(new Error('Voice server unreachable.'));
        }
      };
      ws.onmessage = (e: MessageEvent<string>) => {
        let ev: LiveEvent;
        try { ev = JSON.parse(e.data) as LiveEvent; } catch { return; }
        if (ev.type === 'audio_chunk') this.play(ev.audio);
        else if (ev.type === 'interrupted') this.stopPlayback();
        this.onEvent?.(ev);
      };
      ws.onclose = () => {
        if (this.ws !== ws || this.stopped) return;
        this.stopPlayback();
        // One automatic reconnect for mobile network blips; then honest close.
        if (!this.reconnected) {
          this.reconnected = true;
          this.connect().catch(() => this.onClose?.());
        } else {
          this.onClose?.();
        }
      };
    });
  }

  private play(b64: string): void {
    if (!this.ctx) return;
    const samples = pcmFromB64(b64);
    if (!samples.length) return;
    const buffer = this.ctx.createBuffer(1, samples.length, 16000);
    buffer.getChannelData(0).set(samples);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);
    const startAt = Math.max(this.ctx.currentTime + 0.02, this.nextTime);
    src.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.playing.add(src);
    src.onended = () => this.playing.delete(src);
  }

  /** Barge-in: drop everything scheduled, immediately. */
  stopPlayback(): void {
    for (const src of this.playing) {
      try { src.stop(); } catch { /* already ended */ }
    }
    this.playing.clear();
    this.nextTime = 0;
  }

  private teardownAudio(): void {
    this.node?.disconnect();
    this.source?.disconnect();
    this.mic?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.node = null;
    this.source = null;
    this.mic = null;
    this.ctx = null;
  }

  stop(): void {
    this.stopped = true;
    try { this.ws?.send(JSON.stringify({ type: 'stop' })); } catch { /* closing */ }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.stopPlayback();
    this.teardownAudio();
  }
}
