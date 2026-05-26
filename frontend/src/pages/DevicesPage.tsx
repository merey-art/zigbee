import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { useDashboardWs, isBridgeEvent } from "../context/WsContext";

interface BridgeDeviceRow {
  friendly_name?: string | null;
  ieee_address?: string | null;
  last_seen?: string | null;
  battery?: number | null;
}

interface DashboardDeviceRow {
  device_id: string;
  company_id?: number | null;
}

interface CompanyOption {
  id: number;
  name: string;
}

const JOIN_SECONDS = 254;

function normIeee(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

export default function DevicesPage() {
  const { t } = useTranslation();
  const { lastMessage } = useDashboardWs();
  const [devices, setDevices] = useState<BridgeDeviceRow[]>([]);
  const [dashboardDevices, setDashboardDevices] = useState<DashboardDeviceRow[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);

  const [joinEndsAt, setJoinEndsAt] = useState<number | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);

  const [editingIeee, setEditingIeee] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [removeIeee, setRemoveIeee] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    const res = await apiFetch("/bridge/devices");
    if (!res.ok) {
      setLoadError(t("devices.loadError"));
      return;
    }
    setLoadError(null);
    const json = (await res.json()) as BridgeDeviceRow[];
    setDevices(Array.isArray(json) ? json : []);
  }, [t]);

  const loadAssignments = useCallback(async () => {
    const [dr, cr] = await Promise.all([apiFetch("/devices"), apiFetch("/companies")]);
    if (dr.ok) setDashboardDevices(await dr.json());
    if (cr.ok) setCompanies(await cr.json());
  }, []);

  useEffect(() => {
    loadDevices();
    loadAssignments();
    const id = setInterval(() => {
      loadDevices();
      loadAssignments();
    }, 15_000);
    return () => clearInterval(id);
  }, [loadDevices, loadAssignments]);

  useEffect(() => {
    if (!lastMessage || !isBridgeEvent(lastMessage)) return;
    const snippet = JSON.stringify(lastMessage.payload).slice(0, 280);
    const line = `${lastMessage.timestamp} — ${snippet}`;
    setEvents((prev) => [line, ...prev].slice(0, 40));
    loadDevices();
    loadAssignments();
  }, [lastMessage, loadDevices, loadAssignments]);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!joinEndsAt) return;
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [joinEndsAt]);

  const joinRemaining = useMemo(() => {
    if (!joinEndsAt) return 0;
    return Math.max(0, Math.ceil((joinEndsAt - Date.now()) / 1000));
  }, [joinEndsAt, tick]);

  useEffect(() => {
    if (!joinEndsAt) return;
    if (Date.now() >= joinEndsAt) setJoinEndsAt(null);
  }, [tick, joinEndsAt]);

  const startJoin = async () => {
    setJoinBusy(true);
    try {
      const res = await apiFetch("/bridge/permit_join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time: JOIN_SECONDS }),
      });
      if (!res.ok) {
        alert(t("devices.permitJoinError"));
        return;
      }
      setJoinEndsAt(Date.now() + JOIN_SECONDS * 1000);
    } finally {
      setJoinBusy(false);
    }
  };

  const saveRename = async (ieee: string) => {
    const name = editName.trim();
    if (!name) return;
    const res = await apiFetch(`/bridge/device/${encodeURIComponent(ieee)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendly_name: name }),
    });
    if (!res.ok) {
      alert(t("devices.renameError"));
      return;
    }
    setEditingIeee(null);
    loadDevices();
  };

  const companyForIeee = (ieee: string): number | "" => {
    if (!ieee) return "";
    const k = normIeee(ieee);
    const hit = dashboardDevices.find((d) => normIeee(d.device_id) === k);
    if (hit?.company_id === undefined || hit?.company_id === null) return "";
    return hit.company_id;
  };

  const assignCompany = async (ieee: string, companyId: number | null) => {
    const res = await apiFetch(`/devices/${encodeURIComponent(ieee)}/company`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId }),
    });
    if (!res.ok) {
      alert(t("devices.companyError"));
      return;
    }
    loadAssignments();
  };

  const confirmRemove = async () => {
    if (!removeIeee) return;
    const res = await apiFetch(`/bridge/device/${encodeURIComponent(removeIeee)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      alert(t("common.error"));
      return;
    }
    setRemoveIeee(null);
    loadDevices();
    loadAssignments();
  };

  return (
    <div style={{ padding: "24px 28px 48px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
        <h1 style={{ margin: 0, flex: "1 1 auto", fontSize: 22 }}>{t("devices.title")}</h1>
        <button
          type="button"
          disabled={joinBusy || joinRemaining > 0}
          onClick={startJoin}
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            border: "none",
            background: joinRemaining > 0 ? "#475569" : "#22c55e",
            color: "#0f172a",
            fontWeight: 700,
            cursor: joinBusy ? "wait" : "pointer",
          }}
        >
          {joinRemaining > 0
            ? t("devices.adding", { sec: joinRemaining })
            : t("devices.addDevice")}
        </button>
      </div>
      <p style={{ color: "#64748b", fontSize: 14 }}>
        {t("devices.pairingHint", { sec: JOIN_SECONDS })}
      </p>

      {loadError && <p style={{ color: "#f87171", marginBottom: 12 }}>{loadError}</p>}

      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#94a3b8" }}>
              <th style={th}>{t("devices.colName")}</th>
              <th style={th}>{t("devices.colIeee")}</th>
              <th style={th}>{t("devices.colLastSeen")}</th>
              <th style={th}>{t("devices.colBattery")}</th>
              <th style={th}>{t("devices.colCompany")}</th>
              <th style={th}>{t("devices.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => {
              const ieee = d.ieee_address ?? "";
              const name = d.friendly_name ?? ieee;
              const isEditing = editingIeee === ieee;
              return (
                <tr key={ieee || name} style={{ borderTop: "1px solid #334155" }}>
                  <td style={td}>
                    {isEditing ? (
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => saveRename(ieee)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveRename(ieee);
                          if (e.key === "Escape") setEditingIeee(null);
                        }}
                        autoFocus
                        style={inpSmall}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingIeee(ieee);
                          setEditName(String(name));
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#38bdf8",
                          cursor: "pointer",
                          padding: 0,
                          fontSize: 14,
                          textDecoration: "underline",
                        }}
                      >
                        {name}
                      </button>
                    )}
                  </td>
                  <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{ieee || "—"}</td>
                  <td style={td}>{d.last_seen ? String(d.last_seen) : "—"}</td>
                  <td style={td}>
                    {d.battery !== null && d.battery !== undefined ? `${d.battery}%` : "—"}
                  </td>
                  <td style={td}>
                    <select
                      value={companyForIeee(ieee) === "" ? "" : String(companyForIeee(ieee))}
                      onChange={(e) => {
                        const v = e.target.value;
                        void assignCompany(ieee, v === "" ? null : Number(v));
                      }}
                      style={selStyle}
                    >
                      <option value="">—</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={td}>
                    <button type="button" style={btnDanger} onClick={() => setRemoveIeee(ieee)}>
                      {t("devices.remove")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 15, color: "#94a3b8", marginBottom: 10 }}>{t("devices.bridgeActivity")}</h2>
        <div
          style={{
            background: "#1e293b",
            borderRadius: 12,
            border: "1px solid #334155",
            padding: 12,
            maxHeight: 220,
            overflowY: "auto",
            fontSize: 12,
            fontFamily: "monospace",
            color: "#cbd5e1",
          }}
        >
          {events.length === 0 ? (
            <span style={{ color: "#475569" }}>{t("devices.noBridgeEvents")}</span>
          ) : (
            events.map((line, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                {line}
              </div>
            ))
          )}
        </div>
      </section>

      {removeIeee && (
        <div style={modalBackdrop}>
          <div style={modalBox}>
            <h2 style={{ marginTop: 0 }}>{t("devices.removeTitle")}</h2>
            <p style={{ color: "#94a3b8", wordBreak: "break-all" }}>{removeIeee}</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" style={btnGhost} onClick={() => setRemoveIeee(null)}>
                {t("common.cancel")}
              </button>
              <button type="button" style={{ ...btnGhost, background: "#dc2626", border: "none" }} onClick={confirmRemove}>
                {t("devices.remove")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 8px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "12px 8px", verticalAlign: "middle" };
const inpSmall: React.CSSProperties = {
  width: "100%",
  maxWidth: 240,
  boxSizing: "border-box",
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid #475569",
  background: "#0f172a",
  color: "#f1f5f9",
};
const btnDanger: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #991b1b",
  background: "transparent",
  color: "#fca5a5",
  cursor: "pointer",
};
const modalBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.75)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
  padding: 16,
};
const modalBox: React.CSSProperties = {
  background: "#1e293b",
  borderRadius: 14,
  padding: 24,
  maxWidth: 420,
  width: "100%",
  border: "1px solid #334155",
};
const selStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid #475569",
  background: "#0f172a",
  color: "#e2e8f0",
  fontSize: 13,
  maxWidth: 200,
};

const btnGhost: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #475569",
  background: "transparent",
  color: "#e2e8f0",
  cursor: "pointer",
};
