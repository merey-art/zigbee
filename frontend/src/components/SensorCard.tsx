import React from "react";

interface Props {
  label: string;
  value: number | null;
  unit: string;
  icon: string;
  /** Optional colour accent for the value display */
  accent?: string;
  updatedAt?: string;
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
}) => {
  const displayValue = value !== null ? value.toFixed(1) : "—";
  const timeLabel = updatedAt
    ? new Date(updatedAt).toLocaleTimeString()
    : null;

  return (
    <div style={CARD_STYLE}>
      <span style={LABEL_STYLE}>
        <span role="img" aria-label={label}>{icon}</span>
        {label}
      </span>
      <div>
        <span style={VALUE_STYLE(accent)}>{displayValue}</span>
        <span style={UNIT_STYLE}>{unit}</span>
      </div>
      {timeLabel && <span style={TIME_STYLE}>Updated {timeLabel}</span>}
    </div>
  );
};
