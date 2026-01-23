import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";

import { AuthProvider } from "./AuthContext";
import { LanguageProvider } from "./LanguageContext";

import HomePage from "./pages/HomePage";
import AuthPage from "./pages/AuthPage";
import FriendsPage from "./pages/FriendsPage";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
import TermsPage from "./pages/TermsPage";
import PrivacyPage from "./pages/PrivacyPage";
import RealtimeBridge from "./components/RealtimeBridge";

/** Token robusto (compatibile con più chiavi usate nel progetto) */
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

/**
 * iOS/Safari fix: imposta --app-height con l’altezza reale (visualViewport)
 * Evita che la barra input “salti/scompaia” quando cambia la toolbar.
 */
function setupAppHeightVar() {
  if (typeof window === "undefined") return;

  const w = window as any;
  if (w.__claspAppHeightSetup) return; // evita doppio setup (StrictMode)
  w.__claspAppHeightSetup = true;

  const docEl = document.documentElement;

  const set = () => {
    const vv = window.visualViewport;
    const h = vv?.height || window.innerHeight || 0;
    if (!h) return;
    docEl.style.setProperty("--app-height", `${Math.round(h)}px`);
  };

  const rafSet = () => requestAnimationFrame(set);

  set();

  window.addEventListener("resize", rafSet);
  window.addEventListener("orientationchange", () => {
    // iOS spesso aggiorna l’altezza in ritardo: facciamo 2 colpi
    setTimeout(rafSet, 50);
    setTimeout(rafSet, 250);
  });

  window.addEventListener("pageshow", rafSet);

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", rafSet);
    window.visualViewport.addEventListener("scroll", rafSet);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") rafSet();
  });
}

setupAppHeightVar();

function RequireAuth({ children }: { children: JSX.Element }) {
  const token = getToken();
  return token ? (
    <>
      <RealtimeBridge />
      {children}
    </>
  ) : (
    <Navigate to="/auth" replace />
  );
}

function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <RequireAuth>
            <HomePage />
          </RequireAuth>
        }
      />

      <Route path="/auth" element={<AuthPage />} />

      <Route
        path="/friends"
        element={
          <RequireAuth>
            <FriendsPage />
          </RequireAuth>
        }
      />

      <Route
        path="/profile"
        element={
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        }
      />

      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />

      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <LanguageProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  </React.StrictMode>
);
