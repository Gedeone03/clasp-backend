import React, { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { API_BASE_URL } from "../../config";
import { useAuth } from "../../AuthContext";
import { useI18n } from "../../LanguageContext";

function useIsMobile(breakpointPx = 1100) {
  const compute = () => {
    const coarse =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;

    const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
    const uaMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);

    return coarse || uaMobile || window.innerWidth < breakpointPx;
  };

  const [isMobile, setIsMobile] = useState(compute);

  useEffect(() => {
    const onResize = () => setIsMobile(compute());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return isMobile;
}

function ClaspLogo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
      <circle cx="256" cy="256" r="240" fill="#121218" />
      <path
        d="
          M 344 172
          Q 304 132 244 132
          Q 150 132 150 256
          Q 150 380 244 380
          Q 304 380 344 340
          A 26 26 0 0 0 342 300
          Q 326 284 308 300
          Q 284 324 244 324
          Q 192 324 192 256
          Q 192 188 244 188
          Q 284 188 308 212
          Q 326 228 342 212
          A 26 26 0 0 0 344 172
        "
        fill="#7A29FF"
      />
      <circle cx="344" cy="214" r="26" fill="#3ABEFF" />
    </svg>
  );
}

const STATE_UI: Record<string, { label: string; color: string }> = {
  DISPONIBILE: { label: "Disponibile", color: "#2ecc71" },
  OCCUPATO: { label: "Occupato", color: "#ff3b30" },
  ASSENTE: { label: "Assente", color: "#f39c12" },
  OFFLINE: { label: "Offline", color: "#95a5a6" },
  INVISIBILE: { label: "Invisibile", color: "#9b59b6" },
  VISIBILE_A_TUTTI: { label: "Visibile a tutti", color: "#3ABEFF" },

  ONLINE: { label: "Disponibile", color: "#2ecc71" },
  AWAY: { label: "Assente", color: "#f39c12" },
};

function stateLabel(t: (key: string) => string, state?: string | null) {
  if (!state) return "—";
  const k = `state_${state}`;
  const out = t(k);
  if (out !== k) return out;
  return STATE_UI[state]?.label ?? state;
}
function stateColor(state?: string | null) {
  if (!state) return "#666";
  return STATE_UI[state]?.color ?? "#666";
}

function initials(name?: string | null) {
  const n = (name || "").trim();
  if (!n) return "U";
  const parts = n.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

function resolveUrl(url?: string | null) {
  if (!url) return "";
  let t = String(url).trim();
  if (!t) return "";

  // se è un path relativo, aggancia al backend
  if (t.startsWith("/")) {
    t = `${API_BASE_URL.replace(/\/+$/, "")}${t}`;
  }

  // fix mixed-content: se la pagina è https e l'URL è http, forza https
  if (typeof window !== "undefined" && window.location.protocol === "https:" && t.startsWith("http://")) {
    t = t.replace(/^http:\/\//i, "https://");
  }

  return t;
}


function readUnreadTotal(): number {
  try {
    const raw = localStorage.getItem("clasp.unreadCounts");
    if (!raw) return 0;
    const m = JSON.parse(raw) as Record<string, number>;
    return Object.values(m || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  } catch {
    return 0;
  }
}

function readFriendBadge(): number {
  try {
    const v = localStorage.getItem("clasp.friendReqBadge");
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function Badge({ value }: { value: number }) {
  if (!value || value <= 0) return null;
  return (
    <div
      style={{
        minWidth: 22,
        height: 22,
        padding: "0 7px",
        borderRadius: 999,
        background: "#ff3b30",
        color: "#fff",
        fontSize: 12,
        fontWeight: 950,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {value > 99 ? "99+" : value}
    </div>
  );
}

export default function Sidebar() {
  const { t } = useI18n();
  const isMobile = useIsMobile(1100);
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const location = useLocation();

  const [drawerOpen, setDrawerOpen] = useState(false);

  const [unreadTotal, setUnreadTotal] = useState(readUnreadTotal());
  const [friendBadge, setFriendBadge] = useState(readFriendBadge());

  useEffect(() => {
    const refresh = () => {
      setUnreadTotal(readUnreadTotal());
      setFriendBadge(readFriendBadge());
    };

    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("clasp:badge", refresh);

    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("clasp:badge", refresh);
    };
  }, []);

  useEffect(() => {
    if (drawerOpen) setDrawerOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  const avatarUrl = resolveUrlMaybeBackend((user as any)?.avatarUrl);

  const baseItemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 12,
    textDecoration: "none",
    color: "var(--tiko-text)",
    border: "1px solid #222",
    marginBottom: 10,
    fontWeight: 800,
  };

  const activeBg = "var(--tiko-bg-card)";

  const HeaderBlock = (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: 12, overflow: "hidden" }}>
        <ClaspLogo size={34} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <div style={{ fontWeight: 950, fontSize: 18 }}>Clasp</div>
        <div style={{ fontSize: 12, color: "var(--tiko-text-dim)" }}>social chat</div>
      </div>
    </div>
  );

  const UserBlock = (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        borderRadius: 14,
        background: "var(--tiko-bg-card)",
        border: "1px solid #222",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div style={{ position: "relative", width: 44, height: 44, flexShrink: 0 }}>
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt="avatar"
            width={44}
            height={44}
            style={{ width: 44, height: 44, borderRadius: 999, objectFit: "cover", border: "1px solid #333", display: "block" }}
            onError={(e) => ((e.currentTarget as any).style.display = "none")}
          />
        ) : (
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              background: "#1f1f26",
              border: "1px solid #333",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 950,
            }}
          >
            {initials(user?.displayName)}
          </div>
        )}

        <div
          title={stateLabel(t, (user as any)?.state)}
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: 14,
            height: 14,
            borderRadius: 999,
            background: stateColor((user as any)?.state),
            border: "2px solid var(--tiko-bg-card)",
          }}
        />
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 950, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {user?.displayName || t("genericUser")}
        </div>
        <div style={{ fontSize: 12, color: "var(--tiko-text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          @{user?.username || "—"}
        </div>
      </div>
    </div>
  );

  const DesktopNav = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
      <NavLink to="/" style={({ isActive }) => ({ ...baseItemStyle, background: isActive ? activeBg : "transparent" })}>
        <span>{t("navHome")}</span>
        <Badge value={unreadTotal} />
      </NavLink>

      <NavLink to="/friends" style={({ isActive }) => ({ ...baseItemStyle, background: isActive ? activeBg : "transparent" })}>
        <span>{t("navFriends")}</span>
        <Badge value={friendBadge} />
      </NavLink>

      <NavLink to="/profile" style={({ isActive }) => ({ ...baseItemStyle, background: isActive ? activeBg : "transparent" })}>
        <span>{t("navProfile")}</span>
      </NavLink>

      <NavLink to="/settings" style={({ isActive }) => ({ ...baseItemStyle, background: isActive ? activeBg : "transparent" })}>
        <span>{t("navSettings")}</span>
      </NavLink>

      <NavLink to="/terms" style={({ isActive }) => ({ ...baseItemStyle, background: isActive ? activeBg : "transparent" })}>
        <span>{t("navTerms")}</span>
      </NavLink>

      <NavLink to="/privacy" style={({ isActive }) => ({ ...baseItemStyle, background: isActive ? activeBg : "transparent" })}>
        <span>{t("navPrivacy")}</span>
      </NavLink>

      <button
        onClick={() => {
          logout();
          nav("/auth");
        }}
        style={{
          ...baseItemStyle,
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span>{t("navLogout")}</span>
      </button>
    </div>
  );

  if (!isMobile) {
    return (
      <div style={{ width: 300, padding: 14, background: "var(--tiko-bg-gray)", borderRight: "1px solid #222", overflowY: "auto" }}>
        {HeaderBlock}
        {UserBlock}
        {DesktopNav}
      </div>
    );
  }

  // Mobile: header minimal + drawer
  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          height: 58,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
          borderBottom: "1px solid #222",
          background: "var(--tiko-bg-gray)",
        }}
      >
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ClaspLogo size={28} />
          <div style={{ fontWeight: 950 }}>Clasp</div>
        </Link>

        <button
          onClick={() => setDrawerOpen((v) => !v)}
          style={{
            padding: "8px 10px",
            borderRadius: 12,
            border: "1px solid #222",
            background: "transparent",
            color: "var(--tiko-text)",
            fontWeight: 950,
          }}
        >
          ☰
        </button>
      </div>

      {drawerOpen && (
        <div style={{ padding: 12, background: "var(--tiko-bg-dark)", borderBottom: "1px solid #222" }}>
          {UserBlock}
          <div style={{ marginTop: 12 }}>
            <NavLink to="/" style={({ isActive }) => ({ ...baseItemStyle, background: isActive ? activeBg : "transparent" })}>
              <span>{t("navHome")}</span>
              <Badge value={unreadTotal} />
            </NavLink>

            <NavLink to="/friends" style={({ isActive }) => ({ ...baseItemStyle, background: isActive ? activeBg : "transparent" })}>
              <span>{t("navFriends")}</span>
              <Badge value={friendBadge} />
            </NavLink>

            <NavLink to="/profile" style={({ isActive }) => ({ ...baseItemStyle, background: isActive ? activeBg : "transparent" })}>
              <span>{t("navProfile")}</span>
            </NavLink>

            <NavLink to="/settings" style={({ isActive }) => ({ ...baseItemStyle, background: isActive ? activeBg : "transparent" })}>
              <span>{t("navSettings")}</span>
            </NavLink>

            <NavLink to="/terms" style={({ isActive }) => ({ ...baseItemStyle, background: isActive ? activeBg : "transparent" })}>
              <span>{t("navTerms")}</span>
            </NavLink>

            <NavLink to="/privacy" style={({ isActive }) => ({ ...baseItemStyle, background: isActive ? activeBg : "transparent" })}>
              <span>{t("navPrivacy")}</span>
            </NavLink>

            <button
              onClick={() => {
                logout();
                nav("/auth");
              }}
              style={{
                ...baseItemStyle,
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span>{t("navLogout")}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
