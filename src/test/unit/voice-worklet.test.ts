import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

/**
 * The browser AudioWorklet cannot initialize in headless Chromium (no audio
 * device), so exercise its actual source in a stubbed AudioWorkletGlobalScope.
 */
describe('voice capture worklet', () => {
  it('resamples 48 kHz input into 100 ms 16 kHz PCM16 frames', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/frontend/voice/capture-worklet.js'), 'utf8');
    const frames: ArrayBuffer[] = [];
    let Processor: new () => { port: { postMessage: (buf: ArrayBuffer) => void }; process: (inputs: Float32Array[][]) => boolean };
    let registered = '';
    class StubProcessor {
      port = { postMessage: (buf: ArrayBuffer) => frames.push(buf) };
      process(): boolean { return true; }
    }
    const sandbox = {
      AudioWorkletProcessor: StubProcessor,
      sampleRate: 48000,
      Float32Array, Int16Array, Math,
      registerProcessor: (name: string, cls: typeof Processor) => { registered = name; Processor = cls; },
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    expect(registered).toBe('stragy-capture');
    const proc = new Processor!();
    const input = new Float32Array(4800).fill(0.5); // 100 ms at 48 kHz = 1600 samples at 16 kHz
    proc.process([[input]]);
    expect(frames.length).toBe(1);
    expect(new Int16Array(frames[0]).length).toBe(1600);
    expect(new Int16Array(frames[0])[800]).toBeGreaterThan(15000);
  });
});
