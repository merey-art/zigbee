import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { WsProvider, useDashboardWs, isSensorMessage } from "../context/WsContext";
import { apiFetch } from "../api/client";
import i18n from "../i18n";
import type { SensorMessage } from "../hooks/useWebSocket";

const C = {
  panel:     "#0f172a",
  card:      "#1e293b",
  border:    "#334155",
  borderSub: "#1f2a3d",
  text:      "#f1f5f9",
  muted:     "#94a3b8",
  dim:       "#64748b",
  accent:    "#38bdf8",
  ok:        "#4ade80",
  warn:      "#facc15",
  danger:    "#f87171",
};

const LANGS = [
  { code: "ru", label: "RU" },
  { code: "kz", label: "KZ" },
  { code: "en", label: "EN" },
];

function useActiveAlertCount(): number {
  const { subscribeMessages } = useDashboardWs();
  const [liveValues, setLiveValues] = useState<Record<string, Record<string, number>>>({});
  const [rules, setRules] = useState<Array<{ device_id: string | null; metric: string; direction: string; threshold: number; enabled: boolean }>>([]);
  const [devices, setDevices] = useState<Array<{ device_id: string; metrics: string[]; latest_values?: Record<string, number> }>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [rr, dr] = await Promise.all([
        apiFetch("/alert-rules").catch(() => null),
        apiFetch("/devices").catch(() => null),
      ]);
      if (cancelled) return;
      if (rr?.ok) setRules(await rr.json());
      if (dr?.ok) setDevices(await dr.json());
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => subscribeMessages(raw => {
    if (!isSensorMessage(raw)) return;
    const msg = raw as SensorMessage;
    setLiveValues(prev => ({ ...prev, [msg.device_id]: { ...(prev[msg.device_id] ?? {}), ...msg.data } }));
  }), [subscribeMessages]);

  return rules.reduce((count, rule) => {
    if (!rule.enabled) return count;
    const targets = rule.device_id
      ? devices.filter(d => d.device_id === rule.device_id)
      : devices.filter(d => d.metrics?.includes(rule.metric));
    for (const d of targets) {
      const val = liveValues[d.device_id]?.[rule.metric] ?? d.latest_values?.[rule.metric] ?? null;
      if (val === null) continue;
      if (rule.direction === "above" ? val > rule.threshold : val < rule.threshold) count++;
    }
    return count;
  }, 0);
}

function SidebarInner({ menuOpen, setMenuOpen }: { menuOpen: boolean; setMenuOpen: (v: boolean) => void }) {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const { status: wsStatus } = useDashboardWs();
  const location = useLocation();
  const activeAlerts = useActiveAlertCount();
  const [currentLang, setCurrentLang] = useState(i18n.language);

  const wsColor = wsStatus === "open" ? C.ok : wsStatus === "connecting" ? C.warn : C.danger;

  const changeLang = (code: string) => {
    i18n.changeLanguage(code);
    localStorage.setItem("lang", code);
    setCurrentLang(code);
  };

  const WORKSPACE_NAV = [
    { to: "/dashboard",  label: t("nav.dashboard"), icon: "⚡" },
    { to: "/floor-map",  label: t("nav.floorMap"),  icon: "🗺️" },
    { to: "/devices",    label: t("nav.devices"),   icon: "📟" },
    { to: "/alerts",     label: t("nav.alerts"),    icon: "🔔" },
    { to: "/reports",    label: t("nav.reports"),   icon: "📈" },
  ];

  const SYSTEM_NAV = [
    { to: "/companies",  label: t("nav.offices"),   icon: "🏢" },
    { to: "/users",      label: t("nav.users"),     icon: "👥" },
    { to: "/logs",       label: t("nav.logs"),      icon: "📜" },
  ];

  const navItem = (to: string, icon: string, label: string, badge = 0) => {
    const active = location.pathname === to || location.pathname.startsWith(to + "/");
    return (
      <NavLink
        key={to}
        to={to}
        onClick={() => setMenuOpen(false)}
        style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "9px 12px", fontSize: 13.5, fontWeight: 500,
          textDecoration: "none", borderRadius: 6,
          transition: "background 120ms, color 120ms",
          cursor: "pointer", marginBottom: 2,
          background: active ? "rgba(56,189,248,0.12)" : "transparent",
          color: active ? C.text : C.muted,
          borderLeft: active ? `2px solid ${C.accent}` : "2px solid transparent",
          position: "relative",
        }}
      >
        <span style={{ width: 18, fontSize: 14, textAlign: "center" }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
        {badge > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999,
            background: C.danger + "33", color: C.danger, minWidth: 18, textAlign: "center",
          }}>{badge}</span>
        )}
      </NavLink>
    );
  };

  return (
    <aside
      className={`app-sidebar ${menuOpen ? "open" : ""}`}
      style={{
        width: 240, minWidth: 240, flexShrink: 0,
        background: C.panel,
        borderRight: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column",
        padding: "20px 0 16px",
        height: "100vh",
        position: "sticky", top: 0,
        boxSizing: "border-box",
      }}
    >
      {/* Brand */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "0 20px 24px",
        borderBottom: `1px solid ${C.borderSub}`,
        marginBottom: 18,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: "linear-gradient(135deg,#38bdf8 0%,#0e7490 100%)",
          display: "grid", placeItems: "center", fontSize: 18, flexShrink: 0,
        }}>⚡</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: "-0.01em" }}>Zigbee</div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>Sensor Dashboard</div>
        </div>
      </div>

      {/* Workspace nav */}
      <nav style={{ display: "flex", flexDirection: "column", padding: "0 12px" }}>
        <div style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em",
          color: C.dim, padding: "6px 10px 8px",
        }}>{t("nav.workspace")}</div>
        {WORKSPACE_NAV.map(item => navItem(
          item.to, item.icon, item.label,
          item.to === "/alerts" ? activeAlerts : 0,
        ))}
      </nav>

      {/* System nav */}
      <nav style={{ display: "flex", flexDirection: "column", padding: "0 12px", marginTop: 16 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em",
          color: C.dim, padding: "6px 10px 8px",
        }}>{t("nav.system")}</div>
        {SYSTEM_NAV.map(item => navItem(item.to, item.icon, item.label))}
      </nav>

      {/* Language switcher */}
      <div style={{ padding: "12px 16px 0", display: "flex", gap: 6, marginTop: "auto" }}>
        {LANGS.map(lang => (
          <button
            key={lang.code}
            type="button"
            onClick={() => changeLang(lang.code)}
            style={{
              flex: 1, padding: "5px 0", fontSize: 11, fontWeight: 700,
              borderRadius: 5, cursor: "pointer", border: "none",
              background: currentLang === lang.code ? C.accent + "22" : "transparent",
              color: currentLang === lang.code ? C.accent : C.dim,
              outline: currentLang === lang.code ? `1px solid ${C.accent}55` : "1px solid transparent",
              transition: "all 150ms",
            }}
          >{lang.label}</button>
        ))}
      </div>

      {/* Footer: WS status + user */}
      <div style={{
        padding: "16px 16px 0",
        borderTop: `1px solid ${C.borderSub}`, marginTop: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{
            width: 8, height: 8, borderRadius: 999,
            background: wsColor, boxShadow: `0 0 8px ${wsColor}`,
          }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: "0.05em" }}>
            MQTT {wsStatus.toUpperCase()}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 999,
            background: "#334155", color: C.text,
            display: "grid", placeItems: "center",
            fontSize: 11, fontWeight: 700, flexShrink: 0,
          }}>ZB</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{t("nav.hubAdmin")}</div>
            <button
              type="button"
              onClick={async () => { await logout(); }}
              style={{
                fontSize: 11, color: C.dim, background: "none", border: "none",
                padding: 0, cursor: "pointer", fontFamily: "inherit",
              }}
            >{t("nav.signOut")}</button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <WsProvider>
      <div style={{
        minHeight: "100vh",
        background: "#0b1220",
        color: "#f1f5f9",
        display: "flex",
        flexDirection: "row",
      }}>
        {/* Mobile toggle */}
        <button
          type="button"
          aria-label="Menu"
          onClick={() => setMenuOpen(o => !o)}
          className="sidebar-toggle"
          style={{
            display: "none",
            position: "fixed", top: 12, left: 12,
            zIndex: 30, padding: "8px 12px", borderRadius: 8,
            border: "1px solid #475569", background: "#1e293b",
            color: "#e2e8f0", cursor: "pointer",
          }}
        >☰</button>

        <SidebarInner menuOpen={menuOpen} setMenuOpen={setMenuOpen} />

        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Outlet />
        </main>

        <style>{`
          @media (max-width: 900px) {
            .sidebar-toggle { display: block !important; }
            .app-sidebar {
              position: fixed !important;
              z-index: 20; left: 0;
              transform: translateX(var(--sidebar-translate, -100%));
              transition: transform 0.2s ease;
            }
            .app-sidebar.open { --sidebar-translate: 0; box-shadow: 4px 0 24px rgba(0,0,0,0.4); }
          }
        `}</style>
      </div>
    </WsProvider>
  );
}
