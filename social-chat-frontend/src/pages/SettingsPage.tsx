import React, { useMemo, useState } from "react";
import Sidebar from "../components/ui/Sidebar";
import { unlockAudio, playNotificationBeep } from "../utils/notifySound";
import { useI18n } from "../LanguageContext";

function useIsMobile(breakpointPx = 1100) {
  const compute = () => {
    const coarse =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;

    const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
    const uaMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);

    return coarse || uaMobile || window.innerWidth < breakpointPx;
  };

  const [isMobile, setIsMobile] = useState(compute);

  React.useEffect(() => {
    const onResize = () => setIsMobile(compute());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return isMobile;
}

function readSoundEnabled(): boolean {
  const v = localStorage.getItem("clasp.soundEnabled");
  return v !== "false"; // default ON
}

type Lang = "it" | "en";

export default function SettingsPage() {
  const isMobile = useIsMobile(1100);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(readSoundEnabled());
  const [msg, setMsg] = useState<string | null>(null);

  const i18n = useI18n();
  const lang = (i18n.lang === "en" ? "en" : "it") as Lang;

  function applyLang(next: Lang) {
    // Persist (compat with older keys)
    try {
      localStorage.setItem("clasp.lang", next);
      localStorage.setItem("clasp_lang", next);
      localStorage.setItem("lang", next);
      localStorage.setItem("language", next);
    } catch {
      // ignore
    }

    const setFn = i18n.setLang || (i18n as any).setLanguage || (i18n as any).setLocale;
    if (typeof setFn === "function") setFn(next);
  }

  const toggleLang = () => applyLang(lang === "it" ? "en" : "it");

  const containerStyle: React.CSSProperties = useMemo(
    () => ({
      height: "100vh",
      display: "flex",
      flexDirection: isMobile ? "column" : "row",
      background: "var(--tiko-bg-dark)",
      overflow: "hidden",
    }),
    [isMobile]
  );

  const contentStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    padding: 16,
  };

  const cardStyle: React.CSSProperties = {
    background: "var(--tiko-bg-card)",
    border: "1px solid #222",
    borderRadius: 14,
    padding: 14,
  };

  const toggleSound = async () => {
    if (soundEnabled) {
      localStorage.setItem("clasp.soundEnabled", "false");
      setSoundEnabled(false);
      setMsg(i18n.t("settingsSoundDisabledMsg"));
      return;
    }

    // enable: user gesture required
    localStorage.setItem("clasp.soundEnabled", "true");
    const okUnlock = await unlockAudio();
    if (!okUnlock) {
      setSoundEnabled(true); // preference ON, but browser might block until next click
      setMsg(i18n.t("settingsSoundBlockedMsg"));
      return;
    }

    await playNotificationBeep();
    setSoundEnabled(true);
    setMsg(i18n.t("settingsSoundEnabledMsg"));
  };

  return (
    <div style={containerStyle}>
      <Sidebar />

      <div style={contentStyle}>
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <h1 style={{ margin: 0 }}>{i18n.t("settingsTitle")}</h1>
          <div style={{ color: "var(--tiko-text-dim)", fontSize: 13 }}>{i18n.t("settingsIntro")}</div>

          <div style={cardStyle}>
            <div style={{ fontWeight: 950, marginBottom: 8 }}>{i18n.t("settingsNotifications")}</div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 900 }}>{i18n.t("settingsMessageSoundTitle")}</div>
                <div style={{ fontSize: 12, color: "var(--tiko-text-dim)" }}>{i18n.t("settingsMessageSoundDesc")}</div>
              </div>

              <button
                type="button"
                onClick={toggleSound}
                style={{
                  borderRadius: 12,
                  padding: "10px 12px",
                  border: "1px solid #2a2a2a",
                  background: soundEnabled ? "#ff3b30" : "var(--tiko-mint)",
                  color: soundEnabled ? "#fff" : "#000",
                  fontWeight: 950,
                  cursor: "pointer",
                }}
              >
                {soundEnabled ? i18n.t("settingsSoundDisableBtn") : i18n.t("settingsSoundEnableBtn")}
              </button>
            </div>

            {msg && <div style={{ marginTop: 10, fontSize: 12, color: "var(--tiko-text-dim)" }}>{msg}</div>}
          </div>

          {/* ===== Language ===== */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 950, marginBottom: 8 }}>{i18n.t("settingsLanguageSection")}</div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 900 }}>{i18n.t("settingsAppLanguage")}</div>
                <div style={{ fontSize: 12, color: "var(--tiko-text-dim)" }}>
                  {i18n.t("settingsCurrentLang", { lang: lang === "it" ? "Italiano" : "English" })}
                </div>
              </div>

              <button
                type="button"
                onClick={toggleLang}
                style={{
                  borderRadius: 12,
                  padding: "10px 12px",
                  border: "1px solid #2a2a2a",
                  background: "var(--tiko-mint)",
                  color: "#000",
                  fontWeight: 950,
                  cursor: "pointer",
                }}
                aria-label={i18n.t("settingsChangeLanguageAria")}
              >
                {lang === "it" ? i18n.t("settingsSwitchToEn") : i18n.t("settingsSwitchToIt")}
              </button>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontWeight: 950, marginBottom: 8 }}>{i18n.t("settingsAppearance")}</div>
            <div style={{ fontSize: 12, color: "var(--tiko-text-dim)" }}>
              {i18n.t("settingsUpcoming")}
              <ul style={{ marginTop: 6 }}>
                <li>{i18n.t("settingsFeatureChatBackground")}</li>
                <li>{i18n.t("settingsFeatureTheme")}</li>
                <li>{i18n.t("settingsFeatureTextSize")}</li>
              </ul>
            </div>

            <button
              type="button"
              disabled
              style={{
                marginTop: 8,
                borderRadius: 12,
                padding: "10px 12px",
                border: "1px solid #2a2a2a",
                background: "#333",
                color: "#bbb",
                fontWeight: 900,
                cursor: "not-allowed",
              }}
              title={i18n.t("settingsComingSoon")}
            >
              {i18n.t("settingsChangeBackgroundSoon")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
