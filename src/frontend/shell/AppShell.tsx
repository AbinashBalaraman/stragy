import type { ReactNode } from 'react';
import { BarChart3, MessageSquare } from 'lucide-react';
import { useLang } from '../lang';
import { t } from '../i18n';
import type { Key } from '../i18n';
import type { CacheStats } from '../stragy/client';

export type Screen = 'chat' | 'scanner';

type Props = {
  screen: Screen;
  onNavigate: (screen: Screen) => void;
  cache: CacheStats | null;
  mode: string;
  connected: boolean;
  children: ReactNode;
};

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="5" stroke="var(--accent)" strokeWidth="1.5" />
      <path d="M5 16.5 9.5 10l3 3.5L19 6" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="19" cy="6" r="1.6" fill="var(--accent)" />
    </svg>
  );
}

const NAV: Array<{ id: Screen; icon: typeof MessageSquare; key: Key }> = [
  { id: 'chat', icon: MessageSquare, key: 'navChat' },
  { id: 'scanner', icon: BarChart3, key: 'navScanner' },
];

export function AppShell({ screen, onNavigate, cache, mode, connected, children }: Props) {
  const lang = useLang().lang;
  const lastEod = cache?.lastDate || '—';
  const symbolCount = cache?.symbols ?? 0;

  return (
    <div className="app" data-screen={screen}>
      <header className="ribbon">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">STRAGY<span>.</span></div>
            <div className="brand-sub">{t(lang, 'brandSub')}</div>
          </div>
        </div>
        <div className="rib-cache" aria-label="Cache coverage">
          <span className="rib-label">CACHE</span>
          <b className="tnum">{symbolCount} symbols · EOD {lastEod}</b>
        </div>
        <div className="rib-engine">
          <span className={`dot ${connected ? '' : 'muted'}`} />
          <span>{connected ? t(lang, 'connected') : t(lang, 'connecting')} · <b>{mode === 'real' ? t(lang, 'modeReal') : t(lang, 'modeDemo')}</b></span>
        </div>
      </header>

      <nav className="rail" aria-label="Main navigation">
        {NAV.map(({ id, icon: Icon, key }) => (
          <button key={id} type="button" className={`rail-item ${screen === id ? 'active' : ''}`} aria-current={screen === id ? 'page' : undefined} data-testid={`nav-${id}`} onClick={() => onNavigate(id)}>
            <Icon aria-hidden /> {t(lang, key)}
          </button>
        ))}
        <div className="rail-sep" />
        <div className="rail-foot">
          <b>Observed, not modeled</b>
          Research only. Nothing is saved or traded without an explicit action.
        </div>
      </nav>

      <main className="main">{children}</main>

      <nav className="mobile-nav" aria-label="Main navigation">
        {NAV.map(({ id, icon: Icon, key }) => (
          <button key={id} type="button" className={screen === id ? 'active' : ''} aria-current={screen === id ? 'page' : undefined} data-testid={`nav-${id}`} onClick={() => onNavigate(id)}>
            <Icon aria-hidden /> <span>{t(lang, key)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
