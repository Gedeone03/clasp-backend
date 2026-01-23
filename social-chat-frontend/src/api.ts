import axios, { AxiosInstance } from "axios";
import { API_BASE_URL } from "./config";

/* =======================
   TOKEN
======================= */
function normalizeToken(raw: unknown): string {
  let t = String(raw ?? "").trim();
  if (!t) return "";
  if (t.toLowerCase().startsWith("bearer ")) t = t.slice(7).trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) t = t.slice(1, -1).trim();
  return t;
}

/**
 * ✅ Importante: qui leggiamo TUTTE le chiavi comuni,
 * perché in alcune versioni il token viene salvato come "jwt".
 */
export function getAuthToken(): string {
  const raw =
    localStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    localStorage.getItem("accessToken") ||
    localStorage.getItem("jwt") ||
    localStorage.getItem("clasp.token") ||
    localStorage.getItem("clasp.jwt") ||
    "";
  return normalizeToken(raw);
}

export function loadAuthTokenFromStorage() {
  const t = getAuthToken();
  if (t) {
    api.defaults.headers.common["Authorization"] = `Bearer ${t}`;
    axios.defaults.headers.common["Authorization"] = `Bearer ${t}`;
  } else {
    delete api.defaults.headers.common["Authorization"];
    delete axios.defaults.headers.common["Authorization"];
  }
}

export function setAuthToken(token: string | null) {
  const clean = normalizeToken(token);

  if (clean) {
    // ✅ scrivo su più chiavi per compatibilità tra versioni
    localStorage.setItem("token", clean);
    localStorage.setItem("authToken", clean);
    localStorage.setItem("accessToken", clean);
    localStorage.setItem("jwt", clean);
    localStorage.setItem("clasp.token", clean);
    localStorage.setItem("clasp.jwt", clean);
  } else {
    localStorage.removeItem("token");
    localStorage.removeItem("authToken");
    localStorage.removeItem("accessToken");
    localStorage.removeItem("jwt");
    localStorage.removeItem("clasp.token");
    localStorage.removeItem("clasp.jwt");
  }

  loadAuthTokenFromStorage();
}

/* =======================
   AXIOS INSTANCE
======================= */
export const api: AxiosInstance = axios.create({
  baseURL: (API_BASE_URL || "").replace(/\/+$/, ""),
  timeout: 20000,
});

api.interceptors.request.use((config) => {
  const token = getAuthToken();

  // ✅ Garantisce che OGNI richiesta parta col token (se presente)
  if (token) {
    config.headers = config.headers || {};
    (config.headers as any)["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

// Opzionale: se il backend risponde "Token mancante" / 401, puoi forzare logout.
// Non tocca la grafica, ma evita stati "mezzi loggati".
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status;
    const msg = String(error?.response?.data?.error || error?.response?.data?.message || error?.message || "");
    if (status === 401 && msg.toLowerCase().includes("token")) {
      // non cancelliamo automaticamente per non rompere flusso,
      // ma almeno l'errore che vedi sarà coerente.
    }
    return Promise.reject(error);
  }
);

loadAuthTokenFromStorage();
export default api;

/* =======================
   TYPES
======================= */
export interface User {
  id: number;
  email: string;
  username: string;
  displayName: string;
  state?: string | null;
  statusText?: string | null;
  city?: string | null;
  area?: string | null;
  interests?: string | null;
  mood?: string | null;
  avatarUrl?: string | null;
  termsAccepted?: boolean | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ConversationParticipant {
  id: number;
  userId: number;
  conversationId: number;
  joinedAt?: string;
  user?: User;
}

export interface Conversation {
  id: number;
  participants: ConversationParticipant[];
  lastMessage?: Message | null;
}

export interface Message {
  id: number;
  content: string;
  createdAt: string;
  senderId: number;
  conversationId: number;
  editedAt?: string | null;
  deletedAt?: string | null;
  replyToId?: number | null;
  sender?: User;
}

/* =======================
   AUTH
======================= */
export async function register(data: {
  email: string;
  password: string;
  displayName: string;
  username: string;
  city?: string | null;
  area?: string | null;
  termsAccepted?: boolean;
}): Promise<AuthResponse> {
  const res = await api.post<AuthResponse>("/auth/register", data);

  // ✅ assicurati che il token venga salvato
  if (res?.data?.token) setAuthToken(res.data.token);

  return res.data;
}

export async function login(data: { emailOrUsername: string; password: string }): Promise<AuthResponse> {
  const res = await api.post<AuthResponse>("/auth/login", data);

  // ✅ assicurati che il token venga salvato
  if (res?.data?.token) setAuthToken(res.data.token);

  return res.data;
}

export async function fetchMe(): Promise<User> {
  const res = await api.get<User>("/me");
  return res.data;
}

export async function patchMe(data: Partial<User>): Promise<User> {
  const res = await api.patch<User>("/me", data);
  return res.data;
}

/* =======================
   UPLOAD
======================= */
async function uploadMultipart(path: string, field: string, file: File): Promise<string> {
  const fd = new FormData();
  fd.append(field, file);

  const res = await api.post(path, fd, { headers: { "Content-Type": "multipart/form-data" } });
  const data: any = res.data || {};
  const url = data.url || data.fileUrl || data.path || data.avatarUrl;
  if (!url) throw new Error("Risposta upload non valida: manca url.");
  return String(url);
}

export async function uploadImage(file: File): Promise<{ url: string }> {
  const url = await uploadMultipart("/upload/image", "image", file);
  return { url };
}

export async function uploadFile(file: File): Promise<{ url: string }> {
  try {
    const url = await uploadMultipart("/upload/file", "file", file);
    return { url };
  } catch {
    const url = await uploadMultipart("/upload/image", "image", file);
    return { url };
  }
}

export async function uploadAudio(file: File): Promise<{ url: string }> {
  try {
    const url = await uploadMultipart("/upload/audio", "audio", file);
    return { url };
  } catch {
    const up = await uploadFile(file);
    return { url: up.url };
  }
}

export async function uploadAvatar(file: File): Promise<{ ok?: boolean; avatarUrl: string; user?: User }> {
  const fd = new FormData();
  fd.append("avatar", file);
  const res = await api.post("/upload/avatar", fd, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data;
}

/* =======================
   SEARCH USERS
======================= */
export async function searchUsers(params: {
  q?: string;
  city?: string;
  area?: string;
  mood?: string;
  state?: string;
  visibleOnly?: boolean;
}): Promise<User[]> {
  const res = await api.get<User[]>("/users/search", { params });
  return res.data;
}

/* =======================
   FRIENDS
======================= */
export async function fetchFriends(): Promise<User[]> {
  const res = await api.get<User[]>("/friends");
  return res.data;
}

export async function fetchFriendRequestsReceived(): Promise<any[]> {
  const res = await api.get<any[]>("/friends/requests/received");
  return res.data;
}

export async function fetchFriendRequestsSent(): Promise<any[]> {
  const res = await api.get<any[]>("/friends/requests/sent");
  return res.data;
}

export type SendFriendRequestResult = {
  ok: true;
  status: "sent" | "already" | "already_friends";
  message?: string;
};

function extractApiError(e: any): { status?: number; message: string } {
  const status = e?.response?.status;
  const data = e?.response?.data;
  const msg = data?.error || data?.message || e?.message || "Errore invio richiesta";
  return { status, message: String(msg) };
}

/**
 * ✅ Invio richiesta amicizia con:
 * - token sempre allegato via interceptor
 * - body compatibile con backend diversi
 * - gestione 409 come "già inviato/già amici"
 */
export async function sendFriendRequest(userId: number): Promise<SendFriendRequestResult> {
  const uid = Number(userId);
  if (!uid || Number.isNaN(uid)) throw new Error("userId non valido");

  const body = {
    userId: uid,
    otherUserId: uid,
    receiverId: uid,
    targetUserId: uid,
    toUserId: uid,
  };

  const paths = ["/friends/requests", "/friend-requests", "/friends/request"];

  let lastErr: any = null;

  for (const path of paths) {
    try {
      await api.post(path, body);
      return { ok: true, status: "sent" };
    } catch (e: any) {
      lastErr = e;
      const { status, message } = extractApiError(e);

      if (status === 409) {
        const low = message.toLowerCase();
        const alreadyFriends =
          low.includes("già amici") ||
          low.includes("gia amici") ||
          (low.includes("already") && low.includes("friends"));
        return { ok: true, status: alreadyFriends ? "already_friends" : "already", message };
      }

      // prova endpoint alternativi
      if (status === 404 || status === 400) continue;

      // token mancante / auth: propaga messaggio leggibile
      if (status === 401) {
        throw new Error(message || "Token mancante");
      }

      throw new Error(message || `HTTP ${status || "ERR"}`);
    }
  }

  const { status, message } = extractApiError(lastErr);
  throw new Error(status ? `${message} (HTTP ${status})` : message);
}

export async function acceptFriendRequest(requestId: number): Promise<void> {
  await api.post(`/friends/requests/${requestId}/accept`);
}

export async function declineFriendRequest(requestId: number): Promise<void> {
  await api.post(`/friends/requests/${requestId}/decline`);
}

/* =======================
   CONVERSATIONS + MESSAGES
======================= */
export async function fetchConversations(): Promise<Conversation[]> {
  const res = await api.get<Conversation[]>("/conversations");
  return res.data;
}

export async function createConversation(otherUserId: number): Promise<Conversation> {
  const res = await api.post<Conversation>("/conversations", { otherUserId });
  return res.data;
}

export async function deleteConversation(conversationId: number): Promise<void> {
  await api.delete(`/conversations/${conversationId}`);
}

export async function fetchMessages(conversationId: number): Promise<Message[]> {
  const res = await api.get<Message[]>(`/conversations/${conversationId}/messages`);
  return res.data;
}

export async function sendMessage(
  conversationId: number,
  content: string,
  replyToId?: number | null
): Promise<Message> {
  const body = {
    content,
    text: content,
    message: content,
    replyToId: replyToId ?? null,
    conversationId,
  };

  try {
    const res = await api.post<Message>(`/conversations/${conversationId}/messages`, body);
    return res.data;
  } catch (e: any) {
    const status = e?.response?.status;
    if (axios.isAxiosError(e) && status === 404) {
      const res2 = await api.post<Message>(`/messages`, body);
      return res2.data;
    }
    throw e;
  }
}

export async function editMessage(messageId: number, content: string): Promise<Message> {
  const res = await api.patch<Message>(`/messages/${messageId}`, { content, text: content, message: content });
  return res.data;
}

export async function deleteMessage(messageId: number): Promise<Message> {
  const res = await api.delete<Message>(`/messages/${messageId}`);
  return res.data;
}
