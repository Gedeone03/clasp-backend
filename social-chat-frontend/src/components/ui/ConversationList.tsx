import React, { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../../config";
import { useAuth } from "../../AuthContext";

const LS_UNREAD = "clasp.unreadCounts";
const LS_ACTIVE = "clasp.activeConversationId";

function readUnreadCounts(): Record<string, number> {
  try {
    const s = localStorage.getItem(LS_UNREAD);
    return s ? (JSON.parse(s) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeUnreadCounts(v: Record<string, number>) {
  localStorage.setItem(LS_UNREAD, JSON.stringify(v));
  window.dispatchEvent(new Event("clasp:badge"));
}

/**
 * FIX iPhone (Mixed Content):
 * - se la pagina è https, qualsiasi URL http:// viene forzato a https://
 * - se avatarUrl è relativo (/uploads/...), lo aggancia a API_BASE_URL
 * - se API_BASE_URL è http ma la pagina è https, forza https anche sulla base
 */
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

function formatTime(ts?: string | null) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
}

function getOtherUser(conversation: any, myId: number) {
  const ps = Array.isArray(conversation?.participants) ? conversation.participants : [];
  for (const p of ps) {
    const u = p?.user || p;
    const uid = Number(u?.id || p?.userId || 0);
    if (uid && uid !== myId) return u;
  }
  return null;
}

export default function ConversationList({
  conversations,
  selectedConversationId,
  onSelect,
}: {
  conversations: any[];
  selectedConversationId: number | null;
  onSelect: (c: any) => void;
}) {
  const { user } = useAuth();
  const myId = Number((user as any)?.id || 0) || 0;

  const [unread, setUnread] = useState<Record<string, number>>(readUnreadCounts());

  useEffect(() => {
    const sync = () => setUnread(readUnreadCounts());
    window.addEventListener("clasp:badge", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("clasp:badge", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const items = useMemo(() => (Array.isArray(conversations) ? conversations : []), [conversations]);

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 12 }}>
      {items.length === 0 ? (
        <div style={{ color: "var(--tiko-text-dim)", fontSize: 13, padding: 8 }}>
          Nessuna chat
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((c: any) => {
            const cid = Number(c?.id || 0);
            const other = getOtherUser(c, myId);
            const name = other?.displayName || other?.username || "Chat";
            const avatar = other?.avatarUrl ? resolveUrl(other.avatarUrl) : "";
            const last = c?.lastMessage || null;

            const preview =
              last?.deletedAt
                ? "Messaggio eliminato"
                : typeof last?.content === "string"
                ? last.content
                : "";

            const time = formatTime(last?.createdAt || null);

            const isSelected = selectedConversationId != null && Number(selectedConversationId) === cid;
            const count = Number(unread[String(cid)] || 0);

            return (
              <div
                key={cid}
                className="tiko-card tiko-hover-item"
                style={{
                  cursor: "pointer",
                  border: isSelected ? "1px solid var(--tiko-purple)" : "1px solid #222",
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                }}
                onClick={() => {
                  localStorage.setItem(LS_ACTIVE, String(cid));

                  if (count > 0) {
                    const next = { ...unread, [String(cid)]: 0 };
                    writeUnreadCounts(next);
                    setUnread(next);
                  }

                  onSelect(c);
                }}
              >
                {avatar ? (
                  <img
                    src={avatar}
                    alt="avatar"
                    style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover" }}
                    loading="lazy"
                    onError={(e) => {
                      const img = e.currentTarget as HTMLImageElement;
                      img.onerror = null;
                      // fallback: icona locale (sempre https perché è sul tuo dominio)
                      img.src = "/icons/clasp-icon-192.png";
                    }}
                  />
                ) : (
                  <div className="tiko-avatar">{String(name)[0]?.toUpperCase()}</div>
                )}

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div
                      style={{
                        fontWeight: 950,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {name}
                    </div>

                    <div style={{ color: "var(--tiko-text-dim)", fontSize: 12, fontWeight: 900 }}>
                      {time}
                    </div>
                  </div>

                  <div
                    style={{
                      color: "var(--tiko-text-dim)",
                      fontSize: 12,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      marginTop: 4,
                    }}
                  >
                    {preview}
                  </div>
                </div>

                {count > 0 ? (
                  <div
                    style={{
                      minWidth: 26,
                      height: 26,
                      borderRadius: 999,
                      background: "var(--tiko-magenta)",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 950,
                      fontSize: 12,
                      padding: "0 8px",
                      boxShadow: "0 0 10px rgba(255,56,184,0.35)",
                    }}
                    title="Messaggi non letti"
                  >
                    {count}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
