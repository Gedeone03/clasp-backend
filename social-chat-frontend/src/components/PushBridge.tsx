import { useEffect, useRef } from "react";
import { API_BASE_URL } from "../config";

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

function isStandaloneMode(): boolean {
  try {
    const mm = window.matchMedia?.("(display-mode: standalone)")?.matches;
    const iosStandalone = (navigator as any).standalone === true;
    return Boolean(mm || iosStandalone);
  } catch {
    return false;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/publicservice-worker.js", { scope: "/" });
    try {
      await reg.update();
    } catch {
      // ignore
    }
    return reg;
  } catch (e) {
    console.warn("SW_REGISTER_FAILED", e);
    return null;
  }
}

async function fetchVapidPublicKey(): Promise<string> {
  const res = await fetch(`${String(API_BASE_URL).replace(/\/+$/, "")}/push/publicKey`, {
    method: "GET",
  });

  if (!res.ok) return "";
  const j: any = await res.json().catch(() => ({}));
  const k = String(j?.publicKey || "").trim();
  return k;
}

async function sendSubscriptionToServer(subJson: any): Promise<void> {
  const token = getToken();
  if (!token) return;

  await fetch(`${String(API_BASE_URL).replace(/\/+$/, "")}/push/subscribe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ subscription: subJson }),
  }).catch(() => {});
}

async function ensurePushSubscribed(): Promise<void> {
  if (!("Notification" in window)) return;
  if (!("PushManager" in window)) return;

  // iOS: push solo se installata in Home Screen (standalone)
  if (isIOS() && !isStandaloneMode()) return;

  const reg = await registerSW();
  if (!reg) return;

  const publicKey = await fetchVapidPublicKey();
  if (!publicKey) return;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const subJson = (sub as any)?.toJSON ? (sub as any).toJSON() : sub;
  await sendSubscriptionToServer(subJson);
}

export default function PushBridge() {
  const askedRef = useRef(false);

  useEffect(() => {
    // Quando l’app torna visibile, proviamo a pulire il badge (se supportato)
    const clearBadge = async () => {
      const nav: any = navigator as any;
      if (typeof nav.clearAppBadge === "function") {
        try {
          await nav.clearAppBadge();
        } catch {
          // ignore
        }
      }
    };

    const onVis = () => {
      if (document.visibilityState === "visible") void clearBadge();
    };

    document.addEventListener("visibilitychange", onVis);
    void clearBadge();

    // Se già consentite, mi sottoscrivo subito
    if ("Notification" in window && Notification.permission === "granted") {
      void ensurePushSubscribed();
      return () => {
        document.removeEventListener("visibilitychange", onVis);
      };
    }

    // Se non ancora deciso: chiedo SOLO al primo tap/click (user activation)
    const askOnce = async () => {
      if (askedRef.current) return;
      askedRef.current = true;

      if (!("Notification" in window)) return;

      try {
        const perm = await Notification.requestPermission();
        if (perm === "granted") {
          await ensurePushSubscribed();
        }
      } catch {
        // ignore
      }
    };

    // user activation “universale”
    const opts: any = { once: true, passive: true };
    document.addEventListener("pointerdown", askOnce, opts);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("pointerdown", askOnce as any);
    };
  }, []);

  return null;
}
