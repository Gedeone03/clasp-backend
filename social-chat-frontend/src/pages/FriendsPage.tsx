import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/ui/Sidebar";
import { useI18n } from "../LanguageContext";
import { API_BASE_URL } from "../config";

type TabKey = "friends" | "received" | "sent";

function getToken(): string {
  return (
    localStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    localStorage.getItem("accessToken") ||
    localStorage.getItem("jwt") ||
    localStorage.getItem("clasp.token") ||
    localStorage.getItem("clasp.jwt") ||
    ""
  ).trim();
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function useIsMobile(bp = 1100) {
  const compute = () => {
    const coarse =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
    const uaMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
    return coarse || uaMobile || window.innerWidth < bp;
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

function resolveUrl(url?: string | null) {
  if (!url) return "";
  let t = String(url).trim();
  if (!t) return "";

  const isHttpsPage = typeof window !== "undefined" && window.location?.protocol === "https:";

  let base = String(API_BASE_URL || "").replace(/\/+$/, "");
  if (isHttpsPage && base.startsWith("http://")) {
    base = base.replace(/^http:\/\//i, "https://");
  }

  if (t.startsWith("/")) {
    t = `${base}${t}`;
  }

  if (isHttpsPage && t.startsWith("http://")) {
    t = t.replace(/^http:\/\//i, "https://");
  }

  return t;
}



async function apiGet(path: string) {
  const res = await fetch(`${API_BASE_URL.replace(/\/$/, "")}${path}`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  return res.json();
}

async function apiPost(path: string, body?: any) {
  const res = await fetch(`${API_BASE_URL.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : "{}",
  });
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  return res.json().catch(() => ({}));
}

export default function FriendsPage() {
  const nav = useNavigate();
  const { t } = useI18n();
  const isMobile = useIsMobile(1100);

  const tr = (key: string, fallback: string) => {
    const out = t(key);
    return out === key ? fallback : out;
  };

  const [tab, setTab] = useState<TabKey>("friends");
  const [friends, setFriends] = useState<any[]>([]);
  const [received, setReceived] = useState<any[]>([]);
  const [sent, setSent] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const containerStyle = useMemo<React.CSSProperties>(
    () => ({
      height: "var(--app-height, 100vh)",
      display: "flex",
      flexDirection: isMobile ? "column" : "row",
      background: "var(--tiko-bg-dark)",
      overflow: "hidden",
    }),
    [isMobile]
  );

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid #2a2a2a",
    background: active ? "var(--tiko-purple)" : "transparent",
    color: active ? "#fff" : "var(--tiko-text)",
    fontWeight: 950,
    cursor: "pointer",
  });

  async function loadAll() {
    setErr(null);
    setInfo(null);
    setBusy(true);
    try {
      const [f, r, s] = await Promise.all([
        apiGet("/friends"),
        apiGet("/friends/requests/received"),
        apiGet("/friends/requests/sent"),
      ]);

      setFriends(Array.isArray(f) ? f : []);
      setReceived(Array.isArray(r) ? r : []);
      setSent(Array.isArray(s) ? s : []);

      // aggiorna contatore richieste ricevute (badge visivo globale)
      localStorage.setItem("clasp.friendReqReceivedCount", String(Array.isArray(r) ? r.length : 0));
      window.dispatchEvent(new Event("clasp:badge"));
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openChatWith(u: any) {
    setErr(null);
    setInfo(null);
    setBusy(true);
    try {
      const conv = await apiPost("/conversations", { otherUserId: Number(u?.id) });
      const cid = Number(conv?.id || 0);
      if (cid) {
        window.dispatchEvent(new CustomEvent("clasp:conversation:join", { detail: { conversationId: cid } }));
        nav(`/?cid=${cid}`);
      } else {
        nav("/");
      }
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function accept(reqId: number) {
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      await apiPost(`/friends/requests/${reqId}/accept`);
      setReceived((p) => p.filter((x) => Number(x?.id) !== Number(reqId)));
      setInfo(tr("friendsAcceptedMsg", "Richiesta accettata"));

      // aggiorna badge
      const nextCount = Math.max(0, (received?.length || 0) - 1);
      localStorage.setItem("clasp.friendReqReceivedCount", String(nextCount));
      window.dispatchEvent(new Event("clasp:badge"));

      // reload amici per vedere subito la lista
      void loadAll();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function decline(reqId: number) {
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      await apiPost(`/friends/requests/${reqId}/decline`);
      setReceived((p) => p.filter((x) => Number(x?.id) !== Number(reqId)));
      setInfo(tr("friendsDeclinedMsg", "Richiesta rifiutata"));

      const nextCount = Math.max(0, (received?.length || 0) - 1);
      localStorage.setItem("clasp.friendReqReceivedCount", String(nextCount));
      window.dispatchEvent(new Event("clasp:badge"));
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={containerStyle}>
      {!isMobile && <Sidebar />}

      {isMobile && (
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid #222",
            background: "var(--tiko-bg-card)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={() => nav(-1)}
            style={{
              padding: "8px 10px",
              borderRadius: 12,
              border: "1px solid #2a2a2a",
              background: "transparent",
              fontWeight: 950,
              color: "var(--tiko-text)",
            }}
          >
            ←
          </button>
          <div style={{ fontWeight: 950 }}>{tr("friendsTitle", "Amici")}</div>
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", padding: 16 }}>
        <div style={{ maxWidth: 920, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="tiko-card" style={{ border: "1px solid #222" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: 0 }}>{tr("friendsTitle", "Amici")}</h2>
                <div style={{ color: "var(--tiko-text-dim)", fontSize: 13, marginTop: 6 }}>
                  {tr("friendsSubtitle", "Gestisci amici e richieste")}
                </div>
              </div>

              <button
                type="button"
                onClick={loadAll}
                disabled={busy}
                style={{
                  borderRadius: 12,
                  padding: "10px 12px",
                  border: "1px solid #2a2a2a",
                  background: "transparent",
                  color: "var(--tiko-text)",
                  fontWeight: 950,
                }}
              >
                {busy ? tr("friendsLoading", "Carico…") : "↻"}
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <button type="button" onClick={() => setTab("friends")} style={chipStyle(tab === "friends")}>
                {tr("friendsYourFriends", "I tuoi amici")}
              </button>
              <button type="button" onClick={() => setTab("received")} style={chipStyle(tab === "received")}>
                {tr("friendsRequestsReceived", "Richieste ricevute")} {received.length ? `(${received.length})` : ""}
              </button>
              <button type="button" onClick={() => setTab("sent")} style={chipStyle(tab === "sent")}>
                {tr("friendsRequestsSent", "Richieste inviate")} {sent.length ? `(${sent.length})` : ""}
              </button>
            </div>

            {err && <div style={{ marginTop: 12, color: "#ff6b6b", fontSize: 13 }}>{err}</div>}
            {info && <div style={{ marginTop: 12, color: "var(--tiko-mint)", fontSize: 13 }}>{info}</div>}

            {tab === "friends" && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                {friends.length === 0 ? (
                  <div style={{ color: "var(--tiko-text-dim)", fontSize: 13 }}>
                    {tr("friendsNoFriends", "Nessun amico ancora")}
                  </div>
                ) : (
                  friends.map((u) => (
                    <div
                      key={u.id}
                      className="tiko-card tiko-hover-item"
                      style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
                      onClick={() => openChatWith(u)}
                    >
                      {u.avatarUrl ? (
                        <img
                          src={resolveUrl(u.avatarUrl)}
                          alt="avatar"
                          style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover" }}
                        />
                      ) : (
                        <div className="tiko-avatar">{String(u.displayName || u.username || "U")[0]?.toUpperCase()}</div>
                      )}

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {u.displayName || u.username || "Utente"}
                        </div>
                        <div style={{ color: "var(--tiko-text-dim)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          @{u.username || "user"}
                        </div>
                      </div>

                      <div style={{ color: "var(--tiko-text-dim)", fontWeight: 950 }}>→</div>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === "received" && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                {received.length === 0 ? (
                  <div style={{ color: "var(--tiko-text-dim)", fontSize: 13 }}>
                    {tr("friendsNoRequestsReceived", "Nessuna richiesta ricevuta")}
                  </div>
                ) : (
                  received.map((r) => {
                    const u = r.sender;
                    return (
                      <div key={r.id} className="tiko-card" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        {u?.avatarUrl ? (
                          <img src={resolveUrl(u.avatarUrl)} alt="avatar" style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover" }} />
                        ) : (
                          <div className="tiko-avatar">{String(u?.displayName || u?.username || "U")[0]?.toUpperCase()}</div>
                        )}

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {u?.displayName || u?.username || "Utente"}
                          </div>
                          <div style={{ color: "var(--tiko-text-dim)", fontSize: 12 }}>
                            {tr("friendsWantsToAddYou", "Vuole aggiungerti")}
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 8 }}>
                          <button type="button" disabled={busy} onClick={() => accept(Number(r.id))}>
                            {tr("friendsAccept", "Accetta")}
                          </button>
                          <button type="button" disabled={busy} onClick={() => decline(Number(r.id))} style={{ background: "#ff3b30" }}>
                            {tr("friendsDecline", "Rifiuta")}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {tab === "sent" && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                {sent.length === 0 ? (
                  <div style={{ color: "var(--tiko-text-dim)", fontSize: 13 }}>
                    {tr("friendsNoRequestsSent", "Nessuna richiesta inviata")}
                  </div>
                ) : (
                  sent.map((r) => {
                    const u = r.receiver;
                    return (
                      <div key={r.id} className="tiko-card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        {u?.avatarUrl ? (
                          <img src={resolveUrl(u.avatarUrl)} alt="avatar" style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover" }} />
                        ) : (
                          <div className="tiko-avatar">{String(u?.displayName || u?.username || "U")[0]?.toUpperCase()}</div>
                        )}

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {u?.displayName || u?.username || "Utente"}
                          </div>
                          <div style={{ color: "var(--tiko-text-dim)", fontSize: 12 }}>
                            {tr("friendsPending", "In attesa")}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
