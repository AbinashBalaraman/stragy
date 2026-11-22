/**
 * Stragy live-voice capture processor (AudioWorkletGlobalScope).
 * Resamples the mic to 16 kHz mono PCM16 and posts 100 ms frames.
 * Served as a same-origin asset — blob: worklet URLs are blocked by the
 * proxy's Content-Security-Policy (script-src 'self').
 */
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
