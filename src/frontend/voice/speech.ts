import type { Lang } from '../i18n';

/** Language tag used by the Web Speech APIs. */
export function recognitionLang(lang: Lang): string {
  return lang === 'ta' ? 'ta-IN' : 'en-IN';
}

export function isTamilVoice(voice: SpeechSynthesisVoice): boolean {
  return /^ta([-_]|$)/i.test(voice.lang || '') || /tamil/i.test(voice.name || '');
}

export function isEnglishVoice(voice: SpeechSynthesisVoice): boolean {
  return /^en([-_]|$)/i.test(voice.lang || '') && !isTamilVoice(voice);
}

/** Best voice for the requested language: exact locale first, then family. */
export function pickSpeechVoice(voices: readonly SpeechSynthesisVoice[], lang: Lang): SpeechSynthesisVoice | null {
  const pool = voices.filter((v) => (lang === 'ta' ? isTamilVoice(v) : isEnglishVoice(v)));
  if (!pool.length) return null;
  const locale = recognitionLang(lang);
  return pool.find((v) => v.lang.toLowerCase() === locale.toLowerCase())
    ?? pool.find((v) => v.lang.toLowerCase().replace('_', '-').startsWith(lang))
    ?? pool[0];
}

/** Read spoken text naturally. Tamil script is left intact; Latin digits stay Latin. */
export function plainSpeech(text: string): string {
  if (!text) return '';
  let value = text.replace(/\r\n/g, '\n');
  value = value.replace(/```[\s\S]*?```/g, ' Code block omitted. ');
  value = value.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  value = value.replace(/\[([^\]]+)\]\((?:https?:\/\/|\/)[^)]*\)/g, '$1');
  value = value.split('\n')
    .filter((line) => !/^\s*\|?[\s:|-]+\|[\s:|-]+$/.test(line))
    .map((line) => line.replace(/\s*\|\s*/g, ', '))
    .join('\n');
  value = value.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  value = value.replace(/^\s{0,3}>\s?/gm, '');
  value = value.replace(/^\s*[-*+]\s+/gm, '');
  value = value.replace(/^\s*\d+[.)]\s+/gm, '');
  value = value.replace(/`([^`]+)`/g, '$1');
  value = value.replace(/(\*\*|__)(.*?)\1/g, '$2');
  value = value.replace(/(\*|_)([^*_\n]+)\1/g, '$2');
  value = value.replace(/~~([^~]+)~~/g, '$1');
  value = value.replace(/₹\s?/g, 'rupees ');
  value = value.replace(/\bRs\.?\s?(?=\d)/gi, 'rupees ');
  value = value.replace(/&nbsp;/g, ' ');
  value = value.replace(/[•·]/g, ', ');
  value = value.replace(/[→←↔]/g, ' to ');
  value = value.replace(/[—–]/g, ', ');
  value = value.replace(/[ \t]+/g, ' ');
  value = value.replace(/\n{2,}/g, '. ');
  value = value.replace(/\n/g, ', ');
  value = value.replace(/\s+([.,!?;:])/g, '$1');
  value = value.replace(/([,.]\s*){3,}/g, '. ');
  return value.trim().slice(0, 1200);
}

export function systemVoices(): SpeechSynthesisVoice[] {
  try {
    return typeof window !== 'undefined' && window.speechSynthesis
      ? Array.from(window.speechSynthesis.getVoices() || [])
      : [];
  } catch {
    return [];
  }
}
