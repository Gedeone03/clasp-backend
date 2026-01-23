import React, { createContext, useContext, useMemo, useState, useCallback } from "react";

// Import robusto: funziona sia se en.ts/it.ts esportano default,
// sia se esportano una const (es. export const it = {...})
import * as itMod from "./i18n/it";
import * as enMod from "./i18n/en";

export type LanguageCode = "it" | "en";

export type I18nContextValue = {
  // API principale
  lang: LanguageCode;
  setLang: (l: LanguageCode) => void;

  // Alias compatibilità (se nel progetto usavi questi nomi)
  language: LanguageCode;
  setLanguage: (l: LanguageCode) => void;

  // traduzione
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const DEFAULT_LANG: LanguageCode = "it";
const STORAGE_KEY = "clasp.lang";

function pickDict(mod: any) {
  // Prova diverse forme comuni di export
  return mod?.default || mod?.it || mod?.en || mod?.translations || mod || {};
}

const DICTS: Record<LanguageCode, Record<string, string>> = {
  it: pickDict(itMod) as any,
  en: pickDict(enMod) as any,
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function readInitialLang(): LanguageCode {
  try {
    const a = (localStorage.getItem(STORAGE_KEY) || "").trim().toLowerCase();
    if (a === "it" || a === "en") return a;

    // fallback per vecchie chiavi se esistono
    const b = (localStorage.getItem("lang") || localStorage.getItem("language") || "").trim().toLowerCase();
    if (b === "it" || b === "en") return b;

    return DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

function formatTemplate(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<LanguageCode>(() => readInitialLang());

  const setLang = useCallback((l: LanguageCode) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = DICTS[lang] || DICTS[DEFAULT_LANG] || {};
      const fallback = DICTS[DEFAULT_LANG] || {};

      const template = dict[key] ?? fallback[key] ?? key;
      return formatTemplate(template, vars);
    },
    [lang]
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      language: lang, // alias
      setLanguage: setLang, // alias
      t,
    }),
    [lang, setLang, t]
  );

  // IMPORTANT: renderizza sempre children
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

// Hook SAFE: non deve più far diventare la pagina nera
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);

  // Se per qualche motivo il provider manca, NON crashare:
  if (!ctx) {
    return {
      lang: DEFAULT_LANG,
      setLang: () => {},
      language: DEFAULT_LANG,
      setLanguage: () => {},
      t: (key: string) => key,
    };
  }

  return ctx;
}
