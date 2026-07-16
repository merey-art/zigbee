import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { isEmergencyMessage, useDashboardWs, type EmergencyMessage } from "../context/WsContext";
import { playEmergencyBeep } from "../util/alarmBeep";

interface EmergencyApiRow {
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
  started_at: string;
  last_seen_at: string;
  acknowledged_at: string | null;
  cleared_at: string | null;
}

function apiRowToEmergencyMessage(row: EmergencyApiRow): EmergencyMessage {
  return {
    type: "emergency",
    status: "active",
    event_id: row.id,
    key: row.key,
    device_id: row.device_id,
    temp_device_id: row.temp_device_id,
    co2_device_id: row.co2_device_id,
    zone_id: row.zone_id,
    temperature: row.temperature,
    co2: row.co2,
    temperature_rate: row.temperature_rate,
    co2_rate: row.co2_rate,
    consecutive_readings: 0,
    started_at: row.started_at,
    last_seen_at: row.last_seen_at,
    acknowledged_at: row.acknowledged_at,
    cleared_at: row.cleared_at,
  };
}

function sortByStartedAt(events: EmergencyMessage[]): EmergencyMessage[] {
  return [...events].sort((a, b) => a.started_at.localeCompare(b.started_at));
}

function upsertActiveEvent(
  queue: EmergencyMessage[],
  msg: EmergencyMessage,
  dismissedEvents: Set<number>,
): EmergencyMessage[] {
  if (dismissedEvents.has(msg.event_id)) return queue;
  const existing = queue.find((item) => item.event_id === msg.event_id);
  if (existing) {
    return sortByStartedAt(queue.map((item) => (item.event_id === msg.event_id ? msg : item)));
  }
  return sortByStartedAt([...queue, msg]);
}

function removeActiveEvent(queue: EmergencyMessage[], eventId: number): EmergencyMessage[] {
  return queue.filter((item) => item.event_id !== eventId);
}

function beepForEvent(eventId: number, beepedEvents: Set<number>) {
  if (beepedEvents.has(eventId)) return;
  beepedEvents.add(eventId);
  void playEmergencyBeep().catch(() => undefined);
}

export function EmergencyBanner() {
  const { t } = useTranslation();
  const { subscribeMessages } = useDashboardWs();
  const [activeQueue, setActiveQueue] = useState<EmergencyMessage[]>([]);
  const [acking, setAcking] = useState(false);
  const beepedEvents = useRef<Set<number>>(new Set());
  const dismissedEvents = useRef<Set<number>>(new Set());

  const active = activeQueue[0] ?? null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch("/emergencies?status=active&limit=2000");
        if (!res.ok || cancelled) return;
        const rows = (await res.json()) as EmergencyApiRow[];
        if (rows.length === 0 || cancelled) return;
        setActiveQueue((current) => {
          let next = current;
          for (const row of rows) {
            const msg = apiRowToEmergencyMessage(row);
            beepForEvent(msg.event_id, beepedEvents.current);
            next = upsertActiveEvent(next, msg, dismissedEvents.current);
          }
          return next;
        });
      } catch {
        // fetch failure is non-fatal; WS subscription still handles live events
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return subscribeMessages((raw) => {
      if (!isEmergencyMessage(raw)) return;

      if (raw.status === "active") {
        setActiveQueue((current) => {
          beepForEvent(raw.event_id, beepedEvents.current);
          return upsertActiveEvent(current, raw, dismissedEvents.current);
        });
        return;
      }

      if (raw.status === "acknowledged" || raw.status === "cleared") {
        dismissedEvents.current.add(raw.event_id);
        setActiveQueue((current) => removeActiveEvent(current, raw.event_id));
      }
    });
  }, [subscribeMessages]);

  if (!active) return null;

  const ack = async () => {
    setAcking(true);
    try {
      const res = await apiFetch(`/emergencies/${active.event_id}/ack`, { method: "POST" });
      if (res.ok) {
        dismissedEvents.current.add(active.event_id);
        setActiveQueue((current) => removeActiveEvent(current, active.event_id));
      }
    } finally {
      setAcking(false);
    }
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(127, 29, 29, 0.96)",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 760, textAlign: "center" }}>
        <div style={{ fontSize: 72, lineHeight: 1 }}>🚨</div>
        <h1 style={{ fontSize: 44, margin: "16px 0 12px", fontWeight: 900 }}>
          {t("emergency.title")}
        </h1>
        <p style={{ fontSize: 22, margin: "0 0 24px", fontWeight: 700 }}>
          {t("emergency.subtitle")}
        </p>
        {activeQueue.length > 1 && (
          <p style={{ fontSize: 16, margin: "0 0 16px", opacity: 0.9 }}>
            {t("emergency.queueCount", { count: activeQueue.length, defaultValue: "{{count}} active emergencies" })}
          </p>
        )}
        <div style={{ fontSize: 18, lineHeight: 1.8, marginBottom: 28 }}>
          <div>{t("emergency.device")}: {active.device_id || active.key}</div>
          <div>Temp: {active.temperature}°C (+{active.temperature_rate}/min)</div>
          <div>CO2: {active.co2} ppm (+{active.co2_rate}/min)</div>
        </div>
        <button
          type="button"
          onClick={() => void ack()}
          disabled={acking}
          style={{
            border: "2px solid #fff",
            background: "#fff",
            color: "#7f1d1d",
            borderRadius: 12,
            padding: "14px 28px",
            fontSize: 20,
            fontWeight: 900,
            cursor: acking ? "wait" : "pointer",
          }}
        >
          {acking ? t("common.loading") : t("emergency.ack")}
        </button>
      </div>
    </div>
  );
}
