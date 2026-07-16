"""Pure linear-regression forecast over (timestamp, value) readings. No I/O."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np

FORECAST_MAX_READINGS = 30
FORECAST_MIN_READINGS = 5
FORECAST_POINTS = 6
FLAT_SLOPE_EPS = 1e-9


@dataclass
class ForecastResult:
    points: list[tuple[datetime, float]]  # (future timestamp, predicted value)
    slope_per_min: float
    threshold: float | None
    time_to_threshold_min: float | None


def compute_forecast(
    rows: list[tuple[datetime, float]],
    horizon_min: int,
    threshold: float | None,
) -> ForecastResult | None:
    """Fit degree-1 polyfit over chronological readings; None → insufficient data."""
    if len(rows) < FORECAST_MIN_READINGS:
        return None

    # Minutes elapsed since the first reading — real timestamp deltas
    t0 = rows[0][0]
    xs = np.array([(ts - t0).total_seconds() / 60.0 for ts, _ in rows])
    ys = np.array([float(v) for _, v in rows])
    if xs[-1] - xs[0] <= 0:
        return None

    slope, intercept = (float(c) for c in np.polyfit(xs, ys, 1))

    last_ts, last_x = rows[-1][0], float(xs[-1])
    step = horizon_min / FORECAST_POINTS
    points = [
        (
            last_ts + timedelta(minutes=step * i),
            round(intercept + slope * (last_x + step * i), 2),
        )
        for i in range(1, FORECAST_POINTS + 1)
    ]

    time_to_threshold: float | None = None
    if threshold is not None and abs(slope) > FLAT_SLOPE_EPS:
        current = intercept + slope * last_x
        minutes = (threshold - current) / slope
        if minutes > 0:  # flat or moving away → stays None
            time_to_threshold = round(minutes, 1)

    return ForecastResult(
        points=points,
        slope_per_min=round(slope, 4),
        threshold=threshold,
        time_to_threshold_min=time_to_threshold,
    )
