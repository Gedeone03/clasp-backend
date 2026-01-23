// src/pages/MoodConnectPage.tsx

import React, { useMemo, useState } from "react";
import Sidebar from "../components/ui/Sidebar";
import { useAuth } from "../AuthContext";
import { searchUsers, createConversation, User } from "../api";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../LanguageContext";

const MoodConnectPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useI18n();

  const [loadingList, setLoadingList] = useState(false);
  const [loadingQuick, setLoadingQuick] = useState(false);
  const [results, setResults] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);

  const mood = user?.mood;

  const moodLabel = useMemo(() => {
    if (!mood) return "";
    const key = `mood_${mood}`;
    const tr = t(key);
    return tr === key ? String(mood) : tr;
  }, [mood, t]);

  const renderMoodLabel = (m?: string | null) => {
    if (!m) return "";
    const key = `mood_${m}`;
    const tr = t(key);
    return tr === key ? String(m) : tr;
  };

  if (!user) return <div>{t("profileNotAuthenticated")}</div>;

  const handleFindSameMood = async () => {
    setError(null);
    setResults([]);

    if (!mood) {
      setError(t("moodNoMood"));
      return;
    }

    try {
      setLoadingList(true);
      const list = await searchUsers("", false, mood);
      const filtered = list.filter((u) => u.id !== user.id);
      setResults(filtered);

      if (filtered.length === 0) {
        setError(t("moodNoPeople"));
      }
    } catch (e) {
      console.error(e);
      setError(t("moodErrorSearch"));
    } finally {
      setLoadingList(false);
    }
  };

  const handleQuickConnect = async () => {
    setError(null);

    if (!mood) {
      setError(t("moodNoMood"));
      return;
    }

    try {
      setLoadingQuick(true);
      const list = await searchUsers("", false, mood);
      const candidates = list.filter((u) => u.id !== user.id);

      if (candidates.length === 0) {
        setError(t("moodNoPeopleQuick"));
        return;
      }

      const randomIndex = Math.floor(Math.random() * candidates.length);
      const chosen = candidates[randomIndex];

      await createConversation(chosen.id);
      navigate("/");
    } catch (e) {
      console.error(e);
      setError(t("moodErrorQuick"));
    } finally {
      setLoadingQuick(false);
    }
  };

  return (
    <div className="tiko-layout">
      <Sidebar />

      <div className="tiko-content" style={{ padding: 24, overflowY: "auto" }}>
        <h1 className="tiko-title" style={{ marginBottom: 10 }}>
          {t("moodTitle")}
        </h1>

        {mood ? (
          <div style={{ marginBottom: 16, fontSize: 14, color: "var(--tiko-text-dim)" }}>
            {t("moodYourMood")} <strong>{moodLabel}</strong>.
          </div>
        ) : (
          <div style={{ marginBottom: 16, fontSize: 14, color: "var(--tiko-text-dim)" }}>
            {t("moodNoMood")}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button onClick={handleFindSameMood} disabled={loadingList || !mood} style={{ flex: 1 }}>
            {loadingList ? t("moodSearching") : t("moodFindPeople")}
          </button>

          <button onClick={handleQuickConnect} disabled={loadingQuick || !mood} style={{ flex: 1 }}>
            {loadingQuick ? t("moodConnecting") : t("moodQuickConnect")}
          </button>
        </div>

        {error && <div style={{ color: "red", marginBottom: 12 }}>{error}</div>}

        {results.length > 0 && (
          <div style={{ fontSize: 14 }}>
            <h2 style={{ marginBottom: 8 }}>{t("moodPeopleListTitle")}</h2>

            {results.map((u) => (
              <div
                key={u.id}
                style={{
                  marginBottom: 8,
                  padding: 8,
                  borderRadius: 8,
                  background: "var(--tiko-bg-card)",
                }}
              >
                <div style={{ fontSize: 13 }}>
                  <strong>{u.displayName || u.username || t("genericUser")}</strong>{" "}
                  <span style={{ color: "var(--tiko-text-dim)" }}>@{u.username}</span>
                </div>

                <div style={{ fontSize: 12, color: "var(--tiko-text-dim)" }}>
                  {u.mood && <>Mood: {renderMoodLabel(u.mood)}</>}
                  {u.interests.length > 0 && (
                    <>
                      {" "}• {t("profileInterests")}: {u.interests.join(", ")}
                    </>
                  )}
                </div>

                <button style={{ marginTop: 4, fontSize: 12 }} onClick={() => createConversation(u.id).then(() => navigate("/"))}>
                  {t("moodStartChat")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MoodConnectPage;
