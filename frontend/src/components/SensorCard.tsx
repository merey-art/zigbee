import React from "react";
import { healthCardStyle, metricHealthTone, staleTone, staleLabel } from "../util/metricHealth";

interface Props {
  label: string;
  value: number | null;
  unit: string;
  icon: string;
  /** Optional colour accent for the value display */
  accent?: string;
  updatedAt?: string;
  /** When set with numeric value, card gets green/yellow/red band (comfort thresholds). */
  metricId?: string;
}

const CARD_STYLE: React.CSSProperties = {
  background: "#1e293b",
  borderRadius: 16,
  padding: "20px 24px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minWidth: 180,
  boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
  flex: "1 1 180px",
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#94a3b8",
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const VALUE_STYLE = (accent: string): React.CSSProperties => ({
  fontSize: 42,
  fontWeight: 700,
  lineHeight: 1,
  color: accent,
  fontVariantNumeric: "tabular-nums",
});

const UNIT_STYLE: React.CSSProperties = {
  fontSize: 18,
  color: "#64748b",
  marginLeft: 4,
  fontWeight: 500,
};

const TIME_STYLE: React.CSSProperties = {
  fontSize: 11,
  color: "#475569",
  marginTop: 4,
};

export const SensorCard: React.FC<Props> = ({
  label,
  value,
  unit,
  icon,
  accent = "#38bdf8",
  updatedAt,
  metricId,
}) => {
  const displayValue = value !== null ? value.toFixed(1) : "—";
  const tone = metricId ? metricHealthTone(metricId, value) : null;
  const stale = staleTone(updatedAt);
  const ageLabel = staleLabel(updatedAt);

  const staleCardStyle: React.CSSProperties = stale === "dead"
    ? { border: "1px solid #44403c", opacity: 0.7 }
    : stale === "stale"
    ? { border: "1px solid #a16207" }
    : {};

  const cardSurface: React.CSSProperties = {
    ...CARD_STYLE,
    ...(stale === "fresh" ? healthCardStyle(tone) : staleCardStyle),
  };
  const valueColor = stale !== "fresh"
    ? (stale === "dead" ? "#64748b" : "#fb923c")
    : tone === "bad" ? "#f87171" : tone === "warn" ? "#fbbf24" : tone === "good" ? "#86efac" : accent;

  return (
    <div style={cardSurface}>
      <span style={LABEL_STYLE}>
        <span role="img" aria-label={label}>{icon}</span>
        {label}
      </span>
      <div>
        <span style={VALUE_STYLE(valueColor)}>{displayValue}</span>
        <span style={UNIT_STYLE}>{unit}</span>
      </div>
      {stale !== "fresh" && ageLabel && (
        <span style={{ fontSize: 11, color: stale === "dead" ? "#64748b" : "#fb923c", marginTop: 2, fontWeight: 600 }}>
          ⚠ {ageLabel}
        </span>
      )}
      {stale === "fresh" && ageLabel && (
        <span style={TIME_STYLE}>{ageLabel}</span>
      )}
    </div>
  );
};
