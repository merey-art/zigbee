import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";

type Period = "1d" | "7d" | "30d";

interface CompanyRow {
  id: number;
  name: string;
}

interface AlertEventRow {
  id: number;
  device_id: string;
  device_label: string | null;
  metric: string;
  value: number;
  threshold: number;
  direction: string;
  telegram_sent: boolean;
  created_at: string;
}

interface EmergencyEventRow {
  id: number;
  key: string;
  status: string;
  device_id: string | null;
  temp_device_id: string | null;
  co2_device_id: string | null;
  zone_id: string | null;
  temperature: number;
  co2: number;
  temperature_rate: number;
  co2_rate: number;
  telegram_sent: boolean;
  acknowledged_by: number | null;
  started_at: string;
  last_seen_at: string;
  acknowledged_at: string | null;
  cleared_at: string | null;
}

interface MetricAggregate {
  device_id: string;
  device_label: string;
  metric: string;
  unit: string;
  min: number;
  max: number;
  avg: number;
  latest: number | null;
  count: number;
  worst_hours: { hour: string; avg: number }[];
}

interface AiReport {
  period: "day" | "week";
  days_requested: number;
  days_covered: number;
  coverage_note: string | null;
  total_readings: number;
  aggregates: MetricAggregate[];
  summary_text: string | null;
  text_available: boolean;
}

async function downloadReport(pathWithQuery: string, fallbackName: string) {
  const res = await apiFetch(pathWithQuery);
  if (!res.ok) {
    const t = await res.text();
    alert(t.slice(0, 240) || "Download failed");
    return;
  }
  const cd = res.headers.get("Content-Disposition");
  let fname = fallbackName;
  if (cd) {
    const m = /filename="([^"]+)"/i.exec(cd) || /filename=([^;]+)/i.exec(cd);
    if (m) fname = m[1].trim().replace(/"/g, "");
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  a.click();
  URL.revokeObjectURL(a.href);
}

const btn: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid #475569",
  background: "#1e293b",
  color: "#e2e8f0",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  ...btn,
  background: "#3b82f6",
  borderColor: "#2563eb",
  color: "#fff",
};

export default function ReportsPage() {
  const { t } = useTranslation();
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [events, setEvents] = useState<AlertEventRow[]>([]);
  const [emergencies, setEmergencies] = useState<EmergencyEventRow[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [emergenciesError, setEmergenciesError] = useState<string | null>(null);

  // AI report state
  const [aiReport, setAiReport] = useState<AiReport | null>(null);
  const [aiLoading, setAiLoading] = useState<"day" | "week" | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [tgSending, setTgSending] = useState(false);
  const [tgNote, setTgNote] = useState<string | null>(null);

  const generateAiReport = useCallback(async (period: "day" | "week") => {
    setAiLoading(period);
    setAiError(null);
    setTgNote(null);
    try {
      const res = await apiFetch(`/reports/generate?period=${period}`, { method: "POST" });
      if (!res.ok) {
        setAiError(t("reports.ai.error"));
        return;
      }
      setAiReport(await res.json());
    } catch {
      setAiError(t("reports.ai.error"));
    } finally {
      setAiLoading(null);
    }
  }, [t]);

  const sendReportTelegram = useCallback(async () => {
    if (!aiReport) return;
    setTgSending(true);
    setTgNote(null);
    try {
      const res = await apiFetch(`/reports/send-telegram?period=${aiReport.period}`, { method: "POST" });
      setTgNote(res.ok ? t("reports.ai.tgSent") : t("reports.ai.tgError"));
    } catch {
      setTgNote(t("reports.ai.tgError"));
    } finally {
      setTgSending(false);
    }
  }, [aiReport, t]);

  const loadCompanies = useCallback(async () => {
    const res = await apiFetch("/companies");
    if (res.ok) setCompanies(await res.json());
  }, []);

  const loadEvents = useCallback(async () => {
    const [alertRes, emergencyRes] = await Promise.all([
      apiFetch("/alert-events?limit=500"),
      apiFetch("/emergencies?limit=500"),
    ]);
    if (alertRes.ok) {
      setEventsError(null);
      setEvents(await alertRes.json());
    } else {
      setEventsError(t("reports.loadError"));
    }
    if (emergencyRes.ok) {
      setEmergenciesError(null);
      setEmergencies(await emergencyRes.json());
    } else {
      setEmergenciesError(t("reports.emergencyLoadError"));
    }
  }, [t]);

  useEffect(() => {
    loadCompanies();
    loadEvents();
  }, [loadCompanies, loadEvents]);

  const co = companyId ? `&company_id=${encodeURIComponent(companyId)}` : "";

  const exportCsv = (p: Period) => {
    void downloadReport(`/reports/readings.csv?period=${p}${co}`, `sensor_readings_${p}.csv`);
  };

  const exportXlsx = (p: Period) => {
    void downloadReport(`/reports/readings.xlsx?period=${p}${co}`, `sensor_readings_${p}.xlsx`);
  };

  const periodLabel = (p: Period) => {
    if (p === "1d") return t("reports.lastDay");
    if (p === "7d") return t("reports.lastWeek");
    return t("reports.lastMonth");
  };

  const th: React.CSSProperties = {
    padding: "10px 8px",
    textAlign: "left",
    color: "#94a3b8",
    fontSize: 12,
    borderBottom: "1px solid #334155",
  };
  const td: React.CSSProperties = {
    padding: "10px 8px",
    borderBottom: "1px solid #1e293b",
    fontSize: 13,
  };

  return (
    <div style={{ padding: "24px 28px 48px", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>{t("reports.title")}</h1>
      <p style={{ color: "#64748b", fontSize: 14, marginTop: 0 }}>
        {t("reports.subtitle")}
      </p>

      <section
        style={{
          marginTop: 24,
          padding: 22,
          background: "#1e293b",
          borderRadius: 12,
          border: "1px solid #334155",
        }}
      >
        <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>{t("reports.ai.title")}</h2>
        <p style={{ color: "#64748b", fontSize: 13, marginTop: 0 }}>{t("reports.ai.subtitle")}</p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
          <button
            type="button"
            style={{ ...btnPrimary, opacity: aiLoading ? 0.7 : 1 }}
            disabled={aiLoading !== null}
            onClick={() => generateAiReport("day")}
          >
            {aiLoading === "day" ? t("reports.ai.generating") : t("reports.ai.dayBtn")}
          </button>
          <button
            type="button"
            style={{ ...btn, opacity: aiLoading ? 0.7 : 1 }}
            disabled={aiLoading !== null}
            onClick={() => generateAiReport("week")}
          >
            {aiLoading === "week" ? t("reports.ai.generating") : t("reports.ai.weekBtn")}
          </button>
        </div>

        {aiError && <p style={{ color: "#f87171", fontSize: 13 }}>{aiError}</p>}

        {aiLoading && (
          <div style={{ color: "#94a3b8", fontSize: 13, padding: "8px 0" }}>
            ⏳ {t("reports.ai.generatingHint")}
          </div>
        )}

        {aiReport && !aiLoading && (
          <div style={{ marginTop: 12 }}>
            {aiReport.coverage_note && (
              <div style={{
                display: "inline-block", padding: "4px 10px", borderRadius: 8,
                background: "#422006", color: "#fdba74", fontSize: 12, fontWeight: 600,
                marginBottom: 12, border: "1px solid #7c2d12",
              }}>
                ⚠ {aiReport.coverage_note}
              </div>
            )}

            <div style={{
              background: "#0f172a", border: "1px solid #334155", borderRadius: 10,
              padding: 16, whiteSpace: "pre-wrap", lineHeight: 1.55, fontSize: 14,
              color: aiReport.text_available ? "#e2e8f0" : "#94a3b8",
            }}>
              {aiReport.text_available
                ? aiReport.summary_text
                : `⚠ ${t("reports.ai.textUnavailable")}`}
            </div>

            {aiReport.aggregates.length > 0 && (
              <div style={{ overflowX: "auto", marginTop: 14, border: "1px solid #334155", borderRadius: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th style={th}>{t("reports.colDevice")}</th>
                      <th style={th}>{t("reports.colMetric")}</th>
                      <th style={th}>{t("reports.ai.min")}</th>
                      <th style={th}>{t("reports.ai.max")}</th>
                      <th style={th}>{t("reports.ai.avg")}</th>
                      <th style={th}>{t("reports.ai.latest")}</th>
                      <th style={th}>{t("reports.ai.count")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiReport.aggregates.map((a) => (
                      <tr key={a.device_id + a.metric}>
                        <td style={td}>{a.device_label}</td>
                        <td style={td}>{a.metric}</td>
                        <td style={td}>{a.min} {a.unit}</td>
                        <td style={td}>{a.max} {a.unit}</td>
                        <td style={td}>{a.avg} {a.unit}</td>
                        <td style={td}>{a.latest ?? "—"} {a.latest != null ? a.unit : ""}</td>
                        <td style={td}>{a.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
              <button
                type="button"
                style={{ ...btn, opacity: tgSending ? 0.7 : 1 }}
                disabled={tgSending}
                onClick={() => sendReportTelegram()}
              >
                {tgSending ? t("reports.ai.tgSending") : t("reports.ai.tgBtn")}
              </button>
              {tgNote && <span style={{ fontSize: 13, color: "#94a3b8" }}>{tgNote}</span>}
            </div>
          </div>
        )}
      </section>

      <section
        style={{
          marginTop: 24,
          padding: 22,
          background: "#1e293b",
          borderRadius: 12,
          border: "1px solid #334155",
        }}
      >
        <h2 style={{ margin: "0 0 14px", fontSize: 16 }}>{t("reports.exportReadings")}</h2>
        <label style={{ display: "block", fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>
          {t("reports.officeFilter")}
        </label>
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #475569",
            background: "#0f172a",
            color: "#f1f5f9",
            fontSize: 14,
            minWidth: 280,
            marginBottom: 18,
          }}
        >
          <option value="">{t("reports.allDevices")}</option>
          {companies.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.name}
            </option>
          ))}
        </select>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {(["1d", "7d", "30d"] as const).map((p) => (
            <div key={p} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <span style={{ width: 140, fontWeight: 600, color: "#cbd5e1" }}>
                {periodLabel(p)}
              </span>
              <button type="button" style={btnPrimary} onClick={() => exportCsv(p)}>
                CSV
              </button>
              <button type="button" style={btn} onClick={() => exportXlsx(p)}>
                Excel (.xlsx)
              </button>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{t("reports.emergencyHistory")}</h2>
        <p style={{ color: "#64748b", fontSize: 13 }}>
          {t("reports.emergencyHistoryHint")}
        </p>
        {emergenciesError && <p style={{ color: "#f87171" }}>{emergenciesError}</p>}
        <div style={{ overflowX: "auto", marginTop: 12, border: "1px solid #7f1d1d", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
            <thead>
              <tr>
                <th style={th}>{t("reports.colTime")}</th>
                <th style={th}>{t("reports.colDevice")}</th>
                <th style={th}>{t("reports.colStatus")}</th>
                <th style={th}>Temp</th>
                <th style={th}>CO2</th>
                <th style={th}>{t("reports.colTelegram")}</th>
                <th style={th}>{t("reports.colAck")}</th>
              </tr>
            </thead>
            <tbody>
              {emergencies.map((e) => (
                <tr key={e.id}>
                  <td style={td}>{new Date(e.started_at).toLocaleString()}</td>
                  <td style={td}>{e.device_id || e.key}</td>
                  <td style={{ ...td, color: e.status === "cleared" ? "#4ade80" : "#f87171", fontWeight: 700 }}>{e.status}</td>
                  <td style={td}>{e.temperature} (+{e.temperature_rate}/min)</td>
                  <td style={td}>{e.co2} (+{e.co2_rate}/min)</td>
                  <td style={td}>{e.telegram_sent ? t("common.yes") : t("common.no")}</td>
                  <td style={td}>{e.acknowledged_at ? new Date(e.acknowledged_at).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {emergencies.length === 0 && !emergenciesError && (
            <div style={{ padding: 24, color: "#475569", fontSize: 14 }}>{t("reports.noEmergencyEvents")}</div>
          )}
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("reports.alertHistory")}</h2>
          <button type="button" style={btn} onClick={() => loadEvents()}>
            {t("common.refresh")}
          </button>
        </div>
        <p style={{ color: "#64748b", fontSize: 13 }}>
          {t("reports.alertHistoryHint")}
        </p>
        {eventsError && <p style={{ color: "#f87171" }}>{eventsError}</p>}
        <div style={{ overflowX: "auto", marginTop: 12, border: "1px solid #334155", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr>
                <th style={th}>{t("reports.colTime")}</th>
                <th style={th}>{t("reports.colDevice")}</th>
                <th style={th}>{t("reports.colMetric")}</th>
                <th style={th}>{t("reports.colValue")}</th>
                <th style={th}>{t("reports.colThreshold")}</th>
                <th style={th}>{t("reports.colDir")}</th>
                <th style={th}>{t("reports.colTelegram")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td style={td}>{new Date(e.created_at).toLocaleString()}</td>
                  <td style={td}>{e.device_label || e.device_id}</td>
                  <td style={td}>{e.metric}</td>
                  <td style={td}>{e.value}</td>
                  <td style={td}>{e.threshold}</td>
                  <td style={td}>{e.direction}</td>
                  <td style={td}>{e.telegram_sent ? t("common.yes") : t("common.no")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.length === 0 && !eventsError && (
            <div style={{ padding: 24, color: "#475569", fontSize: 14 }}>{t("reports.noEvents")}</div>
          )}
        </div>
      </section>
    </div>
  );
}
