import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { useI18n } from "../LanguageContext";
import { API_BASE_URL } from "../config";

type Mode = "login" | "register" | "forgot" | "reset";

function apiBase() {
  return String(API_BASE_URL || "").replace(/\/+$/, "");
}

async function readErrText(res: Response) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    const j = await res.json().catch(() => null);
    const msg = (j as any)?.error || (j as any)?.message;
    return msg ? String(msg) : JSON.stringify(j);
  }
  return await res.text().catch(() => "");
}

async function postJson(path: string, body: any) {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // ✅ fondamentale: JSON.stringify, altrimenti al server arriva "{email:...}" e va in errore
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error((await readErrText(res)) || `HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}

export default function AuthPage() {
  const nav = useNavigate();
  const location = useLocation();
  const auth = useAuth() as any;
  const { t } = useI18n();

  const tr = (key: string, fallback: string) => {
    const out = t(key);
    return out === key ? fallback : out;
  };

  const [mode, setMode] = useState<Mode>("login");

  // login/register
  const [emailOrUsername, setEmailOrUsername] = useState("");
  const [password, setPassword] = useState("");

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);

  // forgot/reset
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // occhio password
  const [showPwdLogin, setShowPwdLogin] = useState(false);
  const [showPwdRegister, setShowPwdRegister] = useState(false);
  const [showPwdReset1, setShowPwdReset1] = useState(false);
  const [showPwdReset2, setShowPwdReset2] = useState(false);

  // Se arrivi da link email: /auth?reset=TOKEN
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tok = String(params.get("reset") || "").trim();
    if (tok) {
      setResetToken(tok);
      setMode("reset");
      setError(null);
      setInfo(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const title = useMemo(() => {
    if (mode === "login") return t("authLoginTab");
    if (mode === "register") return t("authCreateAccount");
    if (mode === "forgot") return tr("authForgotPasswordTitle", "Recupera password");
    return tr("authResetPasswordTitle", "Imposta nuova password");
  }, [mode, t]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (busy) return;

    try {
      setBusy(true);

      if (mode === "login") {
        if (!emailOrUsername.trim() || !password) {
          setError(t("authRequiredLogin"));
          return;
        }

        await auth.login(emailOrUsername.trim(), password);
        nav("/", { replace: true });
        return;
      }

      if (mode === "register") {
        if (!email.trim() || !username.trim() || !displayName.trim() || !password) {
          setError(t("authRequiredRegister"));
          return;
        }

        if (!termsAccepted) {
          setError(t("authNeedAcceptTerms"));
          return;
        }

        await auth.register({
          email: email.trim(),
          username: username.trim(),
          displayName: displayName.trim(),
          password,
          city: city.trim() || null,
          area: area.trim() || null,
          termsAccepted: true,
        });

        nav("/", { replace: true });
        return;
      }

      if (mode === "forgot") {
        const em = forgotEmail.trim();
        if (!em) {
          setError(tr("authEmailRequired", "Inserisci la tua email."));
          return;
        }

        await postJson("/auth/password-reset/request", { email: em });

        // privacy-safe: non diciamo se esiste o no
        setInfo(tr("authForgotPasswordSent", "Se l’email esiste, ti abbiamo inviato un link per reimpostare la password."));
        return;
      }

      if (mode === "reset") {
        const tok = resetToken.trim();
        if (!tok) {
          setError(tr("authResetTokenRequired", "Token mancante: apri il link ricevuto via email."));
          return;
        }
        if (!newPassword || newPassword.length < 6) {
          setError(tr("authPasswordTooShort", "La password deve avere almeno 6 caratteri."));
          return;
        }
        if (newPassword !== newPassword2) {
          setError(tr("authPasswordMismatch", "Le password non coincidono."));
          return;
        }

        await postJson("/auth/password-reset/confirm", { token: tok, newPassword });

        setInfo(tr("authResetOk", "Password aggiornata. Ora puoi fare login."));
        setNewPassword("");
        setNewPassword2("");
        setPassword("");
        setMode("login");
        nav("/auth", { replace: true });
        return;
      }
    } catch (e2: any) {
      const msg = e2?.response?.data?.error || e2?.message || t("authError");
      setError(String(msg));
    } finally {
      setBusy(false);
    }
  }

  const card: React.CSSProperties = {
    width: "min(520px, 92vw)",
    background: "var(--tiko-bg-card)",
    border: "1px solid #222",
    borderRadius: 18,
    padding: 16,
    boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
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

  const btn: React.CSSProperties = {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid #2a2a2a",
    background: "#7A29FF",
    color: "#fff",
    fontWeight: 950,
    cursor: "pointer",
  };

  const tabBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "10px 10px",
    borderRadius: 12,
    border: "1px solid #2a2a2a",
    background: active ? "var(--tiko-bg-dark)" : "transparent",
    color: "var(--tiko-text)",
    fontWeight: 950,
    cursor: "pointer",
  });

  const pwdWrap: React.CSSProperties = { position: "relative", width: "100%" };
  const eyeBtn: React.CSSProperties = {
    position: "absolute",
    right: 8,
    top: "50%",
    transform: "translateY(-50%)",
    width: 42,
    height: 42,
    borderRadius: 12,
    border: "1px solid #2a2a2a",
    background: "transparent",
    color: "var(--tiko-text)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    fontWeight: 950,
  };

  const linkBtn: React.CSSProperties = {
    background: "transparent",
    border: "none",
    padding: 0,
    margin: 0,
    color: "var(--tiko-blue)",
    fontWeight: 900,
    cursor: "pointer",
    textAlign: "left",
  };

  const loginTabActive = mode === "login" || mode === "forgot" || mode === "reset";

  return (
    <div style={{ minHeight: "100vh", background: "var(--tiko-bg-dark)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={card}>
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <button
            type="button"
            style={tabBtn(loginTabActive)}
            onClick={() => {
              setMode("login");
              setError(null);
              setInfo(null);
            }}
          >
            {t("authLoginTab")}
          </button>
          <button
            type="button"
            style={tabBtn(mode === "register")}
            onClick={() => {
              setMode("register");
              setError(null);
              setInfo(null);
            }}
          >
            {t("authRegisterTab")}
          </button>
        </div>

        <h2 style={{ margin: "0 0 10px 0", color: "var(--tiko-text)" }}>{title}</h2>

        {error && (
          <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 12, border: "1px solid #3a1f1f", background: "rgba(255,59,48,0.08)", color: "#ff6b6b", fontWeight: 850 }}>
            {error}
          </div>
        )}

        {info && (
          <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 12, border: "1px solid #1f3a2a", background: "rgba(29,226,177,0.08)", color: "var(--tiko-text)", fontWeight: 850 }}>
            {info}
          </div>
        )}

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* LOGIN */}
          {mode === "login" ? (
            <>
              <input
                style={input}
                value={emailOrUsername}
                onChange={(e) => setEmailOrUsername(e.target.value)}
                placeholder={t("authEmailOrUsername")}
                autoComplete="username"
              />

              <div style={pwdWrap}>
                <input
                  style={{ ...input, paddingRight: 56 }}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("authPassword")}
                  type={showPwdLogin ? "text" : "password"}
                  autoComplete="current-password"
                />
                <button type="button" style={eyeBtn} onClick={() => setShowPwdLogin((s) => !s)} aria-label="Mostra/Nascondi password" title="Mostra/Nascondi password">
                  {showPwdLogin ? "🙈" : "👁️"}
                </button>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  style={linkBtn}
                  onClick={() => {
                    setMode("forgot");
                    setError(null);
                    setInfo(null);
                    setForgotEmail(emailOrUsername.includes("@") ? emailOrUsername : "");
                  }}
                >
                  {tr("authForgotPassword", "Recupera password")}
                </button>
              </div>
            </>
          ) : null}

          {/* FORGOT */}
          {mode === "forgot" ? (
            <>
              <div style={{ color: "var(--tiko-text-dim)", fontSize: 13 }}>
                {tr("authForgotPasswordDesc", "Inserisci la tua email e ti invieremo un link per reimpostare la password.")}
              </div>

              <input
                style={input}
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder={t("authEmail")}
                autoComplete="email"
              />

              <button type="button" style={linkBtn} onClick={() => { setMode("login"); setError(null); setInfo(null); }}>
                {tr("authBackToLogin", "Torna al login")}
              </button>
            </>
          ) : null}

          {/* RESET */}
          {mode === "reset" ? (
            <>
              <div style={{ color: "var(--tiko-text-dim)", fontSize: 13 }}>
                {tr("authResetPasswordDesc", "Inserisci la nuova password e confermala.")}
              </div>

              <input
                style={input}
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                placeholder={tr("authResetTokenPlaceholder", "Token di reset")}
                autoComplete="off"
              />

              <div style={pwdWrap}>
                <input
                  style={{ ...input, paddingRight: 56 }}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={tr("authNewPassword", "Nuova password")}
                  type={showPwdReset1 ? "text" : "password"}
                  autoComplete="new-password"
                />
                <button type="button" style={eyeBtn} onClick={() => setShowPwdReset1((s) => !s)} aria-label="Mostra/Nascondi password" title="Mostra/Nascondi password">
                  {showPwdReset1 ? "🙈" : "👁️"}
                </button>
              </div>

              <div style={pwdWrap}>
                <input
                  style={{ ...input, paddingRight: 56 }}
                  value={newPassword2}
                  onChange={(e) => setNewPassword2(e.target.value)}
                  placeholder={tr("authConfirmPassword", "Conferma password")}
                  type={showPwdReset2 ? "text" : "password"}
                  autoComplete="new-password"
                />
                <button type="button" style={eyeBtn} onClick={() => setShowPwdReset2((s) => !s)} aria-label="Mostra/Nascondi password" title="Mostra/Nascondi password">
                  {showPwdReset2 ? "🙈" : "👁️"}
                </button>
              </div>

              <button type="button" style={linkBtn} onClick={() => { setMode("login"); setError(null); setInfo(null); nav("/auth", { replace: true }); }}>
                {tr("authBackToLogin", "Torna al login")}
              </button>
            </>
          ) : null}

          {/* REGISTER */}
          {mode === "register" ? (
            <>
              <input style={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("authEmail")} autoComplete="email" />
              <input style={input} value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t("authUsername")} autoComplete="username" />
              <input style={input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t("authDisplayNamePlaceholder")} />

              <div style={{ display: "flex", gap: 10 }}>
                <input style={input} value={city} onChange={(e) => setCity(e.target.value)} placeholder={t("authCityOptional")} />
                <input style={input} value={area} onChange={(e) => setArea(e.target.value)} placeholder={t("authAreaOptional")} />
              </div>

              <div style={pwdWrap}>
                <input
                  style={{ ...input, paddingRight: 56 }}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("authPassword")}
                  type={showPwdRegister ? "text" : "password"}
                  autoComplete="new-password"
                />
                <button type="button" style={eyeBtn} onClick={() => setShowPwdRegister((s) => !s)} aria-label="Mostra/Nascondi password" title="Mostra/Nascondi password">
                  {showPwdRegister ? "🙈" : "👁️"}
                </button>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--tiko-text-dim)" }}>
                <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
                <span>
                  {t("authAcceptPrefix")}
                  <Link to="/terms" style={{ color: "#3ABEFF", fontWeight: 900 }}>
                    {t("navTerms")}
                  </Link>{" "}
                  {t("genericAnd")}{" "}
                  <Link to="/privacy" style={{ color: "#3ABEFF", fontWeight: 900 }}>
                    {t("navPrivacy")}
                  </Link>
                  .
                </span>
              </label>
            </>
          ) : null}

          <button type="submit" style={{ ...btn, opacity: busy ? 0.7 : 1 }} disabled={busy}>
            {busy
              ? t("genericPleaseWait")
              : mode === "login"
              ? t("authLoginTab")
              : mode === "register"
              ? t("authRegisterTab")
              : mode === "forgot"
              ? tr("authForgotPasswordSend", "Invia email")
              : tr("authResetPasswordButton", "Salva password")}
          </button>
        </form>

        {/* ✅ Qui abbiamo RIMOSSO la scritta sotto al login: non renderizziamo più t("authLoginHint") */}
      </div>
    </div>
  );
}
