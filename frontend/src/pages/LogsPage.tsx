import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDashboardWs,
  isBridgeEvent,
  isSensorMessage,
  type WsMessage,
} from "../context/WsContext";

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#0f172a",
  color: "#f1f5f9",
  padding: "0 0 48px",
};

const headerStyle: React.CSSProperties = {
  background: "#1e293b",
  borderBottom: "1px solid #334155",
  padding: "18px 32px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: 12,
};

const h1Style: React.CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 700,
  letterSpacing: "-0.02em",
};

function WsStatusBadge({ status }: { status: string }) {
  const color =
    status === "open" ? "#4ade80" : status === "connecting" ? "#facc15" : "#f87171";
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        padding: "3px 10px",
        borderRadius: 20,
        background: color + "22",
        color,
        border: `1px solid ${color}44`,
      }}
    >
      ● {status.toUpperCase()}
    </span>
  );
}

function kindLabel(msg: WsMessage): { text: string; color: string } {
  if (isBridgeEvent(msg)) return { text: "bridge", color: "#a78bfa" };
  if (isSensorMessage(msg)) return { text: "sensor", color: "#38bdf8" };
  return { text: "message", color: "#94a3b8" };
}

function formatTime(msg: WsMessage): string {
  if ("timestamp" in msg && typeof msg.timestamp === "string") return msg.timestamp;
  return "—";
}

export default function LogsPage() {
  const { t } = useTranslation();
  const { recentMessages, clearRecentMessages, status } = useDashboardWs();
  const [followTail, setFollowTail] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!followTail || !scrollRef.current) return;
    const el = scrollRef.current;
    el.scrollTop = el.scrollHeight;
  }, [recentMessages, followTail]);

  const lines = useMemo(
    () =>
      recentMessages.map((msg, i) => {
        const { text, color } = kindLabel(msg);
        return { i, msg, kind: text, kindColor: color, time: formatTime(msg) };
      }),
    [recentMessages]
  );

  const copyAll = async () => {
    const blob = recentMessages.map((m) => JSON.stringify(m)).join("\n");
    try {
      await navigator.clipboard.writeText(blob);
    } catch {
      /* ignore */
    }
  };

  const btnStyle: React.CSSProperties = {
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid #475569",
    background: "#1e293b",
    color: "#e2e8f0",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
  };

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <h1 style={h1Style}>{t("logs.title")}</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <WsStatusBadge status={status} />
          <span style={{ fontSize: 13, color: "#64748b" }}>
            {t("logs.entries", { count: recentMessages.length })}
          </span>
        </div>
      </header>

      <div style={{ padding: "20px 32px 0", display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" style={btnStyle} onClick={clearRecentMessages}>
          {t("logs.clear")}
        </button>
        <button type="button" style={btnStyle} onClick={() => setFollowTail((v) => !v)}>
          {followTail ? t("logs.pauseScroll") : t("logs.followTail")}
        </button>
        <button
          type="button"
          style={btnStyle}
          onClick={copyAll}
          disabled={recentMessages.length === 0}
        >
          {t("logs.copyAll")}
        </button>
      </div>

      <p style={{ padding: "12px 32px 0", margin: 0, fontSize: 13, color: "#64748b" }}>
        {t("logs.hint")}
      </p>

      <div style={{ padding: 24 }}>
        <div
          ref={scrollRef}
          style={{
            background: "#020617",
            border: "1px solid #334155",
            borderRadius: 12,
            maxHeight: "min(70vh, 720px)",
            overflow: "auto",
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {lines.length === 0 ? (
            <div style={{ padding: 32, color: "#475569" }}>
              {t("logs.noMessages")}
            </div>
          ) : (
            lines.map(({ i, msg, kind, kindColor, time }) => (
              <div
                key={i}
                style={{
                  borderBottom: "1px solid #1e293b",
                  padding: "10px 14px",
                  display: "grid",
                  gridTemplateColumns: "88px 72px 1fr",
                  gap: 12,
                  alignItems: "start",
                }}
              >
                <span style={{ color: "#64748b", whiteSpace: "nowrap" }}>{time}</span>
                <span style={{ color: kindColor, fontWeight: 600, textTransform: "uppercase" }}>
                  {kind}
                </span>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    color: "#cbd5e1",
                  }}
                >
                  {JSON.stringify(msg, null, 2)}
                </pre>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
