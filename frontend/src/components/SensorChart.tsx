import React, { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { apiPath } from "../api/client";

interface ReadingPoint {
  recorded_at: string;
  value: number;
}

interface ForecastData {
  points: ReadingPoint[];
  slope_per_min: number;
  threshold: number | null;
  time_to_threshold_min: number | null;
}

const FORECAST_HORIZON_MIN = 30;

interface Props {
  deviceId: string;
  metric: string;
  unit: string;
  color?: string;
  /** Optional threshold line (e.g. 1000 ppm for CO2) */
  threshold?: number;
  /** How many latest points to show */
  limit?: number;
  /** Shown in chart header instead of raw device_id (e.g. friendly name) */
  titleLabel?: string;
}

const CHART_STYLE: React.CSSProperties = {
  background: "#1e293b",
  borderRadius: 16,
  padding: "20px 24px",
  boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
};

const TITLE_STYLE: React.CSSProperties = {
  margin: "0 0 16px",
  fontSize: 14,
  fontWeight: 600,
  color: "#94a3b8",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

export const SensorChart: React.FC<Props> = ({
  deviceId,
  metric,
  unit,
  color = "#38bdf8",
  threshold,
  limit = 200,
  titleLabel,
}) => {
  const { t } = useTranslation();
  const [data, setData] = useState<ReadingPoint[]>([]);
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(
          `${apiPath(`/devices/${encodeURIComponent(deviceId)}/history`)}?metric=${metric}&limit=${limit}`,
          { credentials: "include" }
        );
        if (!res.ok) {
          setData([]);
          return;
        }
        const json = await res.json() as { readings: ReadingPoint[] };
        setData(json.readings);
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    };

    const fetchForecast = async () => {
      try {
        const res = await fetch(
          `${apiPath(`/devices/${encodeURIComponent(deviceId)}/forecast`)}?metric=${metric}&horizon_min=${FORECAST_HORIZON_MIN}`,
          { credentials: "include" }
        );
        if (!res.ok) {
          setForecast(null);
          return;
        }
        const json = await res.json() as { forecast: ForecastData | null };
        setForecast(json.forecast ?? null); // insufficient_data → just no forecast line
      } catch {
        setForecast(null);
      }
    };

    fetchData();
    fetchForecast();
    const id = setInterval(() => { fetchData(); fetchForecast(); }, 30_000); // refresh every 30 s
    return () => clearInterval(id);
  }, [deviceId, metric, limit]);

  const headerLabel = (titleLabel ?? deviceId).trim() || deviceId;

  const formatted: Array<{ time: string; value?: number; forecast?: number }> = data.map((d) => ({
    time: format(new Date(d.recorded_at), "HH:mm"),
    value: d.value,
  }));
  if (formatted.length > 0 && forecast && forecast.points.length > 0) {
    // Bridge point so the dashed line starts at the last real reading
    formatted[formatted.length - 1].forecast = data[data.length - 1].value;
    for (const p of forecast.points) {
      formatted.push({
        time: format(new Date(p.recorded_at), "HH:mm"),
        forecast: p.value,
      });
    }
  }

  const timeToThreshold = forecast?.time_to_threshold_min ?? null;
  const showThresholdEta = timeToThreshold !== null && timeToThreshold <= FORECAST_HORIZON_MIN;

  return (
    <div style={CHART_STYLE}>
      <p style={TITLE_STYLE}>
        {headerLabel} — {metric} ({unit})
      </p>
      {error ? (
        <p style={{ color: "#f87171" }}>{error}</p>
      ) : formatted.length === 0 ? (
        <p style={{ color: "#475569", fontSize: 13 }}>No data yet…</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={formatted} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
            <XAxis
              dataKey="time"
              tick={{ fill: "#64748b", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#334155" }}
            />
            <YAxis
              tick={{ fill: "#64748b", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#334155" }}
              unit={` ${unit}`}
            />
            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 8,
                color: "#f1f5f9",
                fontSize: 13,
              }}
              formatter={(val: number, name: string) =>
                [`${val.toFixed(1)} ${unit}`, name === "forecast" ? t("chart.forecast") : metric]}
            />
            {threshold !== undefined && (
              <ReferenceLine
                y={threshold}
                stroke="#f97316"
                strokeDasharray="4 3"
                label={{ value: `⚠ ${threshold}`, fill: "#f97316", fontSize: 11 }}
              />
            )}
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: color }}
            />
            {forecast && forecast.points.length > 0 && (
              <Line
                type="monotone"
                dataKey="forecast"
                name="forecast"
                stroke={color}
                strokeOpacity={0.45}
                strokeWidth={2}
                strokeDasharray="6 5"
                dot={false}
                activeDot={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
      {showThresholdEta && (
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "#facc15" }}>
          ⏳ {t("chart.thresholdEta", {
            metric: metric.toUpperCase(),
            mins: Math.max(1, Math.round(timeToThreshold!)),
          })}
        </p>
      )}
    </div>
  );
};
