import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/ui/Sidebar";
import { API_BASE_URL } from "../config";
import { useAuth } from "../AuthContext";
import { useI18n } from "../LanguageContext";
// ===== iPhone avatar fix (HEIC/HEIF + filename senza estensione) =====
function extFromImageType(mime: string): string {
  const t = String(mime || "").toLowerCase().split(";")[0].trim();
  if (t === "image/jpeg" || t === "image/jpg") return ".jpg";
  if (t === "image/png") return ".png";
  if (t === "image/webp") return ".webp";
  if (t === "image/gif") return ".gif";
  // fallback sicuro
  return ".jpg";
}

async function normalizeImageForUpload(input: File): Promise<File> {
  const origName = String((input as any)?.name || "image");
  const origType = String((input as any)?.type || "").toLowerCase().split(";")[0].trim();

  const hasExt = /\.[a-z0-9]{2,5}$/i.test(origName);
  const isHeic =
    origType === "image/heic" ||
    origType === "image/heif" ||
    /\.(heic|heif)$/i.test(origName);

  // 1) HEIC/HEIF -> JPEG (così si vede anche su Chrome/Windows/Android)
  if (isHeic) {
    const heic2any = (await import("heic2any")).default as any;

    const out = await heic2any({
      blob: input,
      toType: "image/jpeg",
      quality: 0.85,
    });

    const blob: Blob = Array.isArray(out) ? out[0] : out;
    const safeName = (origName && origName !== "image")
      ? origName.replace(/\.(heic|heif)$/i, ".jpg")
      : "avatar.jpg";

    return new File([blob], safeName, { type: "image/jpeg" });
  }

  // 2) Se manca estensione, aggiungila (importante: Express static + nosniff)
  if (!hasExt) {
    const ext = extFromImageType(origType || "image/jpeg");
    const safeName = `${origName}${ext}`;
    // Se type è vuoto, forziamo jpeg così Multer non lo vede come octet-stream
    const safeType = origType || "image/jpeg";
    return new File([input], safeName, { type: safeType });
  }

  // 3) Se type è vuoto (succede), forziamo almeno jpeg mantenendo il nome
  if (!origType) {
    return new File([input], origName, { type: "image/jpeg" });
  }

  return input;
}

type StateKey = "DISPONIBILE" | "OCCUPATO" | "ASSENTE" | "OFFLINE" | "INVISIBILE" | "VISIBILE_A_TUTTI" | "";
type MoodKey = "FELICE" | "TRISTE" | "RILASSATO" | "ANSIOSO" | "ENTUSIASTA" | "ARRABBIATO" | "SOLO" | "";

function normalizeToken(raw: string | null | undefined): string {
  let t = String(raw || "").trim();
  if (!t) return "";
  if (t.toLowerCase().startsWith("bearer ")) t = t.slice(7).trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) t = t.slice(1, -1).trim();
  return t;
}

function getToken(): string {
  return normalizeToken(localStorage.getItem("token") || localStorage.getItem("authToken") || localStorage.getItem("accessToken") || "");
}

function baseUrl(): string {
  return (API_BASE_URL || "").replace(/\/+$/, "");
}

function resolveUrl(url?: string | null) {
  if (!url) return "";
  let t = String(url).trim();
  if (!t) return "";
  if (t.startsWith("/")) t = `${baseUrl()}${t}`;
  if (typeof window !== "undefined" && window.location.protocol === "https:" && t.startsWith("http://")) {
    t = t.replace(/^http:\/\//i, "https://");
  }
  return t;
}

function useIsMobile(bp = 900) {
  const [m, setM] = useState(() => (typeof window !== "undefined" ? window.innerWidth < bp : false));
  useEffect(() => {
    const onR = () => setM(window.innerWidth < bp);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, [bp]);
  return m;
}

async function apiFetch(path: string, init?: RequestInit) {
  const token = getToken();
  const headers: any = { ...(init?.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl()}${path}`, { ...init, headers });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res;
}

export default function ProfilePage(props: any) {
  const nav = useNavigate();
  const isMobile = useIsMobile(900);
  const { t } = useI18n();

  const auth = useAuth() as any;
  const user = auth.user as any;

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [statusText, setStatusText] = useState("");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [state, setState] = useState<StateKey>("");
  const [mood, setMood] = useState<MoodKey>("");

  const avatarUrl = useMemo(() => resolveUrl(user?.avatarUrl), [user?.avatarUrl]);

  const STATE_OPTIONS: { value: StateKey; label: string }[] = useMemo(
    () => [
      { value: "", label: "—" },
      { value: "DISPONIBILE", label: t("state_DISPONIBILE") },
      { value: "OCCUPATO", label: t("state_OCCUPATO") },
      { value: "ASSENTE", label: t("state_ASSENTE") },
      { value: "OFFLINE", label: t("state_OFFLINE") },
      { value: "INVISIBILE", label: t("state_INVISIBILE") },
      { value: "VISIBILE_A_TUTTI", label: t("state_VISIBILE_A_TUTTI") },
    ],
    [t]
  );

  const MOOD_OPTIONS: { value: MoodKey; label: string }[] = useMemo(
    () => [
      { value: "", label: t("profileMoodNone") },
      { value: "FELICE", label: t("mood_FELICE") },
      { value: "TRISTE", label: t("mood_TRISTE") },
      { value: "RILASSATO", label: t("mood_RILASSATO") },
      { value: "ANSIOSO", label: t("mood_ANSIOSO") },
      { value: "ENTUSIASTA", label: t("mood_ENTUSIASTA") },
      { value: "ARRABBIATO", label: t("mood_ARRABBIATO") },
      { value: "SOLO", label: t("mood_SOLO") },
    ],
    [t]
  );

  function applyUserToForm(u: any) {
    setDisplayName(u?.displayName || "");
    setStatusText(u?.statusText || "");
    setCity(u?.city || "");
    setArea(u?.area || "");
    setState((u?.state as StateKey) || "");
    setMood((u?.mood as MoodKey) || "");
  }

  function updateAuthUser(nextUser: any) {
    try {
      auth.setUser?.(nextUser);
    } catch {}
    try {
      auth.updateUser?.(nextUser);
    } catch {}
    try {
      localStorage.setItem("user", JSON.stringify(nextUser));
    } catch {}
  }

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setMsg(t("profileNotAuthenticated"));
      return;
    }

    let alive = true;
    (async () => {
      try {
        const res = await apiFetch("/me");
        const me = await res.json();
        if (!alive) return;
        updateAuthUser(me);
        applyUserToForm(me);
      } catch (e: any) {
        if (!alive) return;
        setMsg(t("profileLoadError", { error: String(e?.message || "") }));
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  async function onSave() {
    setMsg(null);
    setBusy(true);
    try {
      const body: any = {
        displayName: displayName.trim(),
        statusText: statusText.trim() || null,
        city: city.trim() || null,
        area: area.trim() || null,
        state: state || "OFFLINE",
        mood: mood || null,
      };

      const res = await apiFetch("/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const updated = await res.json();
      updateAuthUser(updated);
      applyUserToForm(updated);
      setMsg(t("profileSavedOk"));
    } catch (e: any) {
      setMsg(t("profileSaveError", { error: String(e?.message || "") }));
    } finally {
      setBusy(false);
    }
  }

  async function onUploadAvatar(file: File) {
    setMsg(null);
    setBusy(true);
    try {
      const fixed = await normalizeImageForUpload(file);
      const fd = new FormData();
      fd.append("avatar", fixed, fixed.name);


      const token = getToken();
      const res = await fetch(`${baseUrl()}/upload/avatar`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `HTTP ${res.status}`);
      }

      const data = await res.json().catch(() => ({}));
      const nextUser = data?.user ? data.user : { ...(user || {}), avatarUrl: data?.avatarUrl || user?.avatarUrl };
      updateAuthUser(nextUser);
      applyUserToForm(nextUser);
      setMsg(t("profileAvatarUpdated"));
    } catch (e: any) {
      setMsg(t("profileAvatarUploadError", { error: String(e?.message || "") }));
    } finally {
      setBusy(false);
    }
  }

  const card: React.CSSProperties = {
    maxWidth: 820,
    margin: "0 auto",
    background: "var(--tiko-bg-card)",
    border: "1px solid #222",
    borderRadius: 18,
    padding: 14,
  };

  const input: React.CSSProperties = {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid #2a2a2a",
    background: "var(--tiko-bg-dark)",
    color: "var(--tiko-text)",
    outline: "none",
    fontSize: 14,
  };

  const row: React.CSSProperties = { display: "flex", gap: 12, flexWrap: "wrap" };

  const btn: React.CSSProperties = {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid #2a2a2a",
    background: "#7A29FF",
    color: "#fff",
    fontWeight: 950,
    cursor: "pointer",
  };

  // Mobile = dedicated fullscreen overlay
  const pageWrap: React.CSSProperties = isMobile
    ? { position: "fixed", inset: 0, zIndex: 999, background: "var(--tiko-bg-dark)", display: "flex", flexDirection: "column" }
    : { height: "100vh", display: "flex", overflow: "hidden", background: "var(--tiko-bg-dark)" };

  return (
    <div style={pageWrap}>
      {!isMobile && <Sidebar />}

      {isMobile && (
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid #222",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--tiko-bg-card)",
          }}
        >
          <button
            type="button"
            onClick={() => {
              if (typeof props?.onBack === "function") props.onBack();
              else nav(-1);
            }}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #2a2a2a",
              background: "var(--tiko-bg-dark)",
              color: "var(--tiko-text)",
              fontWeight: 950,
            }}
          >
            ← {t("genericBack")}
          </button>
          <div style={{ fontWeight: 950 }}>{t("profileTitle")}</div>
          <div style={{ width: 90 }} />
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
        <div style={card}>
          <h2 style={{ margin: "0 0 10px 0" }}>{t("profileTitle")}</h2>

          {msg && (
            <div
              style={{
                marginBottom: 12,
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #2a2a2a",
                background: "rgba(58,190,255,0.08)",
                color: "var(--tiko-text)",
                fontWeight: 850,
              }}
            >
              {msg}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{ width: 74, height: 74, borderRadius: 999, border: "1px solid #333", overflow: "hidden", background: "#1f1f26" }}>
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 950 }}>—</div>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontWeight: 900, color: "var(--tiko-text-dim)" }}>
                @{user?.username || "—"} • {user?.email || ""}
              </div>

              <label style={{ fontSize: 13, color: "var(--tiko-text-dim)", fontWeight: 900 }}>
                {t("profileChangePhoto")}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUploadAvatar(f);
                    e.currentTarget.value = "";
                  }}
                  style={{ display: "block", marginTop: 6 }}
                />
              </label>
            </div>
          </div>

          <div style={row}>
            <div style={{ flex: "1 1 320px" }}>
              <label style={{ fontSize: 12, color: "var(--tiko-text-dim)", fontWeight: 900 }}>{t("profileName")}</label>
              <input style={input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div style={{ flex: "1 1 320px" }}>
              <label style={{ fontSize: 12, color: "var(--tiko-text-dim)", fontWeight: 900 }}>{t("profileStatusText")}</label>
              <input style={input} value={statusText} onChange={(e) => setStatusText(e.target.value)} placeholder={t("profileStatusTextPh")} />
            </div>
          </div>

          <div style={{ height: 10 }} />

          <div style={row}>
            <div style={{ flex: "1 1 220px" }}>
              <label style={{ fontSize: 12, color: "var(--tiko-text-dim)", fontWeight: 900 }}>{t("profileStatus")}</label>
              <select style={input as any} value={state} onChange={(e) => setState(e.target.value as StateKey)}>
                {STATE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ flex: "1 1 220px" }}>
              <label style={{ fontSize: 12, color: "var(--tiko-text-dim)", fontWeight: 900 }}>{t("profileMood")}</label>
              <select style={input as any} value={mood} onChange={(e) => setMood(e.target.value as MoodKey)}>
                {MOOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ flex: "1 1 220px" }}>
              <label style={{ fontSize: 12, color: "var(--tiko-text-dim)", fontWeight: 900 }}>{t("profileCity")}</label>
              <input style={input} value={city} onChange={(e) => setCity(e.target.value)} />
            </div>

            <div style={{ flex: "1 1 220px" }}>
              <label style={{ fontSize: 12, color: "var(--tiko-text-dim)", fontWeight: 900 }}>{t("profileArea")}</label>
              <input style={input} value={area} onChange={(e) => setArea(e.target.value)} />
            </div>
          </div>

          <div style={{ height: 14 }} />

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" onClick={onSave} style={{ ...btn, opacity: busy ? 0.7 : 1 }} disabled={busy}>
              {busy ? t("profileSaving") : t("profileSave")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
