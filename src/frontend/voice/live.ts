import type { Lang } from '../i18n';

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

/**
 * AudioWorklet capture: resample the mic to 16 kHz mono PCM16 and post
 * 100 ms frames. Inline blob so no extra asset ships. The worklet never
 * connects to the destination — the mic is sent, not monitored.
 */
const CAPTURE_WORKLET = `
class StragyCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.leftover = new Float32Array(0);
    this.pos = 0;
    this.pending = [];
    this.step = sampleRate / 16000;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || ch.length === 0) return true;
    const merged = new Float32Array(this.leftover.length + ch.length);
    merged.set(this.leftover);
    merged.set(ch, this.leftover.length);
    let p = this.pos;
    while (Math.floor(p) + 1 < merged.length) {
      const i = Math.floor(p);
      const f = p - i;
      this.pending.push(merged[i] * (1 - f) + merged[i + 1] * f);
      p += this.step;
    }
    const consumed = Math.floor(p);
    this.leftover = merged.slice(consumed);
    this.pos = p - consumed;
    while (this.pending.length >= 1600) {
      const frame = this.pending.slice(0, 1600);
      this.pending = this.pending.slice(1600);
      const pcm = new Int16Array(1600);
      for (let i = 0; i < 1600; i++) {
        pcm[i] = Math.max(-32768, Math.min(32767, Math.round(frame[i] * 32767)));
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor('stragy-capture', StragyCapture);
`;

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
 */
export class LiveVoice {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private mic: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private playing = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private workletUrl: string | null = null;
  onEvent: ((ev: LiveEvent) => void) | null = null;
  onClose: (() => void) | null = null;

  async start(lang: Lang): Promise<void> {
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext();
    this.workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
    await this.ctx.audioWorklet.addModule(this.workletUrl);
    this.source = this.ctx.createMediaStreamSource(this.mic);
    this.node = new AudioWorkletNode(this.ctx, 'stragy-capture');
    this.node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'audio_chunk', audio: b64FromBuffer(e.data) }));
      }
    };
    this.source.connect(this.node);

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/voice/ws`);
    this.ws.onopen = () => this.ws?.send(JSON.stringify({ type: 'start', lang }));
    this.ws.onmessage = (e: MessageEvent<string>) => {
      let ev: LiveEvent;
      try { ev = JSON.parse(e.data) as LiveEvent; } catch { return; }
      if (ev.type === 'audio_chunk') this.play(ev.audio);
      else if (ev.type === 'interrupted') this.stopPlayback();
      this.onEvent?.(ev);
    };
    this.ws.onclose = () => {
      this.stopPlayback();
      this.onClose?.();
    };
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

  stop(): void {
    try { this.ws?.send(JSON.stringify({ type: 'stop' })); } catch { /* closing */ }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.stopPlayback();
    this.node?.disconnect();
    this.source?.disconnect();
    this.mic?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    if (this.workletUrl) URL.revokeObjectURL(this.workletUrl);
    this.node = null;
    this.source = null;
    this.mic = null;
    this.ctx = null;
    this.workletUrl = null;
  }
}
