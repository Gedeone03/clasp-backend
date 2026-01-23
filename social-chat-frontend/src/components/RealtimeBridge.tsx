import React, { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { API_BASE_URL } from "../config";
import { useAuth } from "../AuthContext";

const LS_UNREAD = "clasp.unreadCounts"; // { [conversationId]: number }
const LS_ACTIVE = "clasp.activeConversationId"; // number
const LS_FR_COUNT = "clasp.friendReqReceivedCount"; // number
const APP_TITLE = "CLASP";

// (2) Android badge-notification tag: una sola notifica, sempre la stessa
const BADGE_NOTIF_TAG = "clasp-badge";

// ---------- helpers localStorage ----------
function readJson<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function readUnreadCounts(): Record<string, number> {
  return readJson<Record<string, number>>(LS_UNREAD, {});
}

function writeUnreadCounts(v: Record<string, number>) {
  writeJson(LS_UNREAD, v);
  window.dispatchEvent(new Event("clasp:badge"));
}

function readActiveConversationId(): number {
  const n = Number(localStorage.getItem(LS_ACTIVE) || "0");
  return Number.isFinite(n) ? n : 0;
}

function readFriendReqCount(): number {
  const n = Number(localStorage.getItem(LS_FR_COUNT) || "0");
  return Number.isFinite(n) ? n : 0;
}

function setFriendReqCount(n: number) {
  localStorage.setItem(LS_FR_COUNT, String(Math.max(0, Number(n) || 0)));
  window.dispatchEvent(new Event("clasp:badge"));
}

function sumUnread(v: Record<string, number>) {
  return Object.values(v).reduce((a, b) => a + (Number(b) || 0), 0);
}

// ---------- token ----------
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

function apiBase() {
  return String(API_BASE_URL || "").replace(/\/+$/, "");
}

async function fetchJson(path: string) {
  const token = getToken();
  const res = await fetch(`${apiBase()}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

// ---------- sound (WebAudio beep) ----------
function makeAudioContext(): AudioContext | null {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    return new Ctx();
  } catch {
    return null;
  }
}

function playBeep(ctx: AudioContext) {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(880, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.26);
}

// ---------- badge: title + app badge + favicon ----------
function setTitleBadge(total: number) {
  document.title = total > 0 ? `(${total}) ${APP_TITLE}` : APP_TITLE;
}

// (1) iOS/macOS: setAppBadge + clear fallback robusto
async function setAppIconBadge(total: number) {
  try {
    const nav: any = navigator as any;
    if (typeof nav.setAppBadge !== "function") return;

    if (total > 0) {
      await nav.setAppBadge(total);
      return;
    }

    if (typeof nav.clearAppBadge === "function") {
      await nav.clearAppBadge();
      return;
    }

    // fallback: alcuni browser accettano setAppBadge(0) come clear
    await nav.setAppBadge(0);
  } catch {
    // ignore
  }
}

// (3) Android: per vedere badge/dot sull'icona serve una notifica non letta.
// Qui creiamo/aggiorniamo UNA sola notifica silenziosa di riepilogo.
async function syncAndroidLauncherBadge(total: number) {
  try {
    const nav: any = navigator as any;

    // Se setAppBadge esiste (iPhone PWA / alcuni desktop), non serve questo workaround
    if (typeof nav.setAppBadge === "function") return;

    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;

    if (!("serviceWorker" in navigator)) return;

    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg || typeof (reg as any).showNotification !== "function") return;

    const isVisible = document.visibilityState === "visible";

    // Se non ci sono non-letti o l'app è visibile, chiudo l'eventuale notifica-badge
    if (total <= 0 || isVisible) {
      try {
        const existing = await reg.getNotifications({ tag: BADGE_NOTIF_TAG });
        existing.forEach((n) => n.close());
      } catch {
        // ignore
      }
      return;
    }

    const body = total === 1 ? "Hai 1 notifica" : `Hai ${total} notifiche`;

    // Notifica unica, aggiornata con tag fisso: niente spam
    await (reg as any).showNotification("CLASP", {
      body,
      tag: BADGE_NOTIF_TAG,
      silent: true,
      renotify: false,
      icon: "/icons/clasp-icon-192.png",
      badge: "/icons/clasp-icon-192.png",
    });
  } catch {
    // ignore
  }
}

function getFaviconLink(): HTMLLinkElement | null {
  const links = Array.from(document.querySelectorAll('link[rel~="icon"]')) as HTMLLinkElement[];
  return links.length > 0 ? links[0] : null;
}

async function loadFaviconImage(href: string): Promise<HTMLImageElement | null> {
  try {
    const url = href || "/favicon.ico";
    const res = await fetch(url, { cache: "force-cache" });
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);

    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("FAVICON_LOAD_FAIL"));
      img.src = objUrl;
    });

    return img;
  } catch {
    return null;
  }
}

function drawFaviconBadge(baseImg: HTMLImageElement | null, count: number): string | null {
  try {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    if (baseImg) ctx.drawImage(baseImg, 0, 0, size, size);
    else {
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, size, size);
    }

    const radius = 16;
    const x = size - radius - 2;
    const y = radius + 2;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#FF38B8";
    ctx.fill();

    ctx.font = "bold 20px Arial";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const text = count > 99 ? "99+" : String(count);
    ctx.fillText(text, x, y);

    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export default function RealtimeBridge() {
  const { user } = useAuth();
  const myId = Number((user as any)?.id || 0) || 0;

  const socketRef = useRef<Socket | null>(null);

  // audio
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef(false);
  const askedNotifRef = useRef(false);

  // favicon badge state
  const faviconOrigHrefRef = useRef<string | null>(null);
  const faviconBaseImgRef = useRef<HTMLImageElement | null>(null);

  function updateAllBadges() {
    const unread = sumUnread(readUnreadCounts());
    const fr = readFriendReqCount();
    const total = unread + fr;

    setTitleBadge(total);
    void setAppIconBadge(total);

    // (4) Android: badge/dot tramite notifica silenziosa
    void syncAndroidLauncherBadge(total);

    // favicon
    const link = getFaviconLink();
    if (!link) return;

    if (!faviconOrigHrefRef.current) faviconOrigHrefRef.current = link.href;

    if (total <= 0) {
      link.href = faviconOrigHrefRef.current || link.href;
      return;
    }

    const dataUrl = drawFaviconBadge(faviconBaseImgRef.current, total);
    if (dataUrl) link.href = dataUrl;
  }

  // (5) badge refresh + unlock audio + permission + visibilitychange refresh
  useEffect(() => {
    updateAllBadges();

    const onBadge = () => updateAllBadges();
    window.addEventListener("clasp:badge", onBadge);

    const onVis = () => updateAllBadges();
    document.addEventListener("visibilitychange", onVis);

    const unlock = async () => {
      if (!audioCtxRef.current) audioCtxRef.current = makeAudioContext();
      const ctx = audioCtxRef.current;

      if (ctx) {
        try {
          if (ctx.state === "suspended") await ctx.resume();
          audioUnlockedRef.current = true;
        } catch {
          // ignore
        }
      }

      // Permesso notifiche su gesto utente (necessario su iPhone, utile su Android)
      if (!askedNotifRef.current && typeof Notification !== "undefined") {
        askedNotifRef.current = true;
        try {
          if (Notification.permission === "default") {
            await Notification.requestPermission();
          }
        } catch {
          // ignore
        }
      }

      // Applica subito badge dopo eventuale grant permission
      updateAllBadges();

      window.removeEventListener("pointerdown", unlock as any);
      window.removeEventListener("touchstart", unlock as any);
      window.removeEventListener("keydown", unlock as any);
    };

    window.addEventListener("pointerdown", unlock as any, { once: true });
    window.addEventListener("touchstart", unlock as any, { once: true });
    window.addEventListener("keydown", unlock as any, { once: true });

    // carica favicon base una volta
    (async () => {
      const link = getFaviconLink();
      const href = link?.href || "/favicon.ico";
      faviconBaseImgRef.current = await loadFaviconImage(href);
      updateAllBadges();
    })();

    return () => {
      window.removeEventListener("clasp:badge", onBadge);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // socket connect + realtime messages
  useEffect(() => {
    const token = getToken();
    if (!token) return;

    // IMPORTANTISSIMO: NON forzare solo websocket.
    // Molti ambienti mobile / proxy / Railway possono far fallire websocket diretto.
    // Con polling+websocket la chat torna live.
    const socket = io(apiBase(), {
      path: "/socket.io",
      auth: { token },
      withCredentials: true,
      transports: ["polling", "websocket"],
      upgrade: true,
      rememberUpgrade: true,
      reconnection: true,
      timeout: 15000,
    });

    socketRef.current = socket;

    let joinInterval: number | null = null;

    const joinAll = async () => {
      try {
        const list = await fetchJson("/conversations");
        const arr = Array.isArray(list) ? list : [];

        // Join conversations dal backend
        for (const c of arr) {
          const cid = Number((c as any)?.id || 0);
          if (cid) socket.emit("conversation:join", { conversationId: cid });
        }

        // Fallback: se per qualsiasi motivo /conversations fallisce o è vuoto,
        // prova almeno a joinare activeCid e quelle presenti in unreadCounts.
        if (arr.length === 0) {
          const activeCid = readActiveConversationId();
          if (activeCid) socket.emit("conversation:join", { conversationId: activeCid });

          const unread = readUnreadCounts();
          for (const k of Object.keys(unread)) {
            const cid = Number(k || 0);
            if (cid) socket.emit("conversation:join", { conversationId: cid });
          }
        }
      } catch {
        // ignore
      }
    };

    socket.on("connect", () => {
      void joinAll();

      // ogni 45s prova a re-joinare (utile per nuove chat create dopo il connect)
      if (joinInterval == null) {
        joinInterval = window.setInterval(() => {
          if (socket.connected) void joinAll();
        }, 45000);
      }
    });

    // Se vuoi debug (non rompe niente): puoi lasciarlo
    socket.on("connect_error", () => {
      // non spammo console con dettagli, ma se vuoi li aggiungiamo
    });

    const onIncoming = (payload: any) => {
      const conversationId = Number(payload?.conversationId || payload?.conversation?.id || 0);
      const message = payload?.message || payload;

      if (!conversationId || !message) return;

      // Evento interno: serve alla UI per appendere messaggi live
      window.dispatchEvent(new CustomEvent("clasp:message", { detail: { conversationId, message } }));

      // Se è un mio messaggio, niente notifiche/badge (ma la UI lo vede comunque)
      const senderId = Number(message?.senderId || message?.sender?.id || 0);
      if (senderId && senderId === myId) return;

      const activeCid = readActiveConversationId();
      const visible = document.visibilityState === "visible";

      // Se stai guardando quella chat, non incrementare badge
      if (visible && activeCid === conversationId) {
        const counts = readUnreadCounts();
        if (counts[String(conversationId)]) {
          counts[String(conversationId)] = 0;
          writeUnreadCounts(counts);
        } else {
          updateAllBadges();
        }
        return;
      }

      // altrimenti incrementa unread
      const counts = readUnreadCounts();
      counts[String(conversationId)] = (Number(counts[String(conversationId)]) || 0) + 1;
      writeUnreadCounts(counts);

      // suono in-app se sbloccato
      const ctx = audioCtxRef.current;
      if (audioUnlockedRef.current && ctx) {
        try {
          void (ctx as any).resume?.();
          playBeep(ctx);
        } catch {
          // ignore
        }
      }

      // Notifica OS (desktop) solo se permesso e tab in background
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        document.visibilityState !== "visible"
      ) {
        try {
          const body = typeof message?.content === "string" ? message.content : "Hai un nuovo messaggio";
          new Notification("Nuovo messaggio", { body });
        } catch {
          // ignore
        }
      }
    };

    socket.on("message:new", onIncoming);
    socket.on("message", onIncoming);

    return () => {
      if (joinInterval != null) {
        window.clearInterval(joinInterval);
        joinInterval = null;
      }

      socket.off("message:new", onIncoming);
      socket.off("message", onIncoming);
      socket.off("connect");
      socket.off("connect_error");
      socket.disconnect();
      socketRef.current = null;
    };
  }, [myId]);

  // poll friend requests ricevute (badge + opzionale suono)
  useEffect(() => {
    const token = getToken();
    if (!token) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const r = await fetchJson("/friends/requests/received");
        const count = Array.isArray(r) ? r.length : 0;
        if (cancelled) return;

        const prev = readFriendReqCount();
        if (count !== prev) {
          setFriendReqCount(count);

          // suono solo se aumentano (nuova richiesta)
          if (count > prev) {
            const ctx = audioCtxRef.current;
            if (audioUnlockedRef.current && ctx) {
              try {
                void (ctx as any).resume?.();
                playBeep(ctx);
              } catch {
                // ignore
              }
            }
          }
        } else {
          updateAllBadges();
        }
      } catch {
        // ignore
      }
    };

    void poll();
    const id = window.setInterval(poll, 12000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return null;
}
