/** Traffic-light style health for dashboard cards (management-friendly bands). */

import type { CSSProperties } from "react";

// ── Staleness ────────────────────────────────────────────────────

export type StaleTone = "fresh" | "stale" | "dead";

/** Returns how stale the last reading is. */
export function staleTone(recordedAt: string | null | undefined): StaleTone {
  if (!recordedAt) return "dead";
  const ageMs = Date.now() - new Date(recordedAt).getTime();
  if (ageMs < 15 * 60 * 1000) return "fresh";
  if (ageMs < 6 * 60 * 60 * 1000) return "stale";
  return "dead";
}

/** Human-readable "X мин назад / Xч назад / Xд назад". */
export function staleLabel(recordedAt: string | null | undefined): string | null {
  if (!recordedAt) return null;
  const ageMs = Date.now() - new Date(recordedAt).getTime();
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 1) return null;
  if (mins < 60) return `${mins} мин назад`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}ч назад`;
  const days = Math.floor(hrs / 24);
  return `${days}д назад`;
}

export type HealthTone = "good" | "warn" | "bad";

export function metricHealthTone(metric: string, value: number | null): HealthTone | null {
  if (value === null || Number.isNaN(value)) return null;

  switch (metric) {
    case "co2":
      if (value < 800) return "good";
      if (value < 1000) return "warn";
      return "bad";
    case "temperature":
      if (value >= 18 && value <= 26) return "good";
      if ((value >= 16 && value < 18) || (value > 26 && value <= 28)) return "warn";
      return "bad";
    case "humidity":
      if (value >= 35 && value <= 65) return "good";
      if ((value >= 28 && value < 35) || (value > 65 && value <= 75)) return "warn";
      return "bad";
    case "battery":
      if (value >= 40) return "good";
      if (value >= 20) return "warn";
      return "bad";
    case "linkquality":
      if (value >= 150) return "good";
      if (value >= 80) return "warn";
      return "bad";
    default:
      return "good";
  }
}

export function healthCardStyle(tone: HealthTone | null): CSSProperties {
  if (!tone) return {};
  const ring = {
    good: { border: "1px solid #166534", boxShadow: "0 0 0 1px #22c55e44 inset", background: "#052e1622" },
    warn: { border: "1px solid #a16207", boxShadow: "0 0 0 1px #eab30844 inset", background: "#42200622" },
    bad: { border: "1px solid #991b1b", boxShadow: "0 0 0 1px #ef444444 inset", background: "#450a0a22" },
  }[tone];
  return ring;
}
