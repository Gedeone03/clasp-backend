// src/utils/mood.ts
import { useI18n } from "../LanguageContext";

export function useMoodLabel() {
  const { t } = useI18n();

  const tMood = (mood?: string | null): string => {
    if (!mood) return "";
    return t(`mood_${mood}`);
  };

  return { tMood };
}
