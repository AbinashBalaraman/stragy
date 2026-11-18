// @vitest-environment jsdom
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createVoiceInput, pickSpeechVoice, plainSpeech, readVoicePreferences, speak,
  writeVoicePreferences, VOICE_PREFERENCES_KEY,
} from '../../client/voice';

type RecognitionHandler = ((event: unknown) => void) | null;

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  started = false;
  stopped = false;
  aborted = false;
  onresult: RecognitionHandler = null;
  onerror: RecognitionHandler = null;
  onend: (() => void) | null = null;
  constructor() { FakeRecognition.last = this; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
  abort() { this.aborted = true; }
  results(parts: Array<{ transcript: string; final: boolean }>) {
    this.onresult?.({
      resultIndex: 0,
      results: parts.map(part => Object.assign([{ transcript: part.transcript }], { isFinal: part.final, length: 1 })),
    });
  }
}

class FakeRecorder {
  static last: FakeRecorder | null = null;
  static isTypeSupported = () => true;
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown) { FakeRecorder.last = this; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.onstop?.(); }
  chunk() { this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) }); }
}

class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  voice: unknown = null;
  onend: (() => void) | null = null;
  constructor(text: string) { this.text = text; }
}

const clearVoiceGlobals = () => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
  delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  delete (window as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
};

beforeEach(() => {
  clearVoiceGlobals();
  const dom = new JSDOM('', { url: 'https://voice.test' });
  vi.stubGlobal('localStorage', dom.window.localStorage);
});

afterEach(() => {
  clearVoiceGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('plain speech text', () => {
  it('strips markdown furniture and speaks the rupee symbol', () => {
    const spoken = plainSpeech('## Setup\n- Stop **3%** below entry\n- Price ₹2,900\n[Read more](https://example.test)\n| RSI | 54 |');
    expect(spoken).toContain('Setup');
    expect(spoken).toContain('Stop 3% below entry');
    expect(spoken).toContain('rupees 2,900');
    expect(spoken).toContain('Read more');
    expect(spoken).toContain('RSI, 54');
    expect(spoken).not.toContain('#');
    expect(spoken).not.toContain('**');
    expect(spoken).not.toContain('₹');
    expect(spoken).not.toContain('https://');
  });

  it('drops fenced code rather than reading it aloud', () => {
    expect(plainSpeech('Answer\n```ts\nconst x = 1;\n```\nDone')).toContain('Code block omitted.');
  });
});

describe('speech synthesis', () => {
  it('prefers an en-IN voice and speaks the stripped answer', () => {
    const synth = { cancel: vi.fn(), speak: vi.fn(), getVoices: () => [
      { lang: 'en-US', name: 'Samantha' },
      { lang: 'en-IN', name: 'Veena' },
    ] };
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    expect(speak('Stop **3%** at ₹2,900')).toBe(true);
    expect(synth.cancel).toHaveBeenCalled();
    const utterance = synth.speak.mock.calls[0][0] as FakeUtterance;
    expect(utterance.text).toContain('3%');
    expect(utterance.text).toContain('rupees 2,900');
    expect(utterance.lang).toBe('en-IN');
    expect((utterance.voice as { name: string }).name).toBe('Veena');
  });

  it('picks an English voice when no en-IN voice exists', () => {
    expect(pickSpeechVoice([{ lang: 'hi-IN' }, { lang: 'en-GB' }] as unknown as SpeechSynthesisVoice[])?.lang).toBe('en-GB');
    expect(pickSpeechVoice([])).toBeNull();
  });

  it('reports unsupported speech instead of throwing', () => {
    expect(speak('hello')).toBe(false);
  });
});

describe('browser recognition', () => {
  it('streams interim text and delivers the final transcript for review', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognition);
    const onTranscript = vi.fn();
    const controller = createVoiceInput({ onTranscript });
    expect(controller.transport()).toBe('browser');
    void controller.start();
    const recognition = FakeRecognition.last!;
    expect(recognition.lang).toBe('en-IN');
    expect(recognition.interimResults).toBe(true);
    recognition.results([{ transcript: 'set my stop', final: false }]);
    expect(onTranscript).toHaveBeenLastCalledWith('set my stop', false);
    recognition.results([{ transcript: 'set my stop loss', final: true }]);
    recognition.results([{ transcript: ' to 5%', final: false }]);
    expect(onTranscript).toHaveBeenLastCalledWith('set my stop loss to 5%', false);
    recognition.onend?.();
    expect(onTranscript).toHaveBeenLastCalledWith('set my stop loss', true);
    controller.dispose();
  });

  it('stops listening on the second push-to-talk toggle', () => {
    vi.useFakeTimers();
    vi.stubGlobal('SpeechRecognition', FakeRecognition);
    const controller = createVoiceInput({ onTranscript: vi.fn() });
    void controller.start();
    const recognition = FakeRecognition.last!;
    controller.stop();
    expect(recognition.stopped).toBe(true);
    vi.advanceTimersByTime(500);
    controller.dispose();
  });

  it('reports a denied microphone honestly and does not capture', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognition);
    const onError = vi.fn();
    const controller = createVoiceInput({ onTranscript: vi.fn(), onError });
    void controller.start();
    FakeRecognition.last!.onerror?.({ error: 'not-allowed' });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Microphone access was denied'));
    expect(controller.listening()).toBe(false);
    controller.dispose();
  });
});

describe('recorder fallback', () => {
  const stubRecorder = () => {
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
    });
  };

  it('records one clip and fills the composer through the transcribe route', async () => {
    stubRecorder();
    const onTranscript = vi.fn();
    const controller = createVoiceInput({ onTranscript });
    expect(controller.transport()).toBe('recorder');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ text: 'Set my stop loss to 5%.' }), { status: 200 })));
    await controller.start();
    FakeRecorder.last!.chunk();
    controller.stop();
    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledWith('Set my stop loss to 5%.', true));
    controller.dispose();
  });

  it('says the transcribe route is missing instead of failing silently', async () => {
    stubRecorder();
    const onError = vi.fn();
    const controller = createVoiceInput({ onTranscript: vi.fn(), onError });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })));
    await controller.start();
    FakeRecorder.last!.chunk();
    controller.stop();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining('not available on this server yet')));
    controller.dispose();
  });
});

describe('voice preferences', () => {
  it('persists the voice-reply toggle in this browser', () => {
    expect(readVoicePreferences().voiceMode).toBe(false);
    expect(writeVoicePreferences({ voiceMode: true })).toBe(true);
    expect(JSON.parse(localStorage.getItem(VOICE_PREFERENCES_KEY) ?? '{}')).toEqual({ voiceMode: true });
    expect(readVoicePreferences().voiceMode).toBe(true);
    localStorage.setItem(VOICE_PREFERENCES_KEY, '{broken');
    expect(readVoicePreferences().voiceMode).toBe(false);
  });
});
