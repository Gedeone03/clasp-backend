const DEFAULT_PROD_API = "https://clasp-backend-production.up.railway.app";
const DEFAULT_DEV_API = "http://localhost:4000";

function inferDefaultApiBaseUrl(): string {
  // Se sei in locale: usa localhost
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return DEFAULT_DEV_API;
  }
  // Se sei online: usa Railway
  return DEFAULT_PROD_API;
}

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || inferDefaultApiBaseUrl()).replace(/\/+$/, "");

// websocket base (ws / wss coerente)
export const WS_BASE_URL = (import.meta.env.VITE_WS_BASE_URL || API_BASE_URL)
  .replace(/^https:/, "wss:")
  .replace(/^http:/, "ws:")
  .replace(/\/+$/, "");
