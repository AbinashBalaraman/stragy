import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Lang } from './i18n';

const KEY = 'stragy.voice.language';
let activeLang: Lang = 'en';
export const currentLang = () => activeLang;

type LangContextValue = {
  lang: Lang;
  setLang: (lang: Lang, sessionId?: string) => void;
};

const LangContext = createContext<LangContextValue>({ lang: 'en', setLang: () => {} });

function read(lang: Lang, sessionId?: string): Lang {
  if (sessionId) {
    try {
      const v = localStorage.getItem(`${KEY}:${sessionId}`);
      if (v === 'en' || v === 'ta') return v;
    } catch { /* ignore */ }
  }
  return lang;
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try { return localStorage.getItem(KEY) === 'ta' ? 'ta' : 'en'; } catch { return 'en'; }
  });

  useEffect(() => {
    activeLang = lang;
    document.documentElement.lang = lang;
    document.documentElement.dataset.lang = lang;
  }, [lang]);

  const setLang = (next: Lang, sessionId?: string) => {
    setLangState(next);
    activeLang = next;
    try {
      localStorage.setItem(KEY, next);
      if (sessionId) localStorage.setItem(`${KEY}:${sessionId}`, next);
    } catch { /* ignore */ }
  };

  const value = useMemo(() => ({ lang, setLang }), [lang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  return useContext(LangContext);
}

export { read as readSessionLang };
