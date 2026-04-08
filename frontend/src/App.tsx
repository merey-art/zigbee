import React, { useEffect, useState } from "react";
import { SensorCard } from "./components/SensorCard";
import { SensorChart } from "./components/SensorChart";
import { useWebSocket, type SensorMessage } from "./hooks/useWebSocket";

// ── Types ──────────────────────────────────────────────────────────────────────

interface DeviceState {
  data: Record<string, number>;
  updatedAt: string;
}

interface DeviceInfo {
  device_id: string;
  metrics: string[];
}

// ── Metric display config ──────────────────────────────────────────────────────

const METRIC_CONFIG: Record<
  string,
  { label: string; unit: string; icon: string; accent: string; threshold?: number }
> = {
  temperature: { label: "Temperature", unit: "°C", icon: "🌡️", accent: "#fb923c" },
  humidity:    { label: "Humidity",    unit: "%",  icon: "💧", accent: "#38bdf8" },
  co2:         { label: "CO₂",         unit: "ppm",icon: "🌿", accent: "#4ade80", threshold: 1000 },
  linkquality: { label: "Link Quality",unit: "lqi",icon: "📶", accent: "#a78bfa" },
  battery:     { label: "Battery",     unit: "%",  icon: "🔋", accent: "#facc15" },
};

const CHART_METRICS = ["temperature", "humidity", "co2"];
const API_BASE =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL ??
  "http://localhost:8000";

// ── Styles ─────────────────────────────────────────────────────────────────────

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
};

const h1Style: React.CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 700,
  letterSpacing: "-0.02em",
};

const sectionStyle: React.CSSProperties = {
  padding: "32px 32px 0",
};

const deviceHeaderStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: "#94a3b8",
  marginBottom: 16,
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const cardsRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 16,
  marginBottom: 24,
};

const chartsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))",
  gap: 20,
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

// ── Component ──────────────────────────────────────────────────────────────────

export default function App() {
  const { lastMessage, status } = useWebSocket();

  // Map of device_id → { data: {metric: value}, updatedAt }
  const [devices, setDevices] = useState<Record<string, DeviceState>>({});
  // Known devices from REST (so we show charts even before first WS update)
  const [knownDevices, setKnownDevices] = useState<DeviceInfo[]>([]);

  // Seed known devices from REST on mount
  useEffect(() => {
    fetch(`${API_BASE}/devices`)
      .then((r) => r.json() as Promise<DeviceInfo[]>)
      .then(setKnownDevices)
      .catch(() => {/* silently ignore if backend not ready yet */});
  }, []);

  // Update live state from WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;
    const msg = lastMessage as SensorMessage;
    setDevices((prev) => ({
      ...prev,
      [msg.device_id]: {
        data: { ...(prev[msg.device_id]?.data ?? {}), ...msg.data },
        updatedAt: msg.timestamp,
      },
    }));
  }, [lastMessage]);

  // Merge WS-seen devices with REST-known devices for chart rendering
  const allDeviceIds = Array.from(
    new Set([
      ...Object.keys(devices),
      ...knownDevices.map((d) => d.device_id),
    ])
  );

  return (
    <div style={pageStyle}>
      {/* Header */}
      <header style={headerStyle}>
        <h1 style={h1Style}>⚡ Zigbee Sensor Dashboard</h1>
        <WsStatusBadge status={status} />
      </header>

      {allDeviceIds.length === 0 && (
        <div style={{ padding: "64px 32px", textAlign: "center", color: "#475569" }}>
          <p style={{ fontSize: 32 }}>📡</p>
          <p style={{ fontSize: 18 }}>Waiting for sensor data…</p>
          <p style={{ fontSize: 13 }}>
            Make sure Zigbee2MQTT is running and your devices are paired.
          </p>
        </div>
      )}

      {allDeviceIds.map((deviceId) => {
        const state = devices[deviceId];
        const knownMetrics =
          knownDevices.find((d) => d.device_id === deviceId)?.metrics ?? [];
        const liveMetrics = state ? Object.keys(state.data) : [];
        const allMetrics = Array.from(new Set([...liveMetrics, ...knownMetrics]));

        return (
          <section key={deviceId} style={sectionStyle}>
            <div style={deviceHeaderStyle}>
              <span>📟</span>
              <span>{deviceId}</span>
            </div>

            {/* Live value cards */}
            <div style={cardsRowStyle}>
              {allMetrics
                .filter((m) => m in METRIC_CONFIG)
                .map((metric) => {
                  const cfg = METRIC_CONFIG[metric];
                  const value = state?.data[metric] ?? null;
                  return (
                    <SensorCard
                      key={metric}
                      label={cfg.label}
                      value={value}
                      unit={cfg.unit}
                      icon={cfg.icon}
                      accent={cfg.accent}
                      updatedAt={state?.updatedAt}
                    />
                  );
                })}
            </div>

            {/* Historical charts */}
            <div style={chartsGridStyle}>
              {CHART_METRICS.filter((m) => allMetrics.includes(m)).map((metric) => {
                const cfg = METRIC_CONFIG[metric];
                return (
                  <SensorChart
                    key={metric}
                    deviceId={deviceId}
                    metric={metric}
                    unit={cfg.unit}
                    color={cfg.accent}
                    threshold={cfg.threshold}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
