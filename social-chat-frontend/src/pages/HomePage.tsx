import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import Sidebar from "../components/ui/Sidebar";
import ConversationList from "../components/ui/ConversationList";
import ChatWindow from "../components/ui/ChatWindow";
import { useAuth } from "../AuthContext";
import * as api from "../api";
import { useI18n } from "../LanguageContext";

function useIsMobile(breakpointPx = 900) {
  const compute = () => {
    if (typeof window === "undefined") return false;

    const w = window.innerWidth || 0;

    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia(`(max-width: ${breakpointPx}px)`).matches
        : w < breakpointPx;

    const coarse =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;

    const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
    const hasTouch =
      typeof navigator !== "undefined" &&
      (("ontouchstart" in window) || (navigator as any).maxTouchPoints > 0);

    const iPadDesktopUa = /Macintosh/i.test(ua) && hasTouch;
    const uaMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua) || iPadDesktopUa;

    return mq || coarse || uaMobile;
  };

  const [isMobile, setIsMobile] = useState(compute);

  useEffect(() => {
    const onResize = () => setIsMobile(compute());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakpointPx]);

  return isMobile;
}

type UserLite = {
  id: number;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  mood?: string | null;
  state?: string | null;
  city?: string | null;
  area?: string | null;
};

function safeArr<T = any>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function getOtherUserId(conv: any, myId: number): number | null {
  const ps = safeArr<any>(conv?.participants);
  for (const p of ps) {
    const uid = Number(p?.userId || p?.user?.id || 0);
    if (uid && uid !== myId) return uid;
  }
  return null;
}

export default function HomePage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const isMobile = useIsMobile(900);
  const location = useLocation();

  const [mobileView, setMobileView] = useState<"hub" | "search" | "chats" | "chat">("hub");

  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);

  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [mood, setMood] = useState("");
  const [state, setState] = useState("");
  const [visibleOnly, setVisibleOnly] = useState(false);

  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<UserLite[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searchInfo, setSearchInfo] = useState<string | null>(null);
  const [sentRequestIds, setSentRequestIds] = useState<Set<number>>(new Set());
  const [alreadyFriendIds, setAlreadyFriendIds] = useState<Set<number>>(new Set());

  const creatingConvRef = useRef(false);

  const myId = Number((user as any)?.id || 0);

  const tr = useCallback(
    (key: string, fallback: string) => {
      const out = t(key);
      return out === key ? fallback : out;
    },
    [t]
  );

  const tState = useCallback(
    (s?: string | null): string => {
      if (!s) return "";
      const key = `state_${s}`;
      const out = t(key);
      return out === key ? s : out;
    },
    [t]
  );

  const tMood = useCallback(
    (m?: string | null): string => {
      if (!m) return "";
      const key = `mood_${m}`;
      const out = t(key);
      return out === key ? m : out;
    },
    [t]
  );

  const STATE_OPTIONS = useMemo(
    () => [
      { value: "", label: tr("stateAny", "Qualsiasi stato") },
      { value: "DISPONIBILE", label: tState("DISPONIBILE") },
      { value: "OCCUPATO", label: tState("OCCUPATO") },
      { value: "ASSENTE", label: tState("ASSENTE") },
      { value: "OFFLINE", label: tState("OFFLINE") },
      { value: "INVISIBILE", label: tState("INVISIBILE") },
      { value: "VISIBILE_A_TUTTI", label: tState("VISIBILE_A_TUTTI") },
    ],
    [tr, tState]
  );

  const MOOD_OPTIONS = useMemo(
    () => [
      { value: "", label: tr("moodAny", "Qualsiasi mood") },
      { value: "FELICE", label: tMood("FELICE") },
      { value: "TRISTE", label: tMood("TRISTE") },
      { value: "RILASSATO", label: tMood("RILASSATO") },
      { value: "ANSIOSO", label: tMood("ANSIOSO") },
      { value: "ENTUSIASTA", label: tMood("ENTUSIASTA") },
      { value: "ARRABBIATO", label: tMood("ARRABBIATO") },
      { value: "SOLO", label: tMood("SOLO") },
    ],
    [tr, tMood]
  );

  // Styles (coerenti con il tema, nessuna modifica grafica sostanziale)
  const card: React.CSSProperties = {
    background: "var(--tiko-bg-card)",
    border: "1px solid #222",
    borderRadius: 14,
    padding: 12,
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
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #2a2a2a",
    background: "transparent",
    color: "var(--tiko-text)",
    fontWeight: 950,
    cursor: "pointer",
  };

  const btnPrimary: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--tiko-mint)",
    background: "var(--tiko-mint)",
    color: "#000",
    fontWeight: 950,
    cursor: "pointer",
  };

  const headerBtn: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid #2a2a2a",
    background: "transparent",
    color: "var(--tiko-text)",
    cursor: "pointer",
    fontWeight: 950,
  };

  // Load conversations
  useEffect(() => {
    if (!user) return;

    let alive = true;
    (async () => {
      try {
        const list = await (api as any).fetchConversations?.();
        if (!alive) return;
        setConversations(safeArr(list));
      } catch {
        // ignore
      }
    })();

    return () => {
      alive = false;
    };
  }, [user?.id]);

  // Mobile navigation via querystring: /?view=chats|search|hub
  useEffect(() => {
    if (!isMobile) return;
    const params = new URLSearchParams(location.search);
    const view = String(params.get("view") || "").toLowerCase();

    if (view === "search") setMobileView("search");
    if (view === "chats") setMobileView("chats");
    if (view === "hub") setMobileView("hub");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, location.search]);

  // Deep-link/open a specific conversation by cid, or by uid (other user)
  useEffect(() => {
    if (!user) return;

    const params = new URLSearchParams(location.search);
    const cid = Number(params.get("cid") || 0);
    const uid = Number(params.get("uid") || 0);

    if (conversations.length === 0) return;

    (async () => {
      if (cid) {
        const found = conversations.find((c) => Number(c?.id) === cid) || null;
        if (found) {
          setSelectedConversation(found);
          if (isMobile) setMobileView("chat");
        }
        return;
      }

      if (uid) {
        const found = conversations.find((c) => getOtherUserId(c, myId) === uid) || null;

        if (found) {
          setSelectedConversation(found);
          if (isMobile) setMobileView("chat");
          return;
        }

        if (creatingConvRef.current) return;
        creatingConvRef.current = true;
        try {
          const created = await (api as any).createConversation?.(uid);
          if (created?.id) {
            setConversations((prev) => {
              const exists = prev.some((c) => Number(c?.id) === Number(created?.id));
              if (exists) return prev.map((c) => (Number(c?.id) === Number(created?.id) ? created : c));
              return [created, ...prev];
            });
            setSelectedConversation(created);
            if (isMobile) setMobileView("chat");
          }
        } catch {
          // ignore
        } finally {
          creatingConvRef.current = false;
        }
      }
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, isMobile, location.search, myId, user?.id]);

  // Load messages when selecting a conversation
  useEffect(() => {
    if (!selectedConversation?.id) {
      setMessages([]);
      return;
    }

    let alive = true;
    (async () => {
      try {
        const list = await (api as any).fetchMessages?.(Number(selectedConversation.id));
        if (!alive) return;
        setMessages(safeArr(list));
      } catch {
        // ignore
      }
    })();

    return () => {
      alive = false;
    };
  }, [selectedConversation?.id]);

  // Aggiornamento immediato UI quando invio messaggio via HTTP
  const handleMessageCreated = useCallback(
    (msg: any) => {
      if (!msg || !msg.id) return;

      const cid = Number((msg as any).conversationId || 0);
      if (!cid) return;

      setMessages((prev) => {
        if (Number(selectedConversation?.id || 0) !== cid) return prev;
        const arr = safeArr<any>(prev);
        if (arr.some((m) => Number(m?.id) === Number(msg.id))) return arr;
        return [...arr, msg];
      });

      setSelectedConversation((prev) => {
        if (!prev || Number(prev.id) !== cid) return prev;
        return { ...prev, lastMessage: msg };
      });

      setConversations((prev) =>
        safeArr<any>(prev).map((c) => (Number(c?.id) === cid ? { ...c, lastMessage: msg } : c))
      );
    },
    [selectedConversation?.id]
  );

  async function doSearch() {
    setSearchErr(null);
    setSearchInfo(null);

    if (searching) return;

    try {
      setSearching(true);

      const hasAny =
        !!q.trim() || !!city.trim() || !!area.trim() || !!mood || !!state || !!visibleOnly;

      if (!hasAny) {
        setSearchInfo(tr("homeFilterAtLeastOne", "Imposta almeno un filtro"));
        return;
      }

      const params = {
        q: q.trim() || undefined,
        city: city.trim() || undefined,
        area: area.trim() || undefined,
        mood: mood || undefined,
        state: state || undefined,
        visibleOnly: visibleOnly || undefined,
      };

      const list = await (api as any).searchUsers?.(params);
      const arr = safeArr<UserLite>(list).filter((u) => Number(u?.id) !== Number((user as any)?.id));
      setResults(arr);
      if (arr.length === 0) setSearchInfo(tr("homeNoUserFound", "Nessun utente trovato"));
    } catch (e: any) {
      setSearchErr(e?.message || tr("homeSearchError", "Errore ricerca"));
    } finally {
      setSearching(false);
    }
  }

  async function doSendFriendRequest(userId: number) {
    setSearchErr(null);
    setSearchInfo(null);

    const u = safeArr<UserLite>(results).find((x) => Number(x?.id) === Number(userId));
    const name = u?.displayName || u?.username || tr("genericUser", "Utente");

    try {
      const res = await (api as any).sendFriendRequest?.(userId);
      const status = String(res?.status || "sent");

      if (status === "already_friends") {
        setAlreadyFriendIds((prev) => new Set(prev).add(userId));
        setSearchInfo(`${tr("homeAlreadyFriend", "Sei già amico di") } ${name}`);
        return;
      }

      if (status === "already") {
        setSentRequestIds((prev) => new Set(prev).add(userId));
        setSearchInfo(`${tr("homeAlreadyRequested", "Richiesta già inviata a")} ${name}`);
        return;
      }

      setSentRequestIds((prev) => new Set(prev).add(userId));
      setSearchInfo(`${tr("homeFriendRequestSentTo", "Richiesta inviata a")} ${name}`);
    } catch (e: any) {
      const serverMsg = e?.response?.data?.error || e?.response?.data?.message;
      setSearchErr(String(serverMsg || e?.message || tr("homeSendFriendRequestError", "Errore invio richiesta")));
    }
  }

  function resetSearch() {
    setQ("");
    setCity("");
    setArea("");
    setMood("");
    setState("");
    setVisibleOnly(false);
    setResults([]);
    setSearchErr(null);
    setSearchInfo(null);
  }

  const SearchBlock = (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={card}>
        <div style={{ fontWeight: 950, marginBottom: 10 }}>{tr("homeSearchTitle", "Cerca utenti")}</div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
          <input
            style={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr("homeNameOrUsernamePlaceholder", "Nome o username")}
          />

          <input
            style={input}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={tr("homeCityPlaceholder", "Città")}
          />

          <input
            style={input}
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder={tr("homeAreaPlaceholder", "Zona")}
          />

          <select style={input as any} value={state} onChange={(e) => setState(e.target.value)}>
            {STATE_OPTIONS.map((o) => (
              <option key={o.value || "_"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <select style={input as any} value={mood} onChange={(e) => setMood(e.target.value)}>
            {MOOD_OPTIONS.map((o) => (
              <option key={o.value || "_"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 10,
            color: "var(--tiko-text-dim)",
            fontSize: 13,
          }}
        >
          <input
            type="checkbox"
            checked={visibleOnly}
            onChange={(e) => setVisibleOnly(e.target.checked)}
          />
          {tr("homeVisibleOnly", "Solo visibili")}
        </label>

        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" style={btnPrimary} onClick={doSearch} disabled={searching}>
            {searching ? tr("homeSearchProgress", "Cerco…") : tr("homeSearchButton", "Cerca")}
          </button>
          <button type="button" style={btn} onClick={resetSearch}>
            {tr("homeReset", "Reset")}
          </button>
        </div>

        {searchErr && (
          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #3a1f1f",
              background: "rgba(255,59,48,0.08)",
              color: "#ff6b6b",
              fontWeight: 900,
            }}
          >
            {searchErr}
          </div>
        )}

        {searchInfo && (
          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #2a2a2a",
              color: "var(--tiko-text)",
              fontWeight: 900,
            }}
          >
            {searchInfo}
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div style={card}>
          <div style={{ fontWeight: 950, marginBottom: 10 }}>{tr("homeResultsTitle", "Risultati")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {results.map((u: any) => {
              const uid = Number(u.id);
              const requested = sentRequestIds.has(uid);
              const alreadyFriend = alreadyFriendIds.has(uid);
              const disabled = requested || alreadyFriend;
              const moodLabel = u.mood ? tMood(String(u.mood)) : "";
              const stateLabel = u.state ? tState(String(u.state)) : "";

              return (
                <div
                  key={u.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid #232323",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 950,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {u.displayName || u.username || tr("genericUser", "Utente")}{" "}
                      {u.username ? (
                        <span style={{ color: "var(--tiko-text-dim)" }}>@{u.username}</span>
                      ) : null}
                    </div>

                    <div style={{ fontSize: 12, color: "var(--tiko-text-dim)" }}>
                      {[u.city, u.area].filter(Boolean).join(" • ")}
                      {moodLabel ? ` • Mood: ${moodLabel}` : ""}
                      {stateLabel ? ` • ${tr("profileState", "Stato")}: ${stateLabel}` : ""}
                    </div>
                  </div>

                  <button
                    type="button"
                    style={disabled ? btn : btnPrimary}
                    disabled={disabled}
                    onClick={() => doSendFriendRequest(Number(u.id))}
                    title={
                      alreadyFriend
                        ? tr("homeAlreadyFriendsButton", "Già amici")
                        : requested
                        ? tr("homeRequestAlreadySent", "Richiesta già inviata")
                        : tr("homeSendRequestTitle", "Invia richiesta")
                    }
                  >
                    {alreadyFriend
                      ? tr("homeAlreadyFriendsButton", "Amici")
                      : requested
                      ? tr("homeSent", "Inviata")
                      : tr("homeAdd", "Aggiungi")}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  if (!user) return <div style={{ padding: 14 }}>{tr("homeNotLogged", "Non sei loggato")}</div>;

  // =========================
  // MOBILE: pagine dedicate full screen
  // =========================
  if (isMobile) {
    const showHeader = mobileView === "search" || mobileView === "chats";

    const headerTitle =
      mobileView === "search"
        ? tr("homeSearchUsersHeader", "Cerca")
        : mobileView === "chats"
        ? tr("homeChatsHeader", "Chat")
        : "";

    const goBackFromHeader = () => setMobileView("hub");

    return (
      <div
        style={{
          height: "var(--app-height, 100vh)",
          width: "100vw",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--tiko-bg-dark)",
        }}
      >
        {mobileView === "hub" ? <Sidebar /> : null}

        {showHeader ? (
          <div
            style={{
              padding: 10,
              borderBottom: "1px solid #222",
              background: "var(--tiko-bg-card)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <button type="button" style={headerBtn} onClick={goBackFromHeader} aria-label={tr("genericBack", "Indietro")}>
              ←
            </button>

            <div
              style={{
                fontWeight: 950,
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {headerTitle}
            </div>
          </div>
        ) : null}

        <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
          {mobileView === "hub" ? (
            <div style={{ padding: 14, height: "100%", overflowY: "auto" }}>
              <div style={card}>
                <div style={{ fontWeight: 950, marginBottom: 10 }}>{tr("homeWhatDo", "Cosa vuoi fare?")}</div>

                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" style={btnPrimary} onClick={() => setMobileView("chats")}>
                    {tr("homeChatsHeader", "Chat")}
                  </button>

                  <button type="button" style={btn} onClick={() => setMobileView("search")}>
                    {tr("homeSearchUsersHeader", "Cerca")}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {mobileView === "search" ? (
            <div style={{ height: "100%", overflowY: "auto" }}>{SearchBlock}</div>
          ) : null}

          {mobileView === "chats" ? (
            <div style={{ height: "100%", overflowY: "auto" }}>
              <ConversationList
                conversations={conversations}
                selectedConversationId={selectedConversation?.id ?? null}
                onSelect={(c) => {
                  setSelectedConversation(c);
                  setMobileView("chat");
                }}
              />
            </div>
          ) : null}

          {mobileView === "chat" ? (
            <ChatWindow
              conversationId={selectedConversation?.id}
              conversation={selectedConversation}
              currentUser={user}
              messages={messages}
              onMessageCreated={handleMessageCreated}
              onBack={() => setMobileView("chats")}
            />
          ) : null}
        </div>
      </div>
    );
  }

  // =========================
  // DESKTOP
  // =========================
  return (
    <div
      style={{
        height: "var(--app-height, 100vh)",
        display: "flex",
        overflow: "hidden",
        background: "var(--tiko-bg-dark)",
      }}
    >
      <Sidebar />

      <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
        <div
          style={{
            width: "clamp(360px, 34vw, 520px)",
            borderRight: "1px solid #222",
            minWidth: 0,
            background: "var(--tiko-bg-gray)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <div style={{ borderBottom: "1px solid #222", background: "var(--tiko-bg-dark)", overflowY: "auto" }}>
            {SearchBlock}
          </div>

          <div style={{ flex: 1, minHeight: 0 }}>
            <ConversationList
              conversations={conversations}
              selectedConversationId={selectedConversation?.id ?? null}
              onSelect={(c) => setSelectedConversation(c)}
            />
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <ChatWindow
            conversationId={selectedConversation?.id}
            conversation={selectedConversation}
            currentUser={user}
            messages={messages}
            onMessageCreated={handleMessageCreated}
          />
        </div>
      </div>
    </div>
  );
}
