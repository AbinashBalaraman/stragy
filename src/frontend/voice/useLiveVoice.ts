import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lang } from '../i18n';
import { LiveVoice } from './live';

export type LiveState = 'off' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

/**
 * Hands-free live conversation: one tap starts it, silence ends your turn,
 * speech interrupts the assistant. No stop-to-record, no upload wait.
 */
export function useLiveVoice() {
  const [state, setState] = useState<LiveState>('off');
  const [transcript, setTranscript] = useState('');
  const [detail, setDetail] = useState('');
  const liveRef = useRef<LiveVoice | null>(null);

  const stop = useCallback(() => {
    liveRef.current?.stop();
    liveRef.current = null;
    setState('off');
    setDetail('');
  }, []);

  const start = useCallback(async (lang: Lang) => {
    if (liveRef.current) return;
    setState('connecting');
    setTranscript('');
    setDetail('');
    const lv = new LiveVoice();
    liveRef.current = lv;
    lv.onEvent = (ev) => {
      switch (ev.type) {
        case 'ready':
        case 'speech_start':
          setState('listening');
          setDetail('');
          break;
        case 'transcript':
          setTranscript(ev.text);
          setState('thinking');
          break;
        case 'assistant_started_speaking':
          setState('speaking');
          break;
        case 'assistant_finished_speaking':
        case 'interrupted':
          setState('listening');
          break;
        case 'error':
          // Conversation stays alive; show the honest reason and keep listening.
          setDetail(ev.message);
          setState((s) => (s === 'connecting' ? 'error' : 'listening'));
          break;
        default:
          break;
      }
    };
    lv.onClose = () => {
      if (liveRef.current === lv) {
        liveRef.current = null;
        setState('off');
      }
    };
    try {
      await lv.start(lang);
    } catch (e) {
      lv.stop();
      liveRef.current = null;
      setDetail(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }, []);

  useEffect(() => () => {
    liveRef.current?.stop();
    liveRef.current = null;
  }, []);

  return { state, transcript, detail, start, stop };
}
