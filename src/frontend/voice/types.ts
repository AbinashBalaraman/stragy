import type { Lang } from '../i18n';

/** Voice turn states. `thinking` is the assistant working; `processing` is kept as an alias. */
export type VoiceState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'processing'
  | 'speaking'
  | 'unavailable';

export type VoiceModel = {
  model: string;
  provider: string;
  transports: string[];
  available: boolean;
};

export type StartOptions = {
  sessionId: string;
  lang: Lang;
  onTranscript: (text: string, final: boolean) => void;
  onState: (state: VoiceState) => void;
};

/** One transport. Language selection never changes which engine is in use. */
export interface VoiceEngine {
  readonly kind: 'realtime' | 'browser' | 'server' | 'text';
  listModels(lang: Lang): Promise<VoiceModel[]>;
  start(opts: StartOptions): Promise<void>;
  stop(): void;
  dispose(): void;
  available(lang: Lang): Promise<boolean>;
  /** Speak text. Returns false when the engine has no usable voice. */
  speak?(text: string, lang: Lang, onEnd?: () => void): Promise<boolean>;
  stopSpeaking?(): void;
}

export type VoiceTier = {
  kind: 'realtime' | 'browser' | 'server' | 'text';
  available: boolean;
  reason: string;
  label: string;
  /** Speech-to-text usable on this device/host. */
  stt?: boolean;
  /** Text-to-speech usable on this device/host. */
  tts?: boolean;
  /** espeak-style formant output: honest "robotic" label. */
  robotic?: boolean;
};

export type VoiceMode = 'browser' | 'server' | 'realtime' | 'text';

/** The surface the chat composer drives for a full voice turn. */
export type VoiceControllerApi = {
  state: VoiceState;
  tiers: VoiceTier[];
  mode: VoiceMode;
  setMode: (mode: VoiceMode) => void;
  /** Partial (interim) transcript while the mic is open. */
  transcript: string;
  /** Short honest reason/status line (e.g. why realtime is blocked). */
  detail: string;
  creditsRequired: boolean;
  /** Let the chat turn drive thinking/speaking/idle states. */
  setState: (state: VoiceState) => void;
  /** Remember the assistant answer so it can be spoken again. */
  setLastReply: (text: string) => void;
  /** True when there is a previous answer that can be replayed. */
  canRepeat: boolean;
  /** Push-to-talk: start listening (or finish when already listening). */
  toggle: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => void;
  /** Speak a reply using the current fallback chain; returns false if unavailable. */
  speak: (text: string, lang?: Lang) => Promise<boolean>;
  stopSpeaking: () => void;
  refresh: () => Promise<void>;
  /** Speak the last assistant answer again. */
  repeat: () => Promise<boolean>;
  /** Try a WebRTC realtime session once; a 503 becomes an honest chip. */
  probeRealtime: () => Promise<void>;
};
