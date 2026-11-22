import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, MessageSquarePlus, Search, Square, Trash2 } from 'lucide-react';
import { opencode, type Message, type ModelRef, type SessionInfo } from '../opencode/client';
import { EventBridge } from '../opencode/events';
import { deriveMessages, sortSessions, type ViewMessage } from '../opencode/sessionStore';
import { useLang, readSessionLang } from '../lang';
import { t, prefixedPrompt } from '../i18n';
import { Composer, type Attachment } from '../components/Composer';
import { ImageCard } from '../components/ImageCard';
import { Prose } from '../components/Prose';
import { AnswerCard } from '../components/AnswerCard';
import { useVoiceController } from '../voice/useVoiceController';
import { useLiveVoice } from '../voice/useLiveVoice';

type Option = { value: string; label: string };

const timeLabel = (value?: number): string =>
  value ? new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';

type Props = {
  session: SessionInfo | null;
  sessions: SessionInfo[];
  onSessionCreated: (session: SessionInfo) => void;
  onNewChat: () => void;
  onOpenSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  models: Option[];
  agents: Option[];
  commands: Option[];
  lang: 'en' | 'ta';
  onLangChange: (lang: 'en' | 'ta') => void;
  events: EventBridge | null;
  initialPrompt?: string | null;
  onInitialPromptConsumed?: () => void;
};

export function ChatScreen({
  session, sessions, onSessionCreated, onNewChat, onOpenSession, onDeleteSession,
  models, agents, commands, lang, onLangChange, events, initialPrompt, onInitialPromptConsumed,
}: Props) {
  const { setLang } = useLang();
  const [messages, setMessages] = useState<ReturnType<typeof deriveMessages>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedModel, setSelectedModel] = useState(models[0]?.value || '');
  const [selectedAgent, setSelectedAgent] = useState('stragy');
  const [selectedCommand, setSelectedCommand] = useState('');
  const [showJump, setShowJump] = useState(false);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const turnRef = useRef(0);
  const voiceTurnRef = useRef(false);
  const idleAtRef = useRef(0);
  const sessionRef = useRef<SessionInfo | null>(session);
  sessionRef.current = session;
  const busyRef = useRef(false);
  const loadSeq = useRef(0);
  const loadTimer = useRef<number | undefined>(undefined);
  const nearBottom = useRef(true);
  const langSessionRef = useRef<string | undefined>(undefined);
  const [streaming, setStreaming] = useState<{ id: string; text: string } | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [resolvedApprovals, setResolvedApprovals] = useState<Record<string, 'approved' | 'rejected'>>({});

  // Voice turn: the composer mic drives browser STT; the final transcript is
  // inserted and sent with the language prefix; the reply is spoken via TTS.
  const voice = useVoiceController(lang, {
    onFinalTranscript: (text) => { voiceTurnRef.current = true; setDraft(text); void send(text, []); },
  });
  const live = useLiveVoice();

  useEffect(() => {
    if (session?.model) setSelectedModel(`${session.model.providerID}/${session.model.id}`);
  }, [session?.id, session?.model?.id]);

  const loadFor = useCallback(async (id: string): Promise<ViewMessage[]> => {
    const seq = ++loadSeq.current;
    try {
      const raw = await opencode.getMessages(id);
      const list = deriveMessages(raw);
      const idle = raw.find((m) => m.type === 'idle' && typeof m.time?.created === 'number');
      if (idle?.time?.created) idleAtRef.current = Math.max(idleAtRef.current, idle.time.created);
      // A slower older fetch must never overwrite a newer transcript.
      if (seq === loadSeq.current) {
        setMessages(list);
        setError('');
      }
      return list;
    } catch (e) {
      if (seq === loadSeq.current) setError(String(e));
      return [];
    }
  }, []);

  const load = useCallback(async (): Promise<ViewMessage[]> => {
    if (!session) { setMessages([]); return []; }
    return loadFor(session.id);
  }, [session?.id, loadFor]);

  useEffect(() => { void load(); }, [load]);

  // SSE reconnect/resume: re-fetch authoritative messages; dedup is by message
  // and tool id, so a replayed event cannot create a duplicate tool card.
  // Text deltas stream into a live overlay and only schedule a throttled
  // re-fetch — one full GET per delta used to flood the gate on long answers.
  useEffect(() => {
    if (!events || !session) return;
    setStreaming(null);
    const scheduleLoad = () => {
      if (loadTimer.current !== undefined) return;
      loadTimer.current = window.setTimeout(() => {
        loadTimer.current = undefined;
        void load();
      }, 600);
    };
    const unsubscribe = events.subscribe((event) => {
      const data = event.data || {};
      const sid = String(data.sessionID || '');
      if (sid && sid !== session.id) return;
      if (event.type === 'session.text.delta') {
        const mid = String(data.assistantMessageID || '');
        const delta = typeof data.delta === 'string' ? data.delta : '';
        if (mid && delta) setStreaming((prev) => (prev && prev.id === mid ? { id: mid, text: prev.text + delta } : { id: mid, text: delta }));
        scheduleLoad();
        return;
      }
      if (event.type === 'session.resumed' || event.type === 'session.idle'
        || event.type === 'session.execution.succeeded' || event.type === 'session.execution.failed'
        || event.type.startsWith('session.tool.') || event.type.startsWith('session.text.')) {
        if (event.type === 'session.idle' || event.type.startsWith('session.execution.')) setStreaming(null);
        if (loadTimer.current !== undefined) { window.clearTimeout(loadTimer.current); loadTimer.current = undefined; }
        void load();
      }
    });
    return () => {
      unsubscribe();
      if (loadTimer.current !== undefined) { window.clearTimeout(loadTimer.current); loadTimer.current = undefined; }
    };
  }, [events, session?.id, load]);

  // Catch a final answer that lands after the prompt POST returns.
  useEffect(() => {
    if (busy || !session) return;
    void load();
  }, [busy, session?.id, load]);

  // Follow the conversation only while the reader is at the bottom; never
  // yank a scrolled-up reader back down. Follow streaming text, not just new
  // message rows.
  useEffect(() => {
    const el = logRef.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, streaming?.text.length]);

  useEffect(() => {
    if (!busy) setStreaming(null);
  }, [busy]);

  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottom.current = distance <= 160;
    setShowJump(distance > 160);
  };

  // Restore the reply language stored for this session when it is opened.
  useEffect(() => {
    if (!session?.id || langSessionRef.current === session.id) return;
    langSessionRef.current = session.id;
    const stored = readSessionLang(lang, session.id);
    if (stored !== lang) onLangChange(stored);
  }, [session?.id]);

  const handleLang = async (next: 'en' | 'ta') => {
    onLangChange(next);
    if (session) {
      setLang(next, session.id);
      try { await opencode.setLanguageInstruction(session.id, next); } catch { /* experimental, non-fatal */ }
    }
  };

  const send = async (text: string, attachments: Attachment[]) => {
    if (busyRef.current) return; // double-submit / voice race guard
    busyRef.current = true;
    const turn = ++turnRef.current;
    const spokenTurn = voiceTurnRef.current;
    voiceTurnRef.current = false;
    try {
      setError('');
      setDraft('');
      const body: { text: string; files?: Array<{ uri: string; source: { type: 'inline' }; name: string; description: string }> } = {
        text: prefixedPrompt(
          lang,
          spokenTurn
            ? `${text || 'Read this chart and describe what you see.'}\n\nThis is a spoken turn: answer in at most two short sentences.`
            : (text || 'Read this chart and describe what you see.'),
        ),
      };
      if (attachments.length) {
        body.files = attachments.map((a) => ({ uri: a.uri, source: { type: 'inline' }, name: a.name, description: 'User-attached chart image' }));
      }
      // Render the user's turn before any network wait. Creating the first
      // session can take seconds under load; the reader must not stare at an
      // empty screen in the meantime.
      const optimistic: ViewMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        text: text || 'Read this chart and describe what you see.',
        imageUris: attachments.map((a) => a.uri),
        tools: [],
        time: Date.now(),
      };
      setMessages((prev) => [...prev, optimistic]);
      setBusy(true);
      if (spokenTurn) voice.setState('thinking');

      let current = session;
      if (!current) {
        current = await opencode.createSession();
        // Select the created session immediately. Using the created object (not
        // a stale sessions lookup) is what makes a first message render.
        sessionRef.current = current;
        onSessionCreated(current);
      }
      // Apply a model chosen before the first message created the session.
      if (selectedModel) {
        const [providerID, ...rest] = selectedModel.split('/');
        const id = rest.join('/');
        const active = current.model ? `${current.model.providerID}/${current.model.id}` : '';
        if (providerID && id && selectedModel !== active) {
          try { await opencode.setModel(current.id, { providerID, id }); } catch { /* keep the session default */ }
        }
      }
      const turnStartedAt = Date.now();
      if (selectedCommand) await opencode.command(current.id, { name: selectedCommand, text: body.text, files: body.files || [] });
      else await opencode.prompt(current.id, body);
      if (turnRef.current !== turn) return;

      await loadFor(current.id);
      // OpenCode v2 returns from /prompt before the model answers. A turn is
      // finished only when the transcript contains an `idle` message created
      // after this prompt; tool calls produce interim assistant text, so
      // waiting on text alone ended multi-step scans after their first tool.
      const deadline = Date.now() + 300_000;
      let reply = '';
      while (Date.now() < deadline && turnRef.current === turn) {
        const list = await loadFor(current.id);
        const last = list.filter((m) => m.role === 'assistant').at(-1);
        if (last?.text) reply = last.text;
        if (idleAtRef.current >= turnStartedAt) break;
        // SSE deltas carry the live text; this loop is only the idle watchdog,
        // so it polls gently instead of flooding the gate with full GETs.
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (turnRef.current !== turn) return;
      const finalList = await loadFor(current.id);
      const finalReply = finalList.filter((m) => m.role === 'assistant').at(-1)?.text;
      if (finalReply) reply = finalReply;
      // A generated session title lands after creation; refresh the active
      // session so the header matches the sidebar chip.
      try {
        const fresh = await opencode.getSession(current.id);
        if (turnRef.current === turn) onSessionCreated(fresh);
      } catch { /* title refresh is cosmetic */ }
      if (reply && spokenTurn && voice.mode !== 'text') {
        voice.setLastReply(reply);
        if (!(await voice.speak(reply, lang))) voice.setState('idle');
      } else voice.setState('idle');
    } catch (e) {
      setError(String(e));
      if (spokenTurn) voice.setState('unavailable');
    } finally {
      if (turnRef.current === turn) { setBusy(false); busyRef.current = false; }
    }
  };

  // The approval card resolves the operator gate inline; an approval hands the
  // agent a follow-up turn so the backtest starts without retyping anything.
  const handleApprovalResolved = (approvalId: string, decision: 'approved' | 'rejected', followUp: string) => {
    setResolvedApprovals((prev) => ({ ...prev, [approvalId]: decision }));
    if (decision === 'approved' && followUp) void send(followUp, []);
  };

  useEffect(() => {
    if (!initialPrompt) return;
    setDraft(initialPrompt);
    onInitialPromptConsumed?.();
    void send(initialPrompt, []);
  }, [initialPrompt]);

  const stop = async () => {
    // Use the ref: on the very first turn the session prop may not have
    // re-rendered yet, and Stop must still interrupt the live session.
    const id = sessionRef.current?.id || session?.id;
    if (!id) return;
    turnRef.current++;
    busyRef.current = false;
    try { await opencode.interrupt(id); } catch { /* ignore */ }
    setBusy(false);
    setStreaming(null);
    voice.stopSpeaking();
    await load();
  };

  const setModel = async (value: string) => {
    setSelectedModel(value);
    if (!session) return;
    const [providerID, ...rest] = value.split('/');
    try { await opencode.setModel(session.id, { providerID, id: rest.join('/') }); } catch { /* ignore */ }
  };

  const ordered = sortSessions(sessions).filter((s) => (s.title || 'Untitled research').toLowerCase().includes(search.toLowerCase()));
  // Live streaming overlay: SSE deltas render token-by-token; the authoritative
  // transcript replaces them as soon as it catches up.
  const shown = streaming
    ? messages.map((m) => (m.id === streaming.id && streaming.text.length > m.text.length ? { ...m, text: streaming.text } : m))
    : messages;
  const provisional = streaming && busy && !messages.some((m) => m.id === streaming.id)
    ? { id: streaming.id, role: 'assistant' as const, text: streaming.text, imageUris: [] as string[], tools: [] as ViewMessage['tools'], time: Date.now() }
    : null;
  const sessionRow = (s: SessionInfo) => (
    <div key={s.id} className={`session-row ${s.id === session?.id ? 'active' : ''}`} data-testid="session-row" role="button" tabIndex={0} onClick={() => onOpenSession(s.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenSession(s.id); }}>
      <span className="session-row-title">{s.title || 'Untitled research'}</span>
      <span className="session-row-meta">{s.model?.id || '—'} · {s.time?.updated ? new Date(s.time.updated).toLocaleDateString('en-IN') : '—'}</span>
      <button
        type="button"
        className={`session-row-del ${armedDelete === s.id ? 'armed' : ''}`}
        aria-label={armedDelete === s.id ? t(lang, 'remove') : t(lang, 'deleteSession')}
        data-testid="delete-session"
        onClick={(e) => {
          e.stopPropagation();
          // Two-tap delete: one mis-tap must not destroy a research session.
          if (armedDelete === s.id) { setArmedDelete(null); onDeleteSession(s.id); }
          else {
            setArmedDelete(s.id);
            window.setTimeout(() => setArmedDelete((cur) => (cur === s.id ? null : cur)), 2600);
          }
        }}
      >{armedDelete === s.id ? t(lang, 'remove') : <Trash2 size={13} />}</button>
    </div>
  );

  return (
    <div className="screen active chat-screen-layout" data-testid="chat-screen">
      <aside className="session-panel" data-testid="session-panel">
        <div className="session-panel-head">
          <b>{t(lang, 'sessions')}</b>
          <button type="button" className="icon-btn" data-testid="new-chat-side" aria-label={t(lang, 'newSession')} onClick={onNewChat}><MessageSquarePlus /></button>
        </div>
        <label className="search"><Search size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} /><input data-testid="session-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t(lang, 'searchSessions')} /></label>
        <div className="session-list" data-testid="session-list">
          {ordered.map(sessionRow)}
          {!ordered.length && <div className="muted" style={{ padding: 12, fontSize: 'var(--fs-xs)' }}>{t(lang, 'noSessions')}</div>}
        </div>
      </aside>

      <div className="chat-main">
        <div className="session-strip" data-testid="session-strip">
          <button type="button" className="btn ghost" data-testid="new-chat-strip" onClick={onNewChat}><MessageSquarePlus size={13} /> {t(lang, 'newSession')}</button>
          {ordered.slice(0, 8).map((s) => (
            <button key={s.id} type="button" className={`chip ${s.id === session?.id ? 'tamil' : ''}`} onClick={() => onOpenSession(s.id)}>{s.title || 'Untitled research'}</button>
          ))}
        </div>

        <div className="chat-head">
          <div style={{ minWidth: 0 }}>
            <h1>{session?.title || 'New research chat'}</h1>
            <div className="sub">{session?.model ? `${session.model.providerID} / ${session.model.id}` : (selectedModel ? `default · ${selectedModel}` : 'Select a model to begin')}</div>
          </div>
          <div className="spacer" />
        </div>

        <div className="chat-log" ref={logRef} onScroll={onScroll} role="log" aria-busy={busy} data-testid="chat-log">
          <div className="col">
            {error && <div className="panel" style={{ padding: 14, marginBottom: 16, borderColor: 'var(--danger)' }}><span style={{ color: 'var(--danger)', fontSize: 'var(--fs-xs)' }}>{error}</span></div>}

            {shown.map((m) => (
              <div className={`msg ${m.role}`} key={m.id} data-testid={`message-${m.role}`}>
                {m.role === 'user' ? (
                  <>
                    <div className={`ububble ${lang === 'ta' ? 'ta-text' : ''}`} lang={lang}>{m.text}</div>
                    {m.imageUris.map((uri, i) => <ImageCard key={i} uri={uri} compact />)}
                    {m.imageUris.length > 0 && <div className="chip tamil" style={{ marginTop: 6, marginLeft: 'auto', width: 'fit-content' }}><span className="cdot" />{t(lang, 'imageSent')}</div>}
                    <div className="ts">{timeLabel(m.time)}</div>
                  </>
                ) : (
                  <AnswerCard
                    message={m}
                    sessionId={session?.id}
                    resolvedApprovals={resolvedApprovals}
                    onApprovalResolved={handleApprovalResolved}
                    onSend={(text) => { if (!busy) void send(text, []); }}
                    onRegenerate={() => {
                      if (busy) return;
                      const idx = shown.findIndex(item => item.id === m.id);
                      const previous = [...shown.slice(0, idx)].reverse().find(item => item.role === 'user');
                      if (previous) void send(previous.text, []);
                    }}
                    busy={busy}
                    lang={lang}
                    time={timeLabel(m.time)}
                  />
                )}
              </div>
            ))}

            {provisional && (
              <div className="msg assistant" data-testid="message-assistant-streaming">
                <div className="amark"><b>STRAGY</b><span className="ts">{t(lang, 'thinking')}</span></div>
                <Prose text={provisional.text} className={`aprose ${lang === 'ta' ? 'ta-text' : ''}`} lang={lang} testId="assistant-text" />
              </div>
            )}
            {busy && (
              <div className="msg assistant" data-testid="pending-indicator">
                <div className="amark"><b>STRAGY</b><span className="ts"><span className="spinner" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> {t(lang, 'thinking')}</span></div>
              </div>
            )}
            {!session && !messages.length && (
              <div className="empty"><div><h2>{t(lang, 'startThread')}</h2><p>{t(lang, 'welcomeLede')}</p></div></div>
            )}
          </div>
        </div>

        {showJump && <button className="jump" onClick={() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })}><ArrowDown size={13} /> Latest</button>}

        {live.state !== 'off' && (
          <div className={`voice-strip live ${live.state}`} data-testid="live-strip" aria-label="Live voice conversation">
            <span className={`chip ${live.state === 'speaking' ? 'running' : live.state === 'listening' ? 'ready' : live.state === 'error' ? 'failed' : 'queued'}`} data-testid="live-state">
              <span className="cdot" />{live.state}
            </span>
            <span className="voice-strip-text" data-testid="live-transcript">
              {live.transcript || live.detail || t(lang, 'liveHint')}
            </span>
            <button type="button" className="btn" data-testid="live-end" onClick={live.stop}>
              <Square size={12} /> {t(lang, 'endLive')}
            </button>
          </div>
        )}

        <Composer
          lang={lang}
          onLangChange={handleLang}
          busy={busy}
          models={models}
          agents={agents}
          commands={commands}
          selectedModel={selectedModel}
          selectedAgent={selectedAgent}
          selectedCommand={selectedCommand}
          onModelChange={setModel}
          onAgentChange={setSelectedAgent}
          onCommandChange={setSelectedCommand}
          onSend={send}
          onStop={stop}
          onVoice={() => void voice.toggle()}
          value={draft}
          onValueChange={setDraft}
          voice={voice}
          liveState={live.state}
          onLiveToggle={() => { if (live.state === 'off' || live.state === 'error') void live.start(lang); else live.stop(); }}
        />
      </div>
    </div>
  );
}
