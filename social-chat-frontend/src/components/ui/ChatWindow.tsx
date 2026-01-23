import React, { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "../../config";
import { useI18n } from "../../LanguageContext";

type AnyUser = any;
type AnyMessage = any;
type AnyConversation = any;

function apiBase() {
  return String(API_BASE_URL || "").replace(/\/+$/, "");
}

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

function stripQuery(u: string) {
  return u.split("?")[0].split("#")[0];
}

const IMG_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const AUD_EXT = new Set(["mp3", "m4a", "aac", "wav", "ogg", "webm", "opus", "flac", "mp4"]);

function extOfName(name: string): string {
  const n = String(name || "");
  const i = n.lastIndexOf(".");
  if (i < 0) return "";
  return n.slice(i + 1).toLowerCase();
}

function looksLikeImageByName(name: string) {
  return IMG_EXT.has(extOfName(name));
}

function looksLikeAudioByName(name: string) {
  return AUD_EXT.has(extOfName(name));
}

function looksLikeImageUrl(url: string) {
  const clean = stripQuery(url);
  const ext = extOfName(clean);
  if (IMG_EXT.has(ext)) return true;
  return clean.includes("/uploads/chat-images/");
}

function looksLikeAudioUrl(url: string) {
  const clean = stripQuery(url);
  const ext = extOfName(clean);
  if (AUD_EXT.has(ext)) return true;
  return clean.includes("/uploads/audio/");
}

function isLikelyImageFile(file: File) {
  const t = String(file?.type || "").toLowerCase();
  if (t.startsWith("image/")) return true;
  return looksLikeImageByName(file?.name || "");
}

function isLikelyAudioFile(file: File) {
  const t = String(file?.type || "").toLowerCase();
  if (t.startsWith("audio/")) return true;
  return looksLikeAudioByName(file?.name || "");
}

function resolveMediaUrl(url?: string | null): string {
  if (!url) return "";
  let t = String(url).trim();
  if (!t) return "";

  if (t.startsWith("/")) t = `${apiBase()}${t}`;

  // mixed-content fix
  if (typeof window !== "undefined" && window.location.protocol === "https:" && t.startsWith("http://")) {
    t = t.replace(/^http:\/\//i, "https://");
  }

  return t;
}

type Parsed =
  | { kind: "img"; url: string }
  | { kind: "audio"; url: string }
  | { kind: "file"; name: string; url: string }
  | { kind: "text"; text: string };

function parseTaggedContent(content: string): Parsed {
  const t = (content || "").trim();
  const low = t.toLowerCase();

  if (low.startsWith("[img]")) return { kind: "img", url: t.slice(5).trim() };
  if (low.startsWith("[image]")) return { kind: "img", url: t.slice(7).trim() };

  if (low.startsWith("[audio]")) return { kind: "audio", url: t.slice(7).trim() };

  if (low.startsWith("[file]")) {
    const rest = t.slice(6).trim();
    const parts = rest.split(/\s+/);
    if (parts.length >= 2) {
      const url = parts[parts.length - 1];
      const name = parts.slice(0, -1).join(" ");
      return { kind: "file", name, url };
    }
    return { kind: "text", text: t };
  }

  // URL nudo
  if (/^https?:\/\//i.test(t) && looksLikeImageUrl(t)) return { kind: "img", url: t };
  if (/^https?:\/\//i.test(t) && looksLikeAudioUrl(t)) return { kind: "audio", url: t };

  return { kind: "text", text: content };
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

async function uploadTo(endpoint: string, file: File): Promise<string> {
  const fd = new FormData();

  const field = endpoint.includes("/upload/audio") ? "audio" : endpoint.includes("/upload/image") ? "image" : "file";
  fd.append(field, file);

  const res = await fetch(`${apiBase()}${endpoint}`, {
    method: "POST",
    headers: { ...authHeaders() }, // non impostare Content-Type
    body: fd,
  });

  if (!res.ok) throw new Error((await readErrText(res)) || `HTTP ${res.status}`);

  const data: any = await res.json().catch(() => ({}));
  const url = data?.url || data?.fileUrl || data?.path || data?.location;
  if (!url) throw new Error("UPLOAD_OK_NO_URL");
  return String(url);
}

async function uploadSmart(kind: "image" | "audio" | "file", file: File): Promise<string> {
  if (kind === "image") {
    try {
      return await uploadTo("/upload/image", file);
    } catch {
      return uploadTo("/upload/file", file);
    }
  }
  if (kind === "audio") {
    try {
      return await uploadTo("/upload/audio", file);
    } catch {
      return uploadTo("/upload/file", file);
    }
  }
  return uploadTo("/upload/file", file);
}

async function sendMessage(conversationId: number, content: string): Promise<any> {
  const res = await fetch(`${apiBase()}/conversations/${Number(conversationId)}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ content: String(content || "") }),
  });

  if (!res.ok) throw new Error((await readErrText(res)) || `HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}

function isIOS(): boolean {
  try {
    const ua = navigator.userAgent || "";
    const isAppleMobile = /iPhone|iPad|iPod/i.test(ua);
    const isIpadDesktop = /Macintosh/i.test(ua) && (navigator as any).maxTouchPoints > 1;
    return isAppleMobile || isIpadDesktop;
  } catch {
    return false;
  }
}

function canUseMediaRecorder(): boolean {
  if (isIOS()) return false;
  if (typeof window === "undefined") return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  if (typeof (window as any).MediaRecorder === "undefined") return false;
  return true;
}

function pickBestMimeType(): string {
  const MR: any = (window as any).MediaRecorder;
  if (!MR?.isTypeSupported) return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];
  return candidates.find((m) => MR.isTypeSupported(m)) || "";
}

function extFromMime(m: string): string {
  const mm = (m || "").toLowerCase();
  if (mm.includes("ogg")) return "ogg";
  if (mm.includes("webm")) return "webm";
  return "webm";
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

export default function ChatWindow({
  conversationId,
  conversation,
  currentUser,
  messages,
  onBack,
  onMessageCreated,
}: {
  conversationId?: number;
  conversation?: AnyConversation | null;
  currentUser?: AnyUser | null;
  messages?: AnyMessage[];
  onBack?: (() => void) | undefined;
  onMessageCreated?: ((message: AnyMessage) => void) | undefined;
}) {
  const { t } = useI18n();
  const tr = (key: string, fallback: string) => {
    const out = t(key);
    return out === key ? fallback : out;
  };

  const myId = Number(currentUser?.id || 0) || 0;
  const convId = Number(conversationId || conversation?.id || 0);

  const other = useMemo(() => getOtherUser(conversation, myId), [conversation, myId]);
  const title = other?.displayName || other?.username || conversation?.title || "Chat";

  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const voiceInputRef = useRef<HTMLInputElement | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const focusComposer = () => {
    const el = textareaRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      try {
        (el as any).focus({ preventScroll: true });
      } catch {
        el.focus();
      }
    });
  };

  // evita che il bottone "Invia" rubi il focus (iPhone chiude la tastiera)
  const keepComposerFocused = (e: any) => {
    try {
      e.preventDefault();
    } catch {
      // ignore
    }
    focusComposer();
  };

  const sorted = useMemo(() => {
    const arr = Array.isArray(messages) ? [...messages] : [];
    arr.sort((a, b) => new Date(a?.createdAt || 0).getTime() - new Date(b?.createdAt || 0).getTime());
    return arr;
  }, [messages]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [sorted.length]);

  async function handleSend() {
    if (busy) return;

    const content = text.trim();
    if (!content) return;

    if (!convId) {
      setErr(tr("chatMissingConversationSend", "Seleziona una chat prima di inviare."));
      return;
    }

    const toSend = content;

    setErr(null);

    // IMPORTANTISSIMO per iPhone:
    // 1) pulisci subito (resta in focus)
    // 2) NON disabilitare la textarea durante busy
    setText("");
    focusComposer();

    setBusy(true);
    try {
      const msg = await sendMessage(convId, toSend);
      try {
        onMessageCreated?.(msg);
      } catch {
        // ignore
      }
      focusComposer();
    } catch (e: any) {
      // se fallisce, rimetti il testo solo se l'utente non ha già scritto altro
      setErr(String(e?.message || tr("chatSendError", "Errore invio")));
      setText((prev) => (String(prev || "").trim().length === 0 ? toSend : prev));
      focusComposer();
    } finally {
      setBusy(false);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;

    if (!convId) {
      setErr(tr("chatMissingConversationFile", "Seleziona una chat prima di inviare un file."));
      return;
    }

    setErr(null);
    setBusy(true);

    try {
      if (isLikelyImageFile(f)) {
        const url = await uploadSmart("image", f);
        if (!url) throw new Error("UPLOAD_OK_NO_URL");
        const msg = await sendMessage(convId, `[img] ${url}`);
        try {
          onMessageCreated?.(msg);
        } catch {}
      } else if (isLikelyAudioFile(f)) {
        if (f.size === 0) throw new Error("AUDIO_EMPTY_FILE");
        const url = await uploadSmart("audio", f);
        if (!url) throw new Error("UPLOAD_OK_NO_URL");
        const msg = await sendMessage(convId, `[audio] ${url}`);
        try {
          onMessageCreated?.(msg);
        } catch {}
      } else {
        const url = await uploadSmart("file", f);
        if (!url) throw new Error("UPLOAD_OK_NO_URL");
        const encName = encodeURIComponent(f.name || "file");
        const msg = await sendMessage(convId, `[file] ${encName} ${url}`);
        try {
          onMessageCreated?.(msg);
        } catch {}
      }

      focusComposer();
    } catch (e2: any) {
      const m = String(e2?.message || "");
      if (m === "AUDIO_EMPTY_FILE") setErr("Audio vuoto: riprova a registrare almeno 1-2 secondi.");
      else if (m === "UPLOAD_OK_NO_URL") setErr("Upload riuscito ma manca l'URL nel response del server.");
      else setErr(m || tr("chatFileError", "Errore invio file"));
    } finally {
      setBusy(false);
    }
  }

  async function handleVoiceSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;

    if (!convId) {
      setErr(tr("chatMissingConversationVoice", "Seleziona una chat prima di inviare un audio."));
      return;
    }

    if (f.size === 0) {
      setErr("Audio vuoto: riprova a registrare almeno 1-2 secondi.");
      return;
    }

    setErr(null);
    setBusy(true);
    try {
      const url = await uploadSmart("audio", f);
      if (!url) throw new Error("UPLOAD_OK_NO_URL");
      const msg = await sendMessage(convId, `[audio] ${url}`);
      try {
        onMessageCreated?.(msg);
      } catch {}
      focusComposer();
    } catch (e2: any) {
      setErr(String(e2?.message || tr("chatVoiceError", "Errore invio audio")));
    } finally {
      setBusy(false);
    }
  }

  async function startRecordingMediaRecorder() {
    if (recording) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      setErr(tr("chatMicNotSupported", "Microfono non supportato su questo dispositivo."));
      return;
    }

    setErr(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const MR: any = (window as any).MediaRecorder;
      const mimeType = pickBestMimeType();
      const mr: MediaRecorder = new MR(stream, mimeType ? { mimeType } : undefined);

      chunksRef.current = [];
      mr.ondataavailable = (ev: any) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      mr.onstop = async () => {
        try {
          stream.getTracks().forEach((tt: any) => tt.stop());

          const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
          chunksRef.current = [];

          if (!convId) return;

          if (!blob || blob.size === 0) {
            setErr("Audio vuoto: registra almeno 1-2 secondi.");
            return;
          }

          setBusy(true);
          const ext = extFromMime(mr.mimeType || "");
          const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mr.mimeType || "audio/webm" });

          const url = await uploadSmart("audio", file);
          if (!url) throw new Error("UPLOAD_OK_NO_URL");
          const msg = await sendMessage(convId, `[audio] ${url}`);
          try {
            onMessageCreated?.(msg);
          } catch {}
          focusComposer();
        } catch (e: any) {
          setErr(String(e?.message || tr("chatVoiceError", "Errore invio audio")));
        } finally {
          setBusy(false);
          setRecording(false);
          mediaRecorderRef.current = null;
        }
      };

      mediaRecorderRef.current = mr;

      // timeslice per evitare blob vuoti
      mr.start(250);
      setRecording(true);
    } catch (e: any) {
      setErr(String(e?.message || tr("chatCannotStartRecording", "Impossibile avviare la registrazione")));
    }
  }

  function stopRecording() {
    const mr = mediaRecorderRef.current as any;
    if (!mr) return;
    try {
      mr.requestData?.();
      mr.stop();
    } catch {
      // ignore
    }
  }

  function handleMicClick() {
    if (busy) return;

    if (!convId) {
      setErr(tr("chatMissingConversationVoice", "Seleziona una chat prima di inviare un audio."));
      return;
    }

    if (recording) {
      stopRecording();
      return;
    }

    // iPhone: usa capture input (più stabile)
    if (!canUseMediaRecorder()) {
      setErr(null);
      voiceInputRef.current?.click();
      return;
    }

    startRecordingMediaRecorder();
  }

  const header: React.CSSProperties = {
    padding: 10,
    borderBottom: "1px solid #222",
    background: "var(--tiko-bg-card)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
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

  const iconBtn: React.CSSProperties = {
    width: 42,
    height: 42,
    minWidth: 42,
    minHeight: 42,
    flex: "0 0 42px",
    padding: 0,
    borderRadius: 14,
    border: "1px solid #2a2a2a",
    background: "transparent",
    color: "var(--tiko-text)",
    cursor: "pointer",
    fontWeight: 950,
    fontSize: 18,
    lineHeight: "1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const bubbleBase: React.CSSProperties = {
    maxWidth: "82%",
    borderRadius: 16,
    padding: "10px 12px",
    border: "1px solid #232323",
    background: "var(--tiko-bg-card)",
    color: "var(--tiko-text)",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {onBack ? (
            <button
              type="button"
              style={headerBtn}
              onClick={onBack}
              aria-label={tr("genericBack", "Indietro")}
              title={tr("genericBack", "Indietro")}
            >
              ←
            </button>
          ) : null}

          <div style={{ fontWeight: 950, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title}
          </div>
        </div>
      </div>

      <div
        ref={listRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          overscrollBehavior: "contain",
        }}
      >
        {sorted.map((m) => {
          const mine = Number(m?.senderId || m?.sender?.id || 0) === myId;
          const content = String(m?.content || "");
          const parsed = parseTaggedContent(content);

          // render “furbo” anche per vecchi messaggi [file] con immagini/audio
          if (parsed.kind === "file") {
            let displayName = parsed.name || "File";
            try {
              if (displayName.includes("%")) displayName = decodeURIComponent(displayName);
            } catch {
              // ignore
            }

            const url = resolveMediaUrl(parsed.url);

            const fileLooksImage = looksLikeImageByName(displayName) || looksLikeImageUrl(url);
            const fileLooksAudio = looksLikeAudioByName(displayName) || looksLikeAudioUrl(url);

            return (
              <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
                <div style={{ ...bubbleBase }}>
                  {fileLooksImage ? (
                    <img src={url} alt="img" style={{ maxWidth: "100%", borderRadius: 12, display: "block" }} />
                  ) : fileLooksAudio ? (
                    <>
                      <audio controls src={url} style={{ width: "100%" }} preload="metadata" />
                      <div style={{ marginTop: 6 }}>
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--tiko-mint)", fontWeight: 900, fontSize: 12 }}
                        >
                          Apri/Scarica audio
                        </a>
                      </div>
                    </>
                  ) : (
                    <a href={url} target="_blank" rel="noreferrer" style={{ color: "var(--tiko-mint)", fontWeight: 950 }}>
                      {displayName}
                    </a>
                  )}
                </div>
              </div>
            );
          }

          if (parsed.kind === "img") {
            const url = resolveMediaUrl(parsed.url);
            return (
              <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
                <div style={{ ...bubbleBase }}>
                  <img src={url} alt="img" style={{ maxWidth: "100%", borderRadius: 12, display: "block" }} />
                </div>
              </div>
            );
          }

          if (parsed.kind === "audio") {
            const url = resolveMediaUrl(parsed.url);
            return (
              <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
                <div style={{ ...bubbleBase }}>
                  {url ? (
                    <>
                      <audio controls src={url} style={{ width: "100%" }} preload="metadata" />
                      <div style={{ marginTop: 6 }}>
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--tiko-mint)", fontWeight: 900, fontSize: 12 }}
                        >
                          Apri/Scarica audio
                        </a>
                      </div>
                    </>
                  ) : (
                    <div style={{ color: "var(--tiko-text-dim)" }}>Audio non disponibile</div>
                  )}
                </div>
              </div>
            );
          }

          // text
          return (
            <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
              <div style={{ ...bubbleBase }}>{(parsed as any).text}</div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          padding: 10,
          paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
          borderTop: "1px solid #222",
          background: "var(--tiko-bg-gray)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {err ? (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #3a1f1f",
              background: "rgba(255,59,48,0.08)",
              color: "#ff6b6b",
              fontWeight: 900,
            }}
          >
            {err}
          </div>
        ) : null}

        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || !convId}
            style={iconBtn}
            title={tr("chatUploadFile", "Invia file")}
            aria-label={tr("chatUploadFile", "Invia file")}
          >
            📎
          </button>

          <button
            type="button"
            onClick={handleMicClick}
            disabled={busy || !convId}
            style={{
              ...iconBtn,
              background: recording ? "rgba(255,59,48,0.18)" : "transparent",
            }}
            title={recording ? tr("chatStopRecording", "Stop") : tr("chatStartRecording", "Microfono")}
            aria-label={tr("chatMicrophone", "Microfono")}
          >
            🎙️
          </button>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={tr("chatWriteMessagePlaceholder", "Scrivi un messaggio…")}
            rows={1}
            // IMPORTANT: NON disabilitare quando busy, altrimenti su iPhone la tastiera si chiude
            disabled={!convId}
            style={{
              flex: 1,
              minWidth: 0,
              resize: "none",
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid #2a2a2a",
              background: "var(--tiko-bg-dark)",
              color: "var(--tiko-text)",
              outline: "none",
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />

          <button
            type="button"
            // mantieni focus in textarea su iPhone
            onPointerDown={keepComposerFocused}
            onMouseDown={keepComposerFocused}
            onTouchStart={keepComposerFocused}
            onClick={handleSend}
            disabled={busy || !text.trim() || !convId}
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid var(--tiko-mint)",
              background: "var(--tiko-mint)",
              color: "#000",
              cursor: "pointer",
              fontWeight: 950,
              flex: "0 0 auto",
            }}
          >
            {tr("chatSend", "Invia")}
          </button>

          <input ref={fileInputRef} type="file" accept="*/*" style={{ display: "none" }} onChange={handleFileSelected} />

          <input
            ref={voiceInputRef}
            type="file"
            accept="audio/*"
            {...({ capture: "microphone" } as any)}
            style={{ display: "none" }}
            onChange={handleVoiceSelected}
          />
        </div>

        {recording ? (
          <div style={{ fontSize: 12, color: "var(--tiko-text-dim)" }}>
            {tr("chatRecordingHint", "Registrazione in corso…")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
