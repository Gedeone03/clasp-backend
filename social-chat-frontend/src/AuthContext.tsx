import React, { createContext, useContext, useEffect, useState } from "react";
import {
  AuthResponse,
  User,
  login as apiLogin,
  register as apiRegister,
  fetchMe,
  loadAuthTokenFromStorage,
  setAuthToken,
} from "./api";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (emailOrUsername: string, password: string) => Promise<void>;
  register: (data: any) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
  setUser: (u: User | null) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshMe() {
    const me = await fetchMe();
    setUser(me);
    try { localStorage.setItem("user", JSON.stringify(me)); } catch {}
  }

  useEffect(() => {
    // ✅ ripristina token e applica Authorization all'avvio
    loadAuthTokenFromStorage();

    (async () => {
      try {
        // se token valido, /me funziona e popola user
        await refreshMe();
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAuthSuccess(data: AuthResponse) {
    setAuthToken(data.token);
    setUser(data.user);
    try { localStorage.setItem("user", JSON.stringify(data.user)); } catch {}
  }

  const login = async (emailOrUsername: string, password: string) => {
    setLoading(true);
    try {
      const data = await apiLogin({ emailOrUsername, password });
      handleAuthSuccess(data);

      // ✅ conferma immediata che il token è valido lato backend
      try { await refreshMe(); } catch {}
    } finally {
      setLoading(false);
    }
  };

  const register = async (data: any) => {
    setLoading(true);
    try {
      const resp = await apiRegister(data);
      handleAuthSuccess(resp);

      try { await refreshMe(); } catch {}
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setAuthToken(null);
    setUser(null);
    try { localStorage.removeItem("user"); } catch {}
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshMe, setUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
