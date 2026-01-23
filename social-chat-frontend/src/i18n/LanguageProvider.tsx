import React, { createContext, useContext, useMemo, useState, useCallback } from "react";

export type LanguageCode = "it" | "en";

type I18nContextValue = {
  lang: LanguageCode;
  setLang: (l: LanguageCode) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const DEFAULT_LANG: LanguageCode = "it";
const STORAGE_KEY = "clasp.lang";

/**
 * Traduzioni minime: non serve coprire tutto subito.
 * Se manca una key, t(key) restituisce la key (così l'app NON crasha).
 */
const TRANSLATIONS: Record<LanguageCode, Record<string, string>> = {
  it: {
    "app.name": "Clasp",
    "settings.title": "Impostazioni",
    "settings.sound": "Suono messaggi",
    "settings.sound.on": "Disattiva suono",
    "settings.sound.off": "Attiva suono",
  },
  en: {
    "app.name": "Clasp",
    "settings.title": "Settings",
    "settings.sound": "Message sound",
    "settings.sound.on": "Disable sound",
    "settings.sound.off": "Enable sound",
  },
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function formatTemplate(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

function readInitialLang(): LanguageCode {
  try {
    const raw = (localStorage.getItem(STORAGE_KEY) || "").toLowerCase().trim();
    if (raw === "it" || raw === "en") return raw;
    return DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LanguageCode>(() => readInitialLang());

  const setLang = useCallback((l: LanguageCode) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignora se storage bloccato
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = TRANSLATIONS[lang] || TRANSLATIONS[DEFAULT_LANG];
      const fallbackDict = TRANSLATIONS[DEFAULT_LANG];
      const template = dict[key] ?? fallbackDict[key] ?? key;
      return formatTemplate(template, vars);
    },
    [lang]
  );

  const value = useMemo<I18nContextValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);

  // ✅ IMPORTANTISSIMO: renderizza SEMPRE children
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * ✅ Hook "safe": non deve mai far diventare l’app nera.
 * Se manca il provider per qualsiasi motivo, ritorna un fallback.
 */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;

  // fallback non-crash
  return {
    lang: DEFAULT_LANG,
    setLang: () => {},
    t: (key: string) => key,
  };
}
