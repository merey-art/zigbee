import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { useDashboardWs, isSensorMessage } from "../context/WsContext";
import { FLOORS } from "../data/floors";
import type { SensorMessage } from "../hooks/useWebSocket";
import { SensorChart } from "../components/SensorChart";
import { staleTone, staleLabel } from "../util/metricHealth";

const ONLINE_THRESHOLD_MS = 15 * 60 * 1000;

function isLiveOnline(updatedAt: string): boolean {
  return Date.now() - new Date(updatedAt).getTime() < ONLINE_THRESHOLD_MS;
}

// ── Design tokens ────────────────────────────────────────────────
const C = {
  bg:        "#0b1220",
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
  orange:    "#fb923c",
  purple:    "#a78bfa",
};

// ── Interfaces ───────────────────────────────────────────────────
interface DeviceInfo {
  device_id: string;
  friendly_name?: string | null;
  company_id?: number | null;
  company_name?: string | null;
  metrics: string[];
  latest_values?: Record<string, number>;
  latest_recorded_at?: string | null;
}

interface AlertRule {
  id: number;
  device_id: string | null;
  metric: string;
  direction: string;
  threshold: number;
  enabled: boolean;
}

interface LiveReading {
  device_id: string;
  data: Record<string, number>;
  updatedAt: string;
}

// ── Card ─────────────────────────────────────────────────────────
function Card({ children, style, padding = 18, hoverable }: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  padding?: number;
  hoverable?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={hoverable ? () => setHover(true) : undefined}
      onMouseLeave={hoverable ? () => setHover(false) : undefined}
      style={{
        background: C.card,
        border: `1px solid ${hover ? C.border : C.borderSub}`,
        borderRadius: 12,
        padding,
        transition: "border-color 120ms",
        ...(style || {}),
      }}
    >
      {children}
    </div>
  );
}

// ── KPI tile ─────────────────────────────────────────────────────
function KPI({ label, value, unit, hint, accent, icon }: {
  label: string; value: React.ReactNode; unit?: string;
  hint?: string; accent?: string; icon?: string;
}) {
  return (
    <Card padding={18} style={{ flex: "1 1 170px", minWidth: 170 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: C.dim, textTransform: "uppercase",
        letterSpacing: "0.07em", display: "flex", alignItems: "center", gap: 6, marginBottom: 8,
      }}>
        {icon && <span>{icon}</span>}
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 30, fontWeight: 700, color: accent || C.text, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 14, color: C.dim, fontWeight: 500 }}>{unit}</span>}
      </div>
      {hint && (
        <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 500, color: C.muted }}>{hint}</div>
      )}
    </Card>
  );
}

// ── MiniStat ─────────────────────────────────────────────────────
function MiniStat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: C.dim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: accent || C.text, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{value}</div>
    </div>
  );
}

// ── Company card (floor-like health card) ────────────────────────
function CompanyCard({ name, devices, liveReadings, co2DeviceId, tempDeviceId }: {
  name: string;
  devices: DeviceInfo[];
  liveReadings: Record<string, LiveReading>;
  co2DeviceId: string | null;
  tempDeviceId: string | null;
}) {
  const { t } = useTranslation();

  const getValue = (d: DeviceInfo, metric: string): number | null => {
    const live = liveReadings[d.device_id]?.data[metric];
    if (live !== undefined) return live;
    return d.latest_values?.[metric] ?? null;
  };

  // If explicit device roles are set — use them; otherwise fall back to auto-detection
  const co2Devices = co2DeviceId
    ? devices.filter(d => d.device_id === co2DeviceId)
    : devices.filter(d =>
        (liveReadings[d.device_id]?.data["co2"] !== undefined) ||
        (d.latest_values?.["co2"] !== undefined) ||
        d.metrics?.includes("co2")
      );
  const tempDevices = tempDeviceId
    ? devices.filter(d => d.device_id === tempDeviceId)
    : devices.filter(d => !co2Devices.includes(d));

  const co2Vals = co2Devices
    .map(d => getValue(d, "co2"))
    .filter((v): v is number => v !== null);
  const avgCo2 = co2Vals.length ? Math.round(co2Vals.reduce((a, b) => a + b, 0) / co2Vals.length) : null;
  const co2State = avgCo2 == null ? C.dim : avgCo2 > 1000 ? C.danger : avgCo2 > 800 ? C.warn : C.ok;

  // Temperature and humidity — from temp devices only
  const tempSource = tempDevices.length > 0 ? tempDevices : devices;
  const tempVals = tempSource
    .map(d => getValue(d, "temperature"))
    .filter((v): v is number => v !== null);
  const avgTemp = tempVals.length ? (tempVals.reduce((a, b) => a + b, 0) / tempVals.length).toFixed(1) : null;

  const humVals = tempSource
    .map(d => getValue(d, "humidity"))
    .filter((v): v is number => v !== null);
  const avgHum = humVals.length ? Math.round(humVals.reduce((a, b) => a + b, 0) / humVals.length) : null;

  const online = devices.filter(d => {
    const r = liveReadings[d.device_id];
    if (r) return isLiveOnline(r.updatedAt);
    const updated = d.latest_recorded_at;
    if (!updated) return false;
    return Date.now() - new Date(updated).getTime() < ONLINE_THRESHOLD_MS;
  }).length;

  // Staleness: best (most recent) timestamp across all devices
  const bestTs = devices.reduce<string | null>((best, d) => {
    const t = liveReadings[d.device_id]?.updatedAt ?? d.latest_recorded_at ?? null;
    if (!t) return best;
    return !best || t > best ? t : best;
  }, null);
  const stale = staleTone(bestTs);
  const ageLabel = staleLabel(bestTs);

  return (
    <Card hoverable padding={16} style={{
      cursor: "default",
      ...(stale === "dead" ? { borderColor: `${C.dim}44`, opacity: 0.75 } :
          stale === "stale" ? { borderColor: `${C.orange}66` } : {}),
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: stale !== "fresh" ? 8 : 14 }}>
        <div>
          <div style={{ fontSize: 11, color: C.dim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>
            Office
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: stale === "dead" ? C.dim : C.text, marginTop: 2 }}>{name}</div>
        </div>
        {stale !== "fresh" && (
          <div style={{
            fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
            background: stale === "dead" ? "#1c1917" : "#1c1200",
            color: stale === "dead" ? C.dim : C.orange,
            border: `1px solid ${stale === "dead" ? C.dim + "33" : C.orange + "44"}`,
          }}>
            {stale === "dead" ? "📴" : "⚠️"} {ageLabel}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 14, marginBottom: avgCo2 !== null ? 14 : 0 }}>
        <MiniStat label={t("dashboard.floors.sensors")} value={devices.length} />
        <MiniStat label={t("dashboard.floors.online")} value={online} accent={online === devices.length ? C.ok : online > 0 ? C.warn : C.danger} />
        {avgTemp !== null && <MiniStat label="Темп." value={`${avgTemp}°`} accent={C.orange} />}
        {avgHum !== null && <MiniStat label="Влажн." value={`${avgHum}%`} accent={C.accent} />}
      </div>

      {/* Device source labels */}
      {(co2Devices.length > 0 || tempDevices.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
          {co2Devices.map(d => (
            <span key={d.device_id} style={{
              fontSize: 10, color: "#334155", background: "#1e3a3a",
              borderRadius: 4, padding: "1px 6px", fontFamily: "ui-monospace, monospace",
            }}>
              CO₂ · {d.friendly_name || d.device_id}
            </span>
          ))}
          {tempDevices.map(d => (
            <span key={d.device_id} style={{
              fontSize: 10, color: "#334155", background: "#1e2a3a",
              borderRadius: 4, padding: "1px 6px", fontFamily: "ui-monospace, monospace",
            }}>
              T/H · {d.friendly_name || d.device_id}
            </span>
          ))}
        </div>
      )}

      {avgCo2 !== null && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted, marginBottom: 4 }}>
            <span>{t("dashboard.floors.avgCo2")}</span>
            <span style={{ color: co2State, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{avgCo2} ppm</span>
          </div>
          <div style={{ height: 6, background: "#0b1424", borderRadius: 999, overflow: "hidden" }}>
            <div style={{
              width: `${Math.min(100, (avgCo2 / 1500) * 100)}%`,
              height: "100%", background: co2State, transition: "width 320ms",
            }} />
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Worst CO₂ rooms ───────────────────────────────────────────────
function WorstCo2({ companies, devices, liveReadings }: {
  companies: CompanyRow[];
  devices: DeviceInfo[];
  liveReadings: Record<string, LiveReading>;
}) {
  const { t } = useTranslation();

  const rows = useMemo(() => {
    return companies.map(c => {
      const devs = devices.filter(d => d.company_id === c.id);
      const co2Vals = devs.map(d => {
        const live = liveReadings[d.device_id]?.data["co2"];
        return live ?? d.latest_values?.["co2"] ?? null;
      }).filter((v): v is number => v !== null);
      const avgCo2 = co2Vals.length
        ? Math.round(co2Vals.reduce((a, b) => a + b, 0) / co2Vals.length)
        : null;
      return { id: c.id, name: c.name, avgCo2 };
    })
    .filter(r => r.avgCo2 !== null)
    .sort((a, b) => (b.avgCo2 ?? 0) - (a.avgCo2 ?? 0))
    .slice(0, 6);
  }, [companies, devices, liveReadings]);

  return (
    <Card padding={0}>
      <div style={{
        padding: "14px 18px", borderBottom: `1px solid ${C.borderSub}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{t("dashboard.watchlist.title")}</div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{t("dashboard.watchlist.subtitle")}</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: "32px 18px", textAlign: "center", color: C.dim, fontSize: 13 }}>
          {t("common.noData")}
        </div>
      ) : rows.map((r, i) => {
        const state = (r.avgCo2 ?? 0) > 1000 ? C.danger : (r.avgCo2 ?? 0) > 800 ? C.warn : C.ok;
        return (
          <div key={r.id} style={{
            display: "flex", alignItems: "center", gap: 14,
            padding: "12px 18px",
            borderBottom: i < rows.length - 1 ? `1px solid ${C.borderSub}` : "none",
          }}>
            <div style={{
              width: 24, height: 24, borderRadius: 6,
              background: state + "22", color: state,
              display: "grid", placeItems: "center",
              fontSize: 11, fontWeight: 800,
            }}>{i + 1}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
            </div>
            <span style={{ fontSize: 14, fontWeight: 700, color: state, fontVariantNumeric: "tabular-nums" }}>
              {r.avgCo2} <span style={{ fontSize: 10, color: C.dim }}>ppm</span>
            </span>
          </div>
        );
      })}
    </Card>
  );
}

// ── Triggered alerts panel ────────────────────────────────────────
interface TriggeredAlert {
  id: number;
  severity: "critical" | "warning" | "info";
  title: string;
  body: string;
  minsAgo: number;
}

function AlertsPanel({ alerts }: { alerts: TriggeredAlert[] }) {
  const { t } = useTranslation();
  const shown = alerts.slice(0, 5);
  return (
    <Card padding={0}>
      <div style={{
        padding: "14px 18px", borderBottom: `1px solid ${C.borderSub}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
            {t("dashboard.alertsPanel.title")}
            {alerts.length > 0 && (
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: C.danger + "22", color: C.danger }}>
                {alerts.length}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{t("dashboard.alertsPanel.subtitle")}</div>
        </div>
        <a href="/alerts" style={{ fontSize: 11.5, color: C.accent, textDecoration: "none", fontWeight: 600 }}>
          {t("dashboard.alertsPanel.viewAll")}
        </a>
      </div>
      {shown.length === 0 ? (
        <div style={{ padding: "40px 18px", textAlign: "center" }}>
          <div style={{ fontSize: 28 }}>✓</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginTop: 8 }}>{t("dashboard.alertsPanel.allClearTitle")}</div>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>{t("dashboard.alertsPanel.allClearBody")}</div>
        </div>
      ) : shown.map((a, i) => {
        const sev = a.severity === "critical" ? C.danger : a.severity === "warning" ? C.warn : C.accent;
        return (
          <div key={a.id} style={{
            padding: "12px 18px",
            borderBottom: i < shown.length - 1 ? `1px solid ${C.borderSub}` : "none",
            display: "flex", gap: 12, alignItems: "flex-start",
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: 999, background: sev, marginTop: 6,
              boxShadow: `0 0 8px ${sev}`,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{a.title}</div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>{a.body}</div>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

// ── Live MQTT ticker ──────────────────────────────────────────────
function LiveActivity({ messages, knownDevices }: {
  messages: Array<SensorMessage & { t: string }>;
  knownDevices: DeviceInfo[];
}) {
  const { t } = useTranslation();

  const ICONS: Record<string, string> = {
    temperature: "🌡️", humidity: "💧", co2: "🌿",
    motion: "🚶", contact: "🚪", illuminance: "💡",
    battery: "🔋", linkquality: "📶",
  };

  return (
    <Card padding={0} style={{ height: "100%" }}>
      <div style={{
        padding: "14px 18px", borderBottom: `1px solid ${C.borderSub}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              width: 8, height: 8, borderRadius: 999,
              background: C.ok, boxShadow: `0 0 8px ${C.ok}`,
              animation: "pulse-dot 1.4s ease-in-out infinite",
              display: "inline-block",
            }} />
            {t("dashboard.liveStream.title")}
          </div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{t("dashboard.liveStream.subtitle")}</div>
        </div>
      </div>

      {messages.length === 0 ? (
        <div style={{ padding: "40px 18px", textAlign: "center", color: C.dim, fontSize: 13 }}>
          {t("dashboard.liveStream.waiting")}
        </div>
      ) : messages.map((msg, i) => {
        const meta = knownDevices.find(d => d.device_id === msg.device_id);
        const name = meta?.friendly_name || meta?.company_name || msg.device_id;
        const firstMetric = Object.keys(msg.data)[0];
        const firstIcon = ICONS[firstMetric] ?? "📡";
        const firstVal = msg.data[firstMetric];
        const unit = firstMetric === "temperature" ? "°C"
          : firstMetric === "humidity" ? "%"
          : firstMetric === "co2" ? " ppm"
          : firstMetric === "illuminance" ? " lx"
          : firstMetric === "battery" ? "%"
          : firstMetric === "linkquality" ? " lqi" : "";
        const display = firstVal !== undefined ? `${firstVal}${unit}` : "—";

        return (
          <div key={i} style={{
            padding: "10px 18px",
            borderBottom: i < messages.length - 1 ? `1px solid ${C.borderSub}` : "none",
            display: "flex", gap: 10, alignItems: "center", fontSize: 12,
            opacity: 1 - i * 0.1,
          }}>
            <span style={{ fontSize: 14 }}>{firstIcon}</span>
            <span style={{ fontFamily: "ui-monospace, monospace", color: C.dim, fontSize: 10.5 }}>{msg.t}</span>
            <span style={{ fontFamily: "ui-monospace, monospace", color: C.muted, fontSize: 10.5, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {msg.device_id}
            </span>
            <span style={{ flex: 1, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name}
            </span>
            <span style={{ color: C.accent, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
              {display}
            </span>
          </div>
        );
      })}
    </Card>
  );
}

// ── WS Status badge ───────────────────────────────────────────────
function WsStatusBadge({ status }: { status: string }) {
  const color = status === "open" ? C.ok : status === "connecting" ? C.warn : C.danger;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "6px 14px", borderRadius: 8,
      background: C.bg, border: `1px solid ${C.border}`,
      fontSize: 12, color: C.muted,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: color, boxShadow: `0 0 8px ${color}` }} />
      <span>MQTT <strong style={{ color: C.text }}>{status.toUpperCase()}</strong></span>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────
interface CompanyRow { id: number; name: string; floor_id: number | null; office_id: string | null; co2_device_id: string | null; temp_device_id: string | null; }

// ── Page ─────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { t } = useTranslation();
  const { subscribeMessages, status } = useDashboardWs();

  const [knownDevices, setKnownDevices] = useState<DeviceInfo[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [liveReadings, setLiveReadings] = useState<Record<string, LiveReading>>({});
  const [recentMessages, setRecentMessages] = useState<Array<SensorMessage & { t: string }>>([]);

  // ── Filters ────────────────────────────────────────────────────
  const [filterFloor, setFilterFloor] = useState<number | "">("");
  const [filterOffice, setFilterOffice] = useState<string>("");

  // Bootstrap REST data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [dr, cr, ar] = await Promise.all([
        apiFetch("/devices"),
        apiFetch("/companies"),
        apiFetch("/alert-rules").catch(() => null),
      ]);
      if (cancelled) return;
      if (dr.ok) setKnownDevices(await dr.json());
      if (cr.ok) setCompanies(await cr.json());
      if (ar?.ok) setAlertRules(await ar.json());
    })();
    return () => { cancelled = true; };
  }, []);

  // Periodic device refresh
  useEffect(() => {
    const id = setInterval(async () => {
      const dr = await apiFetch("/devices");
      if (dr.ok) setKnownDevices(await dr.json());
    }, 45_000);
    return () => clearInterval(id);
  }, []);

  // WebSocket live updates
  useEffect(() => {
    return subscribeMessages((raw) => {
      if (!isSensorMessage(raw)) return;
      const msg = raw as SensorMessage;
      const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setLiveReadings(prev => ({
        ...prev,
        [msg.device_id]: {
          device_id: msg.device_id,
          data: { ...(prev[msg.device_id]?.data ?? {}), ...msg.data },
          updatedAt: msg.timestamp,
        },
      }));
      setRecentMessages(prev => {
        const enriched = { ...msg, t: ts };
        const next = [enriched, ...prev].slice(0, 8);
        return next;
      });
    });
  }, [subscribeMessages]);

  // ── Derived stats ──────────────────────────────────────────────
  const stats = useMemo(() => {
    const totalDevices = knownDevices.length;
    const onlineCount = knownDevices.filter(d => {
      const live = liveReadings[d.device_id];
      if (live) return isLiveOnline(live.updatedAt);
      const updated = d.latest_recorded_at;
      if (!updated) return false;
      return Date.now() - new Date(updated).getTime() < ONLINE_THRESHOLD_MS;
    }).length;

    const getVal = (d: DeviceInfo, metric: string) => {
      const live = liveReadings[d.device_id]?.data[metric];
      return live ?? d.latest_values?.[metric] ?? null;
    };

    const isCo2Device = (d: DeviceInfo) =>
      d.metrics?.includes("co2") || d.latest_values?.["co2"] != null || liveReadings[d.device_id]?.data["co2"] != null;

    // Per company: resolve which device is used for temp and which for co2
    const tempDeviceIds = new Set<string>();
    const co2DeviceIds = new Set<string>();
    for (const c of companies) {
      const cDevs = knownDevices.filter(d => d.company_id === c.id);
      if (c.temp_device_id) {
        tempDeviceIds.add(c.temp_device_id);
      } else {
        // auto: non-CO2 devices; if none, use all
        const nonCo2 = cDevs.filter(d => !isCo2Device(d));
        (nonCo2.length > 0 ? nonCo2 : cDevs).forEach(d => tempDeviceIds.add(d.device_id));
      }
      if (c.co2_device_id) {
        co2DeviceIds.add(c.co2_device_id);
      } else {
        cDevs.filter(isCo2Device).forEach(d => co2DeviceIds.add(d.device_id));
      }
    }

    const tempDevices = knownDevices.filter(d => tempDeviceIds.has(d.device_id));
    const co2Devices  = knownDevices.filter(d => co2DeviceIds.has(d.device_id));

    const temps = tempDevices.map(d => getVal(d, "temperature")).filter((v): v is number => v !== null);
    const hums  = tempDevices.map(d => getVal(d, "humidity")).filter((v): v is number => v !== null);
    const co2s  = co2Devices.map(d => getVal(d, "co2")).filter((v): v is number => v !== null);

    const avgTemp = temps.length ? +(temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1) : null;
    const avgHum  = hums.length  ? Math.round(hums.reduce((a, b) => a + b, 0) / hums.length)     : null;
    const avgCo2  = co2s.length  ? Math.round(co2s.reduce((a, b) => a + b, 0) / co2s.length)     : null;

    return {
      totalDevices, onlineCount,
      companies: companies.length,
      avgTemp, avgHum, avgCo2,
    };
  }, [knownDevices, companies, liveReadings]);

  // ── Derived triggered alerts ───────────────────────────────────
  const triggeredAlerts = useMemo((): TriggeredAlert[] => {
    const out: TriggeredAlert[] = [];
    const getVal = (d: DeviceInfo, metric: string) => {
      const live = liveReadings[d.device_id]?.data[metric];
      return live ?? d.latest_values?.[metric] ?? null;
    };

    for (const rule of alertRules) {
      if (!rule.enabled) continue;
      const targets = rule.device_id
        ? knownDevices.filter(d => d.device_id === rule.device_id)
        : knownDevices.filter(d => d.metrics?.includes(rule.metric));

      for (const d of targets) {
        const val = getVal(d, rule.metric);
        if (val === null) continue;
        const breached = rule.direction === "above" ? val > rule.threshold : val < rule.threshold;
        if (!breached) continue;
        const name = d.friendly_name || d.company_name || d.device_id;
        out.push({
          id: rule.id * 1000 + d.device_id.length,
          severity: rule.metric === "co2" && val > 1200 ? "critical" : "warning",
          title: `${rule.metric.toUpperCase()} ${rule.direction} threshold — ${name}`,
          body: `Current: ${val} (threshold ${rule.direction} ${rule.threshold})`,
          minsAgo: 0,
        });
      }
    }

    // Also surface low-battery warnings from latest_values
    for (const d of knownDevices) {
      const bat = getVal(d, "battery");
      if (bat !== null && bat < 15) {
        const name = d.friendly_name || d.company_name || d.device_id;
        out.push({
          id: 900000 + knownDevices.indexOf(d),
          severity: "warning",
          title: `Low battery — ${name}`,
          body: `Battery at ${bat}%. Replace soon.`,
          minsAgo: 0,
        });
      }
    }
    return out;
  }, [alertRules, knownDevices, liveReadings]);

  // ── Companies grouped (all, for stats) ────────────────────────
  const companiesWithDevices = useMemo(() => {
    return companies
      .map(c => ({
        ...c,
        devices: knownDevices.filter(d => d.company_id === c.id),
      }))
      .filter(c => c.devices.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [companies, knownDevices]);

  // ── Office options for dropdown ────────────────────────────────
  const officeOptions = useMemo(() => {
    const floorData = filterFloor !== "" ? FLOORS.filter(f => f.id === filterFloor) : FLOORS;
    return floorData.flatMap(f => f.offices.map(o => ({ ...o, floorLabel: f.label })));
  }, [filterFloor]);

  // ── Filtered companies for display ────────────────────────────
  const filteredCompanies = useMemo(() => {
    return companiesWithDevices.filter(c => {
      if (filterFloor !== "" && c.floor_id !== filterFloor) return false;
      if (filterOffice !== "" && c.office_id !== filterOffice) return false;
      return true;
    });
  }, [companiesWithDevices, filterFloor, filterOffice]);

  const co2State = stats.avgCo2 == null ? C.dim
    : stats.avgCo2 > 1000 ? C.danger
    : stats.avgCo2 > 800 ? C.warn
    : C.ok;

  const selStyle: React.CSSProperties = {
    padding: "7px 10px", fontSize: 13, borderRadius: 8,
    border: `1px solid ${C.border}`, background: C.card,
    color: C.text, cursor: "pointer", fontFamily: "inherit",
    outline: "none", minWidth: 120,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1, background: C.bg }}>
      {/* Global animations */}
      <style>{`
        @keyframes pulse-dot { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
        @media (max-width: 1100px) { .dash-2col { grid-template-columns: 1fr !important; } }
      `}</style>

      {/* Page header */}
      <div style={{
        padding: "22px 32px 18px",
        borderBottom: `1px solid ${C.border}`,
        background: C.panel,
        display: "flex", flexWrap: "wrap",
        alignItems: "flex-end", justifyContent: "space-between",
        gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            {t("dashboard.crumb")}
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.text, letterSpacing: "-0.02em" }}>
            {t("dashboard.title")}
            <span style={{ color: C.muted, fontWeight: 500, fontSize: 16, marginLeft: 8 }}>· {t("dashboard.subtitle")}</span>
          </h1>
        </div>
        <WsStatusBadge status={status} />
      </div>

      {/* Content */}
      <div style={{ padding: "20px 32px 32px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* KPI row */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <KPI icon="📟" label={t("dashboard.kpi.devices")} value={stats.totalDevices}
            hint={t("dashboard.kpi.devicesHint", { count: stats.onlineCount })} accent={C.text} />
          <KPI icon="🏢" label={t("dashboard.kpi.offices")} value={stats.companies}
            hint={t("dashboard.kpi.officesHint")} accent={C.text} />
          {stats.avgTemp !== null && (
            <KPI icon="🌡️" label={t("dashboard.kpi.avgTemp")} value={stats.avgTemp} unit="°C" accent={C.orange} />
          )}
          {stats.avgHum !== null && (
            <KPI icon="💧" label={t("dashboard.kpi.avgHum")} value={stats.avgHum} unit="%" accent={C.accent} />
          )}
          {stats.avgCo2 !== null && (
            <KPI icon="🌿" label={t("dashboard.kpi.avgCo2")} value={stats.avgCo2} unit="ppm" accent={co2State}
              hint={stats.avgCo2 > 800 ? t("dashboard.kpi.co2AboveOptimal") : t("dashboard.kpi.co2WithinRange")} />
          )}
          <KPI icon="🔔" label={t("dashboard.kpi.alerts")} value={triggeredAlerts.length}
            accent={triggeredAlerts.length > 0 ? C.danger : C.ok}
            hint={triggeredAlerts.length === 0 ? t("dashboard.kpi.allClear") : undefined} />
        </div>

        {/* Offices strip */}
        {companiesWithDevices.length > 0 && (
          <div>
            {/* Header row with title + filters + link */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 auto" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  {t("dashboard.floors.title")}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginTop: 2 }}>{t("dashboard.floors.subtitle")}</div>
              </div>

              {/* Floor dropdown */}
              <select
                value={filterFloor}
                onChange={e => {
                  setFilterFloor(e.target.value === "" ? "" : Number(e.target.value));
                  setFilterOffice("");
                }}
                style={selStyle}
              >
                <option value="">{t("companies.noFloor").replace("— ", "").replace(" —", "")}</option>
                {FLOORS.map(f => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>

              {/* Office dropdown */}
              <select
                value={filterOffice}
                onChange={e => setFilterOffice(e.target.value)}
                style={selStyle}
              >
                <option value="">{t("companies.noOffice").replace("— ", "").replace(" —", "")}</option>
                {officeOptions.map(o => (
                  <option key={o.id} value={o.id}>
                    {filterFloor === "" ? `${o.floorLabel} · ${o.name}` : o.name}
                  </option>
                ))}
              </select>

              {(filterFloor !== "" || filterOffice !== "") && (
                <button
                  type="button"
                  onClick={() => { setFilterFloor(""); setFilterOffice(""); }}
                  style={{
                    padding: "6px 12px", fontSize: 12, borderRadius: 6,
                    border: `1px solid ${C.border}`, background: "transparent",
                    color: C.muted, cursor: "pointer", fontFamily: "inherit",
                  }}
                >✕</button>
              )}

              <a href="/devices" style={{ fontSize: 12, color: C.accent, textDecoration: "none", fontWeight: 600, marginLeft: "auto" }}>
                {t("dashboard.allDevices")}
              </a>
            </div>

            {filteredCompanies.length === 0 && (filterFloor !== "" || filterOffice !== "") ? (
              <div style={{ padding: "32px 0", textAlign: "center", color: C.dim, fontSize: 13 }}>
                {t("dashboard.noFilterMatch")}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
                {(filteredCompanies.length > 0 ? filteredCompanies : companiesWithDevices).map(c => (
                  <CompanyCard key={c.id} name={c.name} devices={c.devices} liveReadings={liveReadings} co2DeviceId={c.co2_device_id ?? null} tempDeviceId={c.temp_device_id ?? null} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {knownDevices.length === 0 && (
          <div style={{ padding: "64px 32px", textAlign: "center", color: C.dim }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📡</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: C.muted }}>{t("dashboard.noData")}</div>
            <div style={{ fontSize: 13, marginTop: 8 }}>{t("dashboard.noDataHint")}</div>
          </div>
        )}

        {/* 2-col: alerts + watchlist | live stream */}
        {knownDevices.length > 0 && (
          <div
            className="dash-2col"
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <AlertsPanel alerts={triggeredAlerts} />
              <WorstCo2 companies={companies} devices={knownDevices} liveReadings={liveReadings} />
            </div>
            <LiveActivity messages={recentMessages} knownDevices={knownDevices} />
          </div>
        )}

        {/* Charts section */}
        {companiesWithDevices.length > 0 && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                Графики
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginTop: 2 }}>
                История показаний по офисам
              </div>
            </div>

            {(filteredCompanies.length > 0 ? filteredCompanies : companiesWithDevices).map(company => {
              const co2Devs = company.devices.filter(d =>
                d.metrics?.includes("co2") ||
                d.latest_values?.["co2"] !== undefined
              );
              const tempDevs = company.devices.filter(d => !co2Devs.includes(d));

              return (
                <div key={company.id} style={{ marginBottom: 32 }}>
                  {/* Company header */}
                  <div style={{
                    fontSize: 13, fontWeight: 600, color: C.muted,
                    marginBottom: 14, paddingBottom: 8,
                    borderBottom: `1px solid ${C.borderSub}`,
                    display: "flex", alignItems: "center", gap: 8,
                  }}>
                    <span style={{ color: C.dim }}>🏢</span>
                    {company.name}
                  </div>

                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 380px), 1fr))",
                    gap: 16,
                  }}>
                    {/* CO2 charts */}
                    {co2Devs.map(d => (
                      <SensorChart
                        key={d.device_id + "_co2"}
                        deviceId={d.device_id}
                        metric="co2"
                        unit="ppm"
                        color="#4ade80"
                        threshold={1000}
                        titleLabel={d.friendly_name ?? d.device_id}
                      />
                    ))}

                    {/* Temperature charts */}
                    {tempDevs.filter(d => d.metrics?.includes("temperature") || d.latest_values?.["temperature"] !== undefined).map(d => (
                      <SensorChart
                        key={d.device_id + "_temp"}
                        deviceId={d.device_id}
                        metric="temperature"
                        unit="°C"
                        color="#fb923c"
                        titleLabel={d.friendly_name ?? d.device_id}
                      />
                    ))}

                    {/* Humidity charts */}
                    {tempDevs.filter(d => d.metrics?.includes("humidity") || d.latest_values?.["humidity"] !== undefined).map(d => (
                      <SensorChart
                        key={d.device_id + "_hum"}
                        deviceId={d.device_id}
                        metric="humidity"
                        unit="%"
                        color="#38bdf8"
                        titleLabel={d.friendly_name ?? d.device_id}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
