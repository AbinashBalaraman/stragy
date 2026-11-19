import { opencode } from '../opencode/client';
import type { Lang } from '../i18n';
import type { VoiceModel, VoiceTier } from './types';
import { BrowserVoice } from './browser';
import { serverSttStatus, ttsCapability } from './server';

/**
 * Honest runtime capability detection for the voice panel and settings. Every
 * tier is derived from a live probe; nothing is advertised on assumption.
 */
export async function detectVoiceTiers(lang: Lang): Promise<VoiceTier[]> {
  const browser = new BrowserVoice();
  const stt = browser.sttAvailable();
  const ttsVoices = browser.ttsVoices(lang);
  let realtimeModels: VoiceModel[] = [];
  try {
    const result = await opencode.voiceModels();
    realtimeModels = (result?.models || []).map((m) => ({
      model: m.model, provider: m.provider, transports: m.transports, available: m.available,
    }));
  } catch { /* gate offline — realtime unavailable */ }
  const realtime = realtimeModels.some((m) => m.available && m.transports.includes('webrtc'));
  const cap = await ttsCapability();
  const sttStatus = await serverSttStatus();

  return [
    {
      kind: 'realtime',
      available: false, // config alone is not a billable session — start() proves it
      stt: realtime, tts: realtime,
      reason: realtime
        ? 'Model is configured, but a live WebRTC session needs OpenCode Models credits. Use “Test realtime” to check.'
        : 'No WebRTC realtime voice model is configured.',
      label: 'Realtime speech-to-speech',
    },
    {
      kind: 'browser',
      available: stt && ttsVoices.length > 0,
      stt, tts: ttsVoices.length > 0,
      reason: browser.detail(lang),
      label: 'Browser speech recognition + TTS',
    },
    {
      kind: 'server',
      available: cap.available,
      stt: sttStatus.configured && typeof MediaRecorder !== 'undefined',
      tts: cap.available,
      robotic: true,
      reason: cap.available
        ? `Local espeak-ng ${lang === 'ta' ? 'Tamil' : 'English'} TTS (robotic); browser TTS is preferred. Server STT ${sttStatus.configured ? 'configured' : 'not configured'}.`
        : 'Local espeak-ng TTS service is not reachable.',
      label: 'Server TTS fallback',
    },
    {
      kind: 'text',
      available: true,
      stt: false, tts: false,
      reason: 'Text chat always works through the gate.',
      label: 'Text only',
    },
  ];
}
