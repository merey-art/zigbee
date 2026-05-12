import React, { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0f172a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "#1e293b",
          borderRadius: 16,
          padding: "32px 28px",
          border: "1px solid #334155",
          boxShadow: "0 24px 48px rgba(0,0,0,0.35)",
        }}
      >
        <h1 style={{ margin: "0 0 8px", fontSize: 22, color: "#f8fafc" }}>Sign in</h1>
        <p style={{ margin: "0 0 24px", fontSize: 14, color: "#64748b" }}>
          Zigbee Sensor Dashboard
        </p>
        <form onSubmit={handleSubmit}>
          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>
              Email
            </span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={inputStyle}
            />
          </label>
          <label style={{ display: "block", marginBottom: 20 }}>
            <span style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>
              Password
            </span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={inputStyle}
            />
          </label>
          {error && (
            <p style={{ color: "#f87171", fontSize: 13, marginBottom: 14 }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={busy || loading}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: 10,
              border: "none",
              background: "#3b82f6",
              color: "#fff",
              fontWeight: 600,
              fontSize: 15,
              cursor: busy ? "wait" : "pointer",
              opacity: busy ? 0.75 : 1,
            }}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px 14px",
  borderRadius: 10,
  border: "1px solid #475569",
  background: "#0f172a",
  color: "#f1f5f9",
  fontSize: 15,
};
