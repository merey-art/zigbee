import React, { useEffect, useMemo, useState } from "react";
import { SensorCard } from "../components/SensorCard";
import { SensorChart } from "../components/SensorChart";
import { apiFetch } from "../api/client";
import { useDashboardWs, isSensorMessage } from "../context/WsContext";
import type { SensorMessage } from "../hooks/useWebSocket";

interface DeviceState {
  data: Record<string, number>;
  updatedAt: string;
}

interface DeviceInfo {
  device_id: string;
  friendly_name?: string | null;
  company_id?: number | null;
  company_name?: string | null;
  metrics: string[];
}

interface CompanyRow {
  id: number;
  name: string;
}

const METRIC_CONFIG: Record<
  string,
  { label: string; unit: string; icon: string; accent: string; threshold?: number }
> = {
  temperature: { label: "Temperature", unit: "°C", icon: "🌡️", accent: "#fb923c" },
  humidity: { label: "Humidity", unit: "%", icon: "💧", accent: "#38bdf8" },
  co2: { label: "CO₂", unit: "ppm", icon: "🌿", accent: "#4ade80", threshold: 1000 },
  linkquality: { label: "Link Quality", unit: "lqi", icon: "📶", accent: "#a78bfa" },
  battery: { label: "Battery", unit: "%", icon: "🔋", accent: "#facc15" },
};

const CHART_METRICS = ["temperature", "humidity", "co2"];

function buildSections(
  allIds: string[],
  known: DeviceInfo[],
  companiesList: CompanyRow[],
  filter: number | "all"
): { title: string; ids: string[] }[] {
  const meta = (id: string) => known.find((k) => k.device_id === id);

  if (filter !== "all") {
    const ids = allIds.filter((id) => meta(id)?.company_id === filter);
    return [{ title: "", ids }];
  }

  const sortedCos = [...companiesList].sort((a, b) => a.name.localeCompare(b.name));
  const byCo = new Map<number, string[]>();
  const unassigned: string[] = [];

  for (const id of allIds) {
    const m = meta(id);
    const cid = m?.company_id;
    if (cid === undefined || cid === null) {
      unassigned.push(id);
    } else {
      const arr = byCo.get(cid) ?? [];
      arr.push(id);
      byCo.set(cid, arr);
    }
  }

  const sections: { title: string; ids: string[] }[] = [];
  for (const c of sortedCos) {
    const ids = byCo.get(c.id);
    if (ids?.length) sections.push({ title: c.name, ids });
  }
  if (unassigned.length) sections.push({ title: "Unassigned", ids: unassigned });
  return sections;
}

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

export default function DashboardPage() {
  const { subscribeMessages, status } = useDashboardWs();

  const [devices, setDevices] = useState<Record<string, DeviceState>>({});
  const [knownDevices, setKnownDevices] = useState<DeviceInfo[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [filterCompanyId, setFilterCompanyId] = useState<number | "all">("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [dr, cr] = await Promise.all([apiFetch("/devices"), apiFetch("/companies")]);
      if (cancelled) return;
      if (dr.ok) setKnownDevices(await dr.json());
      if (cr.ok) setCompanies(await cr.json());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return subscribeMessages((raw) => {
      if (!isSensorMessage(raw)) return;
      const msg = raw as SensorMessage;
      setDevices((prev) => ({
        ...prev,
        [msg.device_id]: {
          data: { ...(prev[msg.device_id]?.data ?? {}), ...msg.data },
          updatedAt: msg.timestamp,
        },
      }));
    });
  }, [subscribeMessages]);

  const allDeviceIds = Array.from(
    new Set([...Object.keys(devices), ...knownDevices.map((d) => d.device_id)])
  );

  const sections = useMemo(
    () => buildSections(allDeviceIds, knownDevices, companies, filterCompanyId),
    [allDeviceIds, knownDevices, companies, filterCompanyId]
  );

  const selectStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #475569",
    background: "#0f172a",
    color: "#e2e8f0",
    fontSize: 14,
    minWidth: 220,
  };

  return (
    <div style={pageStyle}>
      <header style={{ ...headerStyle, paddingLeft: "max(32px, 56px)" }} className="dash-header">
        <h1 style={h1Style}>⚡ Zigbee Sensor Dashboard</h1>
        <WsStatusBadge status={status} />
      </header>

      <div
        style={{
          padding: "12px 32px",
          paddingLeft: "max(32px, 56px)",
          background: "#1e293b",
          borderBottom: "1px solid #334155",
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 13, color: "#94a3b8" }}>Company</span>
        <select
          value={filterCompanyId === "all" ? "" : String(filterCompanyId)}
          onChange={(e) => {
            const v = e.target.value;
            setFilterCompanyId(v === "" ? "all" : Number(v));
          }}
          style={selectStyle}
        >
          <option value="">All (grouped)</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {allDeviceIds.length === 0 && (
        <div style={{ padding: "64px 32px", textAlign: "center", color: "#475569" }}>
          <p style={{ fontSize: 32 }}>📡</p>
          <p style={{ fontSize: 18 }}>Waiting for sensor data…</p>
          <p style={{ fontSize: 13 }}>
            Make sure Zigbee2MQTT is running and your devices are paired.
          </p>
        </div>
      )}

      {allDeviceIds.length > 0 &&
        sections.every((s) => s.ids.length === 0) &&
        filterCompanyId !== "all" && (
          <div style={{ padding: "48px 32px", textAlign: "center", color: "#64748b" }}>
            No sensors assigned to this company.
          </div>
        )}

      {sections.map((section) => (
        <React.Fragment key={section.title || "__filtered__"}>
          {filterCompanyId === "all" && section.title !== "" && section.ids.length > 0 && (
            <h2
              style={{
                margin: "24px 32px 0",
                paddingLeft: "max(0px, 24px)",
                fontSize: 15,
                fontWeight: 700,
                color: "#64748b",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              {section.title}
            </h2>
          )}
          {section.ids.map((deviceId) => {
            const state = devices[deviceId];
            const meta = knownDevices.find((d) => d.device_id === deviceId);
            const knownMetrics = meta?.metrics ?? [];
            const liveMetrics = state ? Object.keys(state.data) : [];
            const allMetrics = Array.from(new Set([...liveMetrics, ...knownMetrics]));

            const heading =
              meta?.friendly_name != null && meta.friendly_name !== ""
                ? meta.friendly_name
                : deviceId;
            const showIeeeSubtitle =
              meta?.friendly_name != null &&
              meta.friendly_name !== "" &&
              deviceId.startsWith("0x");

            return (
              <section key={deviceId} style={sectionStyle}>
                <div style={deviceHeaderStyle}>
                  <span>📟</span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span>{heading}</span>
                    {showIeeeSubtitle ? (
                      <span style={{ fontSize: 12, color: "#64748b", fontWeight: 500 }}>
                        {deviceId}
                      </span>
                    ) : null}
                    {meta?.company_name ? (
                      <span style={{ fontSize: 12, color: "#475569", fontWeight: 500 }}>
                        {meta.company_name}
                      </span>
                    ) : null}
                  </span>
                </div>

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
        </React.Fragment>
      ))}
    </div>
  );
}
