import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDashboardWs,
  isBridgeEvent,
  isSensorMessage,
  type WsMessage,
} from "../context/WsContext";
import { apiFetch } from "../api/client";
import type { SensorMessage } from "../hooks/useWebSocket";

interface DeviceInfo {
  device_id: string;
  friendly_name?: string | null;
}

const THROTTLE_OPTIONS = [
  { label: "Все", value: 0 },
  { label: "1 мин", value: 1 },
  { label: "5 мин", value: 5 },
  { label: "10 мин", value: 10 },
  { label: "30 мин", value: 30 },
  { label: "60 мин", value: 60 },
];

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

function WsStatusBadge({ status }: { status: string }) {
  const color =
    status === "open" ? "#4ade80" : status === "connecting" ? "#facc15" : "#f87171";
  return (
    <span style={{
      fontSize: 12, fontWeight: 600, padding: "3px 10px",
      borderRadius: 20, background: color + "22", color,
      border: `1px solid ${color}44`,
    }}>
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
  const [throttleMin, setThrottleMin] = useState(1);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch("/devices").then(r => { if (r.ok) r.json().then(setDevices); }).catch(() => {});
  }, []);

  const deviceName = (id: string): string | null =>
    devices.find(d => d.device_id === id)?.friendly_name ?? null;

  useEffect(() => {
    if (!followTail || !scrollRef.current) return;
    const el = scrollRef.current;
    el.scrollTop = el.scrollHeight;
  }, [recentMessages, followTail]);

  const lines = useMemo(() =>
    recentMessages.map((msg, i) => {
      const { text, color } = kindLabel(msg);
      return { i, msg, kind: text, kindColor: color, time: formatTime(msg) };
    }),
  [recentMessages]);

  // Throttle sensor messages: per device, keep only one entry per throttleMin interval
  const displayLines = useMemo(() => {
    if (throttleMin === 0) return lines;
    const lastShownMs: Record<string, number> = {};
    return lines.filter(({ msg, kind }) => {
      if (kind !== "sensor") return true;
      const sm = msg as SensorMessage;
      const ts = new Date(sm.timestamp).getTime();
      const last = lastShownMs[sm.device_id] ?? 0;
      if (isNaN(ts) || ts - last >= throttleMin * 60 * 1000) {
        lastShownMs[sm.device_id] = isNaN(ts) ? Date.now() : ts;
        return true;
      }
      return false;
    });
  }, [lines, throttleMin]);

  const copyAll = async () => {
    const blob = recentMessages.map(m => JSON.stringify(m)).join("\n");
    try { await navigator.clipboard.writeText(blob); } catch { /* ignore */ }
  };

  const btnStyle: React.CSSProperties = {
    padding: "8px 14px", borderRadius: 8,
    border: "1px solid #475569", background: "#1e293b",
    color: "#e2e8f0", cursor: "pointer", fontSize: 13, fontWeight: 500,
  };

  const selStyle: React.CSSProperties = {
    padding: "7px 12px", borderRadius: 8,
    border: "1px solid #475569", background: "#1e293b",
    color: "#e2e8f0", cursor: "pointer", fontSize: 13,
    fontFamily: "inherit", outline: "none",
  };

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>
          {t("logs.title")}
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <WsStatusBadge status={status} />
          <span style={{ fontSize: 13, color: "#64748b" }}>
            {t("logs.entries", { count: displayLines.length })}
            {displayLines.length !== lines.length && (
              <span style={{ color: "#475569" }}> / {lines.length}</span>
            )}
          </span>
        </div>
      </header>

      <div style={{ padding: "20px 32px 0", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" style={btnStyle} onClick={clearRecentMessages}>
          {t("logs.clear")}
        </button>
        <button type="button" style={btnStyle} onClick={() => setFollowTail(v => !v)}>
          {followTail ? t("logs.pauseScroll") : t("logs.followTail")}
        </button>
        <button type="button" style={btnStyle} onClick={copyAll} disabled={recentMessages.length === 0}>
          {t("logs.copyAll")}
        </button>

        {/* Throttle dropdown */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
          <span style={{ fontSize: 13, color: "#64748b" }}>Сенсоры не чаще:</span>
          <select
            value={throttleMin}
            onChange={e => setThrottleMin(Number(e.target.value))}
            style={selStyle}
          >
            {THROTTLE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
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
          {displayLines.length === 0 ? (
            <div style={{ padding: 32, color: "#475569" }}>
              {t("logs.noMessages")}
            </div>
          ) : (
            displayLines.map(({ i, msg, kind, kindColor, time }) => {
              const isSensor = kind === "sensor";
              const deviceId = isSensor ? (msg as SensorMessage).device_id : null;
              const name = deviceId ? deviceName(deviceId) : null;

              return (
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
                  <div>
                    <pre style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      color: "#cbd5e1",
                    }}>
                      {JSON.stringify(msg, null, 2)}
                    </pre>
                    {isSensor && deviceId && (
                      <div style={{
                        marginTop: 4,
                        fontSize: 10.5,
                        color: "#334155",
                        fontFamily: "inherit",
                        letterSpacing: "0.02em",
                      }}>
                        {name ? `${name}  ·  ${deviceId}` : deviceId}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
