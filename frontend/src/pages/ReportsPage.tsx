import React, { useCallback, useEffect, useState } from "react";
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
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [events, setEvents] = useState<AlertEventRow[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const loadCompanies = useCallback(async () => {
    const res = await apiFetch("/companies");
    if (res.ok) setCompanies(await res.json());
  }, []);

  const loadEvents = useCallback(async () => {
    const res = await apiFetch("/alert-events?limit=500");
    if (!res.ok) {
      setEventsError("Could not load alert history");
      return;
    }
    setEventsError(null);
    setEvents(await res.json());
  }, []);

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
      <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>Reports</h1>
      <p style={{ color: "#64748b", fontSize: 14, marginTop: 0 }}>
        Export raw sensor readings for management (CSV opens in Excel; XLSX is a native workbook).
        Optional office filter limits rows to devices assigned to that company.
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
        <h2 style={{ margin: "0 0 14px", fontSize: 16 }}>Export readings</h2>
        <label style={{ display: "block", fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>
          Office filter (optional)
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
          <option value="">All devices</option>
          {companies.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.name}
            </option>
          ))}
        </select>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {(["1d", "7d", "30d"] as const).map((p) => (
            <div key={p} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <span style={{ width: 100, fontWeight: 600, color: "#cbd5e1" }}>
                {p === "1d" ? "Last day" : p === "7d" ? "Last week" : "Last month"}
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Alert history</h2>
          <button type="button" style={btn} onClick={() => loadEvents()}>
            Refresh
          </button>
        </div>
        <p style={{ color: "#64748b", fontSize: 13 }}>
          Logged when a rule threshold is crossed (after cooldown). Telegram column shows whether a
          message was delivered.
        </p>
        {eventsError && <p style={{ color: "#f87171" }}>{eventsError}</p>}
        <div style={{ overflowX: "auto", marginTop: 12, border: "1px solid #334155", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr>
                <th style={th}>Time (UTC)</th>
                <th style={th}>Device</th>
                <th style={th}>Metric</th>
                <th style={th}>Value</th>
                <th style={th}>Threshold</th>
                <th style={th}>Dir</th>
                <th style={th}>Telegram</th>
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
                  <td style={td}>{e.telegram_sent ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.length === 0 && !eventsError && (
            <div style={{ padding: 24, color: "#475569", fontSize: 14 }}>No alert events yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
