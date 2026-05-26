import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";

const METRICS = [
  "temperature",
  "humidity",
  "co2",
  "linkquality",
  "battery",
  "voltage",
  "pressure",
] as const;

interface DeviceOption {
  device_id: string;
  friendly_name?: string | null;
}

interface MeProfile {
  email: string;
  telegram_chat_id: string | null;
}

interface AlertRuleRow {
  id: number;
  user_id: number;
  device_id: string | null;
  metric: string;
  direction: string;
  threshold: number;
  cooldown_seconds: number;
  enabled: boolean;
  created_at: string;
}

const btnPrimary: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "none",
  background: "#3b82f6",
  color: "#fff",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #475569",
  background: "#1e293b",
  color: "#e2e8f0",
  cursor: "pointer",
  fontSize: 13,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 360,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #475569",
  background: "#0f172a",
  color: "#f1f5f9",
  fontSize: 14,
  boxSizing: "border-box",
};

export default function AlertsPage() {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [rules, setRules] = useState<AlertRuleRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newDevice, setNewDevice] = useState<string>("");
  const [newMetric, setNewMetric] = useState<string>("co2");
  const [newDirection, setNewDirection] = useState<"above" | "below">("above");
  const [newThreshold, setNewThreshold] = useState<string>("1000");
  const [newCooldownMin, setNewCooldownMin] = useState<string>("15");

  const refresh = useCallback(async () => {
    const [pr, dr, rr] = await Promise.all([
      apiFetch("/me"),
      apiFetch("/devices"),
      apiFetch("/alert-rules"),
    ]);
    if (pr.ok) {
      const p = (await pr.json()) as MeProfile;
      setProfile(p);
      setChatInput(p.telegram_chat_id ?? "");
    }
    if (dr.ok) setDevices(await dr.json());
    if (rr.ok) setRules(await rr.json());
    if (!pr.ok || !rr.ok) {
      setLoadError(t("alerts.loadError"));
    } else {
      setLoadError(null);
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveTelegram = async () => {
    const res = await apiFetch("/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_chat_id: chatInput.trim() || null }),
    });
    if (!res.ok) {
      alert(t("alerts.saveError"));
      return;
    }
    setProfile(await res.json());
    alert(t("alerts.saved"));
  };

  const sendTest = async () => {
    const res = await apiFetch("/me/telegram/test", { method: "POST" });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { detail?: string };
      alert(typeof d.detail === "string" ? d.detail : t("alerts.sendError"));
      return;
    }
    alert(t("alerts.checkTelegram"));
  };

  const addRule = async () => {
    const threshold = Number(newThreshold);
    if (Number.isNaN(threshold)) {
      alert(t("alerts.thresholdError"));
      return;
    }
    const cdMin = Number(newCooldownMin);
    const cooldown_seconds = Math.round(cdMin * 60);
    if (cooldown_seconds < 60 || cooldown_seconds > 86400) {
      alert(t("alerts.cooldownError"));
      return;
    }
    const body = {
      device_id: newDevice || null,
      metric: newMetric,
      direction: newDirection,
      threshold,
      cooldown_seconds,
      enabled: true,
    };
    const res = await apiFetch("/alert-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { detail?: unknown };
      const msg =
        typeof d.detail === "string"
          ? d.detail
          : Array.isArray(d.detail)
            ? JSON.stringify(d.detail)
            : t("alerts.createError");
      alert(msg);
      return;
    }
    refresh();
  };

  const toggleRule = async (r: AlertRuleRow) => {
    const res = await apiFetch(`/alert-rules/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !r.enabled }),
    });
    if (!res.ok) alert(t("alerts.genericError"));
    else refresh();
  };

  const deleteRule = async (id: number) => {
    if (!confirm(t("alerts.deleteRule"))) return;
    const res = await apiFetch(`/alert-rules/${id}`, { method: "DELETE" });
    if (!res.ok) alert(t("alerts.genericError"));
    else refresh();
  };

  const th: React.CSSProperties = { padding: "10px 8px", fontWeight: 600, color: "#94a3b8" };
  const td: React.CSSProperties = { padding: "10px 8px", borderTop: "1px solid #334155" };

  return (
    <div style={{ padding: "24px 28px 48px", maxWidth: 920, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>{t("alerts.title")}</h1>
      <p style={{ color: "#64748b", fontSize: 14, marginTop: 0 }}>
        {t("alerts.subtitle")}
      </p>

      {loadError && <p style={{ color: "#f87171" }}>{loadError}</p>}

      <section
        style={{
          marginTop: 24,
          padding: 20,
          background: "#1e293b",
          borderRadius: 12,
          border: "1px solid #334155",
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>{t("alerts.yourTelegram")}</h2>
        {profile && (
          <p style={{ margin: "0 0 12px", color: "#94a3b8", fontSize: 13 }}>{profile.email}</p>
        )}
        <label style={{ display: "block", fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>
          {t("alerts.chatId")}
        </label>
        <input
          style={inputStyle}
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          placeholder={t("alerts.chatIdPlaceholder")}
        />
        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button type="button" style={btnPrimary} onClick={saveTelegram}>
            {t("common.save")}
          </button>
          <button type="button" style={btnGhost} onClick={sendTest}>
            {t("alerts.testMessage")}
          </button>
        </div>
      </section>

      <section
        style={{
          marginTop: 24,
          padding: 20,
          background: "#1e293b",
          borderRadius: 12,
          border: "1px solid #334155",
        }}
      >
        <h2 style={{ margin: "0 0 16px", fontSize: 16 }}>{t("alerts.newRule")}</h2>
        <div style={{ display: "grid", gap: 14, maxWidth: 480 }}>
          <div>
            <label style={{ display: "block", fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>
              {t("alerts.device")}
            </label>
            <select
              style={inputStyle}
              value={newDevice}
              onChange={(e) => setNewDevice(e.target.value)}
            >
              <option value="">{t("alerts.allDevices")}</option>
              {devices.map((d) => (
                <option key={d.device_id} value={d.device_id}>
                  {(d.friendly_name || d.device_id).slice(0, 48)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>
              {t("alerts.metric")}
            </label>
            <select
              style={inputStyle}
              value={newMetric}
              onChange={(e) => setNewMetric(e.target.value)}
            >
              {METRICS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>
              {t("alerts.condition")}
            </label>
            <select
              style={inputStyle}
              value={newDirection}
              onChange={(e) => setNewDirection(e.target.value as "above" | "below")}
            >
              <option value="above">{t("alerts.above")}</option>
              <option value="below">{t("alerts.below")}</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>
              {t("alerts.threshold")}
            </label>
            <input
              style={inputStyle}
              value={newThreshold}
              onChange={(e) => setNewThreshold(e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>
              {t("alerts.cooldown")}
            </label>
            <input
              style={inputStyle}
              value={newCooldownMin}
              onChange={(e) => setNewCooldownMin(e.target.value)}
            />
          </div>
          <button type="button" style={btnPrimary} onClick={addRule}>
            {t("alerts.addRule")}
          </button>
        </div>
      </section>

      <h2 style={{ margin: "28px 0 12px", fontSize: 16 }}>{t("alerts.activeRules")}</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left" }}>
            <th style={th}>{t("alerts.colEnabled")}</th>
            <th style={th}>{t("alerts.colDevice")}</th>
            <th style={th}>{t("alerts.colMetric")}</th>
            <th style={th}>{t("alerts.colCondition")}</th>
            <th style={th}>{t("alerts.colThreshold")}</th>
            <th style={th}>{t("alerts.colCooldown")}</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id}>
              <td style={td}>
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={() => toggleRule(r)}
                  aria-label="enabled"
                />
              </td>
              <td style={td}>{r.device_id ?? t("alerts.allDevicesRow")}</td>
              <td style={td}>{r.metric}</td>
              <td style={td}>{r.direction === "above" ? t("alerts.aboveShort") : t("alerts.belowShort")}</td>
              <td style={td}>{r.threshold}</td>
              <td style={td}>{t("alerts.minutes", { n: Math.round(r.cooldown_seconds / 60) })}</td>
              <td style={td}>
                <button type="button" style={btnGhost} onClick={() => deleteRule(r.id)}>
                  {t("common.delete")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rules.length === 0 && (
        <p style={{ color: "#64748b", fontSize: 14 }}>{t("alerts.noRules")}</p>
      )}
    </div>
  );
}
