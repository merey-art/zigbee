import React, { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { WsProvider } from "../context/WsContext";

const navLinkStyle = ({
  isActive,
}: {
  isActive: boolean;
}): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 14px",
  borderRadius: 10,
  textDecoration: "none",
  color: isActive ? "#f8fafc" : "#94a3b8",
  background: isActive ? "#334155" : "transparent",
  fontWeight: isActive ? 600 : 500,
  fontSize: 14,
});

export function AppLayout() {
  const { logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    setMenuOpen(false);
  };

  return (
    <WsProvider>
      <div
        style={{
          minHeight: "100vh",
          background: "#0f172a",
          color: "#f1f5f9",
          display: "flex",
          flexDirection: "row",
        }}
      >
        {/* Mobile menu toggle */}
        <button
          type="button"
          aria-label="Menu"
          onClick={() => setMenuOpen((o) => !o)}
          style={{
            display: "none",
            position: "fixed",
            top: 12,
            left: 12,
            zIndex: 30,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #475569",
            background: "#1e293b",
            color: "#e2e8f0",
            cursor: "pointer",
          }}
          className="sidebar-toggle"
        >
          ☰
        </button>

        <aside
          style={{
            width: 220,
            flexShrink: 0,
            background: "#1e293b",
            borderRight: "1px solid #334155",
            padding: "20px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            position: "sticky",
            top: 0,
            alignSelf: "flex-start",
            minHeight: "100vh",
            boxSizing: "border-box",
          }}
          className={`app-sidebar ${menuOpen ? "open" : ""}`}
        >
          <div style={{ padding: "8px 10px 18px", fontWeight: 700, fontSize: 15 }}>
            ⚡ Zigbee
          </div>
          <NavLink to="/dashboard" style={navLinkStyle} onClick={() => setMenuOpen(false)}>
            <span>📊</span> Dashboard
          </NavLink>
          <NavLink to="/devices" style={navLinkStyle} onClick={() => setMenuOpen(false)}>
            <span>📟</span> Devices
          </NavLink>
          <NavLink to="/companies" style={navLinkStyle} onClick={() => setMenuOpen(false)}>
            <span>🏢</span> Offices
          </NavLink>
          <NavLink to="/users" style={navLinkStyle} onClick={() => setMenuOpen(false)}>
            <span>👥</span> Users
          </NavLink>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={handleLogout}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 10,
              border: "none",
              background: "transparent",
              color: "#94a3b8",
              cursor: "pointer",
              fontWeight: 500,
              fontSize: 14,
              textAlign: "left",
            }}
          >
            <span>🚪</span> Logout
          </button>
        </aside>

        <main style={{ flex: 1, minWidth: 0 }}>
          <Outlet />
        </main>

        <style>{`
          @media (max-width: 768px) {
            .sidebar-toggle { display: block !important; }
            .app-sidebar {
              position: fixed !important;
              z-index: 20;
              left: 0;
              transform: translateX(${menuOpen ? "0" : "-100%"});
              transition: transform 0.2s ease;
              box-shadow: ${menuOpen ? "4px 0 24px rgba(0,0,0,0.4)" : "none"};
            }
          }
        `}</style>
      </div>
    </WsProvider>
  );
}
