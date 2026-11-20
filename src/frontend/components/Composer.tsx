import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Camera, Mic, Paperclip, Square } from 'lucide-react';
import type { Lang, Key } from '../i18n';
import { t } from '../i18n';
import { LanguageToggle } from './LanguageToggle';
import { ModelPicker } from './ModelPicker';
import type { VoiceControllerApi } from '../voice/types';

export type Attachment = { name: string; uri: string; mime: string };

type Option = { value: string; label: string };

type Props = {
  lang: Lang;
  onLangChange: (lang: Lang) => void;
  busy: boolean;
  models: Option[];
  agents: Option[];
  commands: Option[];
  selectedModel: string;
  selectedAgent: string;
  selectedCommand: string;
  onModelChange: (v: string) => void;
  onAgentChange: (v: string) => void;
  onCommandChange: (v: string) => void;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  onVoice: () => void;
  placeholder?: string;
  /** Controlled text (used by the voice turn to insert a final transcript). */
  value?: string;
  onValueChange?: (text: string) => void;
  /** Full voice-turn controller; enables the live state strip and push-to-talk. */
  voice?: VoiceControllerApi | null;
};

async function fileToDataUri(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, mime: file.type || 'image/png', uri: String(reader.result) });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function voiceLabel(lang: Lang, state: string): string {
  const map: Record<string, Key> = {
    listening: 'listening',
    transcribing: 'transcribing',
    thinking: 'thinking',
    processing: 'thinking',
    speaking: 'speaking',
    unavailable: 'unavailable',
  };
  const key = map[state];
  return key ? t(lang, key) : state;
}

export function Composer(props: Props) {
  const [ownText, setOwnText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const controlled = props.value !== undefined && !!props.onValueChange;
  const text = controlled ? (props.value as string) : ownText;
  const setText = (next: string) => {
    if (controlled) props.onValueChange?.(next);
    else setOwnText(next);
  };

  // visualViewport: keep the composer above the on-screen keyboard. The value
  // is consumed by CSS via --kb-inset; the composer stays in normal flow.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb-inset', `${Math.round(inset)}px`);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  const autoGrow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 136)}px`;
  };
  useEffect(autoGrow, [text]);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const results = await Promise.all(Array.from(files).filter((f) => f.type.startsWith('image/')).map(fileToDataUri));
    setAttachments((prev) => [...prev, ...results].slice(0, 4));
  };

  const submit = () => {
    const value = text.trim();
    if ((!value && !attachments.length) || props.busy) return;
    props.onSend(value, attachments);
    setText('');
    setAttachments([]);
    if (taRef.current) taRef.current.style.height = 'auto';
  };

  const voice = props.voice;
  const vs = voice?.state || 'idle';
  const showStrip = !!voice && vs !== 'idle';

  return (
    <div className="composer" data-testid="composer">
      {showStrip && (
        <div className={`voice-strip ${vs}`} data-testid="voice-strip" aria-label="Voice turn status">
          <span className={`chip ${vs === 'speaking' || vs === 'listening' ? 'running' : vs === 'unavailable' ? 'failed' : 'queued'}`} data-testid="voice-state">
            <span className="cdot" />{voiceLabel(props.lang, vs)}
          </span>
          <span className="voice-strip-text" data-testid="voice-transcript">{voice?.transcript || voice?.detail || ''}</span>
          {(vs === 'listening' || vs === 'transcribing') && (
            <button type="button" className="btn" data-testid="ptt-button" onClick={() => void voice?.toggle()}>
              <Square size={12} /> {t(props.lang, 'stop')}
            </button>
          )}
          {vs === 'speaking' && (
            <button type="button" className="btn" data-testid="stop-speech-button" onClick={() => voice?.stopSpeaking()}>
              <Square size={12} /> {t(props.lang, 'stopSpeaking')}
            </button>
          )}
          {vs === 'unavailable' && voice?.canRepeat && (
            <button type="button" className="btn" data-testid="voice-repeat-button" onClick={() => void voice?.repeat()}>
              {t(props.lang, 'listenAgain')}
            </button>
          )}
          {vs === 'unavailable' && (
            <button type="button" className="btn" data-testid="voice-realtime-test" onClick={() => void voice?.probeRealtime()}>
              {t(props.lang, 'testRealtime')}
            </button>
          )}
          {voice?.detail && <span className="voice-strip-detail" data-testid="voice-detail">{voice.detail}</span>}
        </div>
      )}
      <div className="composer-inner">
        {attachments.length > 0 && (
          <div className="chiprow" data-testid="attachments">
            {attachments.map((a, i) => (
              <span className="attach-chip" key={i}>
                <Paperclip size={12} /> {a.name.slice(0, 22)}
                <button type="button" aria-label="Remove attachment" onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          data-testid="composer-input"
          value={text}
          placeholder={props.placeholder || t(props.lang, 'chatPlaceholder' as Key)}
          lang={props.lang}
          className={props.lang === 'ta' ? 'ta-text' : undefined}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          aria-label="Message"
        />
        <div className="comprow">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden data-testid="file-input" onChange={(e) => addFiles(e.target.files)} />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden data-testid="camera-input" onChange={(e) => addFiles(e.target.files)} />
          <button className="icon-btn" type="button" aria-label={t(props.lang, 'attach')} title="Attach image" onClick={() => fileRef.current?.click()}><Paperclip /></button>
          <button className="icon-btn" type="button" aria-label="Take photo" title="Camera" onClick={() => cameraRef.current?.click()}><Camera /></button>
          <button
            className="icon-btn"
            type="button"
            aria-label={t(props.lang, 'voice')}
            title={t(props.lang, 'pushToTalk')}
            data-testid="voice-button"
            aria-pressed={voice?.state === 'listening'}
            disabled={props.busy}
            onClick={() => { if (props.voice) void props.voice.toggle(); else props.onVoice(); }}
          ><Mic /></button>
          {voice?.creditsRequired && (
            <span className="chip failed" data-testid="realtime-credits-chip" title={t(props.lang, 'realtimeCredits')}>
              <span className="cdot" />{t(props.lang, 'unavailable')} · realtime
            </span>
          )}
          <ModelPicker options={props.models} value={props.selectedModel} onChange={props.onModelChange} />
          <select
            className="sel"
            aria-label={t(props.lang, 'agent')}
            data-testid="agent-select"
            value={props.selectedAgent}
            onChange={(e) => props.onAgentChange(e.target.value)}
            title="Agents are read-only here"
          >
            {props.agents.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
          <select
            className="sel"
            aria-label={t(props.lang, 'command')}
            data-testid="command-select"
            value={props.selectedCommand}
            onChange={(e) => props.onCommandChange(e.target.value)}
          >
            <option value="">{t(props.lang, 'noCommand')}</option>
            {props.commands.map((c) => <option key={c.value} value={c.value}>/{c.value}</option>)}
          </select>
          <LanguageToggle value={props.lang} onChange={props.onLangChange} compact />
          {props.busy ? (
            <button className="send" type="button" data-testid="stop-button" onClick={props.onStop}>
              <Square fill="currentColor" /> {t(props.lang, 'stop')}
            </button>
          ) : (
            <button className="send" type="button" data-testid="send-button" disabled={!text.trim() && !attachments.length} onClick={submit}>
              <ArrowUp /> {t(props.lang, 'send')}
            </button>
          )}
        </div>
      </div>
      <p className="fine">Observed data only · research, not trading.</p>
    </div>
  );
}
