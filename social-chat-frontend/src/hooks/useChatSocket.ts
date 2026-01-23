import { useEffect, useMemo, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { API_BASE_URL } from "../config";

export type MessageKind = "new" | "updated" | "deleted";
export type SocketMessageEvent = { kind: MessageKind; conversationId: number; message: any };

export type SocketEvents = {
  onMessage?: (evt: SocketMessageEvent) => void;
  onTyping?: (evt: { conversationId: number; userId: number }) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
};

export function useChatSocket(token: string | null, events: SocketEvents = {}) {
  const socketRef = useRef<Socket | null>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const baseUrl = useMemo(() => API_BASE_URL.replace(/\/$/, ""), []);

  useEffect(() => {
    if (!token) return;

    const socket = io(baseUrl, {
      auth: { token },
      transports: ["websocket", "polling"],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelayMax: 8000,
    });

    socketRef.current = socket;

    socket.on("connect", () => eventsRef.current.onConnect?.());
    socket.on("disconnect", () => eventsRef.current.onDisconnect?.());

    socket.on("message:new", (p: any) => eventsRef.current.onMessage?.({ kind: "new", conversationId: Number(p?.conversationId || 0), message: p?.message }));
    socket.on("message", (p: any) => eventsRef.current.onMessage?.({ kind: "new", conversationId: Number(p?.conversationId || 0), message: p?.message }));

    socket.on("message:updated", (p: any) => eventsRef.current.onMessage?.({ kind: "updated", conversationId: Number(p?.conversationId || 0), message: p?.message }));
    socket.on("message:deleted", (p: any) => eventsRef.current.onMessage?.({ kind: "deleted", conversationId: Number(p?.conversationId || 0), message: p?.message }));

    socket.on("typing", (p: any) => {
      const conversationId = Number(p?.conversationId || 0);
      const userId = Number(p?.userId || 0);
      if (conversationId && userId) eventsRef.current.onTyping?.({ conversationId, userId });
    });

    const onOnline = () => socket.connect();
    const onOffline = () => socket.disconnect();

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [baseUrl, token]);

  return useMemo(() => {
    return {
      joinConversation(conversationId: number) {
        socketRef.current?.emit("conversation:join", { conversationId });
      },
      leaveConversation(conversationId: number) {
        socketRef.current?.emit("conversation:leave", { conversationId });
      },
      sendTyping(conversationId: number) {
        socketRef.current?.emit("typing", { conversationId });
      },
    };
  }, []);
}
