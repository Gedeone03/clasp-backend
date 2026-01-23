// src/i18n/index.ts
import it from "./it";
import en from "./en";

export type Lang = "it" | "en";

export const dictionaries: Record<Lang, Record<string, string>> = {
  it,
  en,
};
