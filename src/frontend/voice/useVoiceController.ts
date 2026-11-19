import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lang } from '../i18n';
import { BrowserVoice } from './browser';
import { RealtimeVoice, RealtimeUnavailableError } from './realtime';
import { ServerVoice, serverSttStatus } from './server';
import { detectVoiceTiers } from './capabilities';
import type { VoiceControllerApi, VoiceMode, VoiceState, VoiceTier } from './types';

const MODE_KEY = 'stragy.voice.mode';

function readMode(): VoiceMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === 'browser' || v === 'server' || v === 'realtime' || v === 'text') return v;
  } catch { /* ignore */ }
  return 'browser';
}

type Opts = { onFinalTranscript?: (text: string) => void };

/**
 * Owns the voice turn: mic -> STT -> final transcript into the composer -> send
 * -> assistant reply -> TTS. Tiers are detected live; a failed realtime session
 * (503 insufficient credits) becomes an honest chip, never a dead button.
 */
export function useVoiceController(lang: Lang, opts: Opts = {}): VoiceControllerApi {
  const [state, setStateRaw] = useState<VoiceState>('idle');
  const [tiers, setTiers] = useState<VoiceTier[]>([]);
  const [mode, setModeRaw] = useState<VoiceMode>(readMode);
  const [transcript, setTranscript] = useState('');
  const [detail, setDetail] = useState('');
  const [creditsRequired, setCreditsRequired] = useState(false);
  const [canRepeat, setCanRepeat] = useState(false);

  const engines = useRef<{ browser: BrowserVoice | null; server: ServerVoice | null; realtime: RealtimeVoice | null }>({ browser: null, server: null, realtime: null });
  const active = useRef<VoiceMode | null>(null);
  const lastReply = useRef('');
  const onFinal = useRef(opts.onFinalTranscript);
  onFinal.current = opts.onFinalTranscript;

  const browser = () => (engines.current.browser ??= new BrowserVoice());
  const server = () => (engines.current.server ??= new ServerVoice());
  const realtime = () => (engines.current.realtime ??= new RealtimeVoice());

  const setState = useCallback((s: VoiceState) => {
    setStateRaw(s);
    if (s === 'idle' || s === 'unavailable') setTranscript('');
  }, []);
  const setLastReply = useCallback((text: string) => {
    lastReply.current = text;
    setCanRepeat(Boolean(text.trim()));
  }, []);

  const refresh = useCallback(async () => {
    try { setTiers(await detectVoiceTiers(lang)); }
    catch { setTiers([]); }
  }, [lang]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => () => {
    engines.current.browser?.dispose();
    engines.current.server?.dispose();
    engines.current.realtime?.dispose();
  }, []);

  const onTranscript = useCallback((text: string, final: boolean) => {
    if (final) {
      setTranscript(text);
      setStateRaw('transcribing');
      setDetail('');
      // Hand the final transcript to the chat turn; it fills the composer and
      // sends with the Tamil/English prefix as appropriate.
      onFinal.current?.(text);
    } else {
      setTranscript(text);
    }
  }, []);

  const onState = useCallback((s: VoiceState) => {
    setStateRaw(s);
    if (s === 'unavailable') {
      const why = browser().detail(lang);
      if (why) setDetail(why);
    }
  }, [lang]);

  const stop = useCallback(() => {
    if (active.current === 'browser') browser().stop();
    else if (active.current === 'server') server().stop();
    else if (active.current === 'realtime') realtime().stop();
    active.current = null;
    setStateRaw('idle');
  }, []);

  const handleFailure = useCallback((err: unknown) => {
    active.current = null;
    if (err instanceof RealtimeUnavailableError) {
      setCreditsRequired(err.creditsRequired);
      setDetail(err.message);
      setTiers((prev) => prev.map((tier) => tier.kind === 'realtime'
        ? { ...tier, available: false, reason: err.message }
        : tier));
    } else {
      setDetail(String(err instanceof Error ? err.message : err));
    }
    setStateRaw('unavailable');
  }, []);

  const probeRealtime = useCallback(async () => {
    setCreditsRequired(false);
    setDetail('');
    try {
      await realtime().start({ sessionId: '', lang, onTranscript, onState });
      // Track the live session so the mic/PTT can actually stop it; without
      // this a successful probe left the mic hot with no way to close it.
      active.current = 'realtime';
      setDetail('Realtime WebRTC voice connected.');
    } catch (err) {
      handleFailure(err);
    }
  }, [lang, onTranscript, onState, handleFailure]);

  const start = useCallback(async () => {
    setCreditsRequired(false);
    setDetail('');
    // A new spoken turn interrupts any answer still being read aloud.
    browser().stopSpeaking();
    server().stopSpeaking();
    const startOpts = { sessionId: '', lang, onTranscript, onState };
    try {
      if (mode === 'browser') {
        if (!browser().sttAvailable()) {
          // Firefox/desktop without Web Speech: fall back to configured server
          // transcription instead of a dead mic button.
          let serverStt = false;
          try { serverStt = (await serverSttStatus()).configured; } catch { /* ignore */ }
          if (serverStt && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia) {
            active.current = 'server';
            await server().start(startOpts);
            setDetail('Browser recognition is unavailable here — using server transcription.');
            return;
          }
          setStateRaw('unavailable');
          setDetail('Web Speech recognition is not available in this browser. Type a message instead.');
          return;
        }
        active.current = 'browser';
        await browser().start(startOpts);
        setDetail(browser().detail(lang));
      } else if (mode === 'server') {
        active.current = 'server';
        await server().start(startOpts);
        setDetail(await server().detail(lang));
      } else if (mode === 'realtime') {
        active.current = 'realtime';
        await realtime().start(startOpts);
        setDetail('Realtime WebRTC voice connected.');
      } else {
        setStateRaw('unavailable');
        setDetail('Text-only mode. Choose a voice tier to listen.');
      }
    } catch (err) {
      handleFailure(err);
    }
  }, [mode, lang, onTranscript, onState, handleFailure]);

  const toggle = useCallback(async () => {
    if (state === 'listening' || state === 'transcribing') stop();
    else await start();
  }, [state, start, stop]);

  const speakGen = useRef(0);
  const speak = useCallback(async (text: string, langOverride?: Lang): Promise<boolean> => {
    if (!text) return false;
    lastReply.current = text;
    const l = langOverride ?? lang;
    const gen = ++speakGen.current;
    // A stale onend (cancelled utterance, barge-in) must not reset a newer state.
    const done = () => { if (speakGen.current === gen) setStateRaw('idle'); };
    let played = false;
    if (mode === 'server') {
      played = await server().speak(text, l, done);
    } else {
      if (browser().hasTtsVoice(l)) played = await browser().speak(text, l, done);
      if (!played) played = await server().speak(text, l, done);
    }
    if (played) { setStateRaw('speaking'); return true; }
    setStateRaw('unavailable');
    setDetail('No TTS voice is available here; the answer is shown as text.');
    return false;
  }, [mode, lang]);

  const stopSpeaking = useCallback(() => {
    speakGen.current++;
    browser().stopSpeaking();
    server().stopSpeaking();
    setStateRaw('idle');
  }, []);

  const repeat = useCallback(async () => speak(lastReply.current, lang), [speak, lang]);

  const setMode = useCallback((next: VoiceMode) => {
    stop();
    setModeRaw(next);
    setCreditsRequired(false);
    setDetail('');
    try { localStorage.setItem(MODE_KEY, next); } catch { /* ignore */ }
  }, [stop]);

  return {
    state, tiers, mode, setMode, transcript, detail, creditsRequired,
    setState, setLastReply, canRepeat, toggle, start, stop, speak, stopSpeaking, refresh, repeat, probeRealtime,
  };
}
