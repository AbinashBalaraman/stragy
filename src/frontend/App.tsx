import { useCallback, useEffect, useRef, useState } from 'react';
import { LangProvider, useLang } from './lang';
import { opencode, type SessionInfo } from './opencode/client';
import { EventBridge } from './opencode/events';
import { stragy, type CacheStats, type Health } from './stragy/client';
import { AppShell, type Screen } from './shell/AppShell';
import { ChatScreen } from './screens/ChatScreen';
import { MarketScannerScreen } from './screens/MarketScannerScreen';
import type { Option } from './screens/types';

const DEFAULT_MODEL = 'opencode-go/hy4-flash-free';

function AppInner() {
  const { lang, setLang } = useLang();
  const [screen, setScreen] = useState<Screen>('chat');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSession, setActiveSession] = useState<SessionInfo | null>(null);
  const [cache, setCache] = useState<CacheStats | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [models, setModels] = useState<Option[]>([{ value: DEFAULT_MODEL, label: DEFAULT_MODEL }]);
  const [agents, setAgents] = useState<Option[]>([{ value: 'stragy', label: 'stragy' }]);
  const [commands, setCommands] = useState<Option[]>([]);
  const [connected, setConnected] = useState(false);
  const [events] = useState(() => new EventBridge());
  const [toast, setToast] = useState('');

  const toastTimer = useRef<number | undefined>(undefined);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 3200);
  }, []);

  const loadSessions = useCallback(async () => {
    try { setSessions(await opencode.listSessions()); } catch { setConnected(false); }
  }, []);

  useEffect(() => {
    events.start();
    return () => events.stop();
  }, [events]);

  useEffect(() => {
    opencode.info().then(() => setConnected(true)).catch(() => setConnected(false));
    void loadSessions();
    Promise.all([
      stragy.cache().then(setCache).catch(() => {}),
      stragy.health().then(setHealth).catch(() => {}),
    ]);
    opencode.listModels().then((m) => {
      if (m?.length) setModels(m.map((x) => ({ value: `${x.providerID}/${x.id}`, label: `${x.providerID}/${x.id}` })));
    }).catch(() => {});
    opencode.listAgents().then((a) => {
      const usable = (a || []).filter((x) => !x.hidden && !['compaction', 'title', 'summary'].includes(String(x.name).toLowerCase()));
      if (usable.length) setAgents(usable.map((x) => ({ value: x.name, label: x.name })));
    }).catch(() => {});
    opencode.listCommands().then((c) => {
      setCommands((c || []).filter((x) => ['scan', 'check', 'cache'].includes(x.name)).map((x) => ({ value: x.name, label: x.name })));
    }).catch(() => {});
  }, [loadSessions]);

  const openSession = (id: string) => {
    setActiveSession(sessions.find((s) => s.id === id) || null);
    setScreen('chat');
  };

  const newChat = () => {
    // Do NOT create a server session here: empty "Untitled research" sessions
    // piled up (50+ observed live). The first sent message creates the session.
    setActiveSession(null);
    setScreen('chat');
  };

  const deleteSession = async (id: string) => {
    try {
      await opencode.deleteSession(id);
      if (activeSession?.id === id) setActiveSession(null);
      await loadSessions();
    } catch (e) {
      notify(String(e));
    }
  };

  return (
    <>
      <AppShell screen={screen} onNavigate={setScreen} cache={cache} mode={health?.mode || 'real'} connected={connected}>
        {screen === 'chat' && (
          <ChatScreen
            session={activeSession}
            sessions={sessions}
            onSessionCreated={(created) => {
              setActiveSession(created);
              setSessions((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
              void loadSessions();
            }}
            onNewChat={() => void newChat()}
            onOpenSession={openSession}
            onDeleteSession={(id) => void deleteSession(id)}
            models={models}
            agents={agents}
            commands={commands}
            lang={lang}
            onLangChange={(next) => setLang(next, activeSession?.id)}
            events={events}
          />
        )}
        {screen === 'scanner' && <MarketScannerScreen cache={cache} />}
      </AppShell>
      {toast && <div className="toast" role="status" data-testid="toast">{toast}</div>}
    </>
  );
}

export default function App() {
  return <LangProvider><AppInner /></LangProvider>;
}
