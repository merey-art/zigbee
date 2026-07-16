from datetime import datetime, timedelta, timezone

import pytest

from app.forecast import FORECAST_POINTS, compute_forecast


BASE = datetime(2026, 7, 16, 6, 0, tzinfo=timezone.utc)


def make_rows(n: int, step_min: float, start: float, rate_per_min: float):
    """n readings every step_min minutes, rising rate_per_min per minute."""
    return [
        (BASE + timedelta(minutes=step_min * i), start + rate_per_min * step_min * i)
        for i in range(n)
    ]


def test_insufficient_data_returns_none():
    assert compute_forecast(make_rows(4, 1, 600, 10), 30, 1000) is None
    assert compute_forecast([], 30, 1000) is None


def test_identical_timestamps_returns_none():
    rows = [(BASE, 600.0 + i) for i in range(10)]
    assert compute_forecast(rows, 30, 1000) is None


def test_linear_rise_slope_and_time_to_threshold():
    # 10 readings every 2 min, +10/min → last value 780 at t=18 min
    result = compute_forecast(make_rows(10, 2, 600, 10), 30, 1000)
    assert result is not None
    assert result.slope_per_min == pytest.approx(10.0, abs=1e-6)
    assert result.time_to_threshold_min == pytest.approx(22.0, abs=0.1)
    assert len(result.points) == FORECAST_POINTS
    # Last point is at last_ts + horizon with the extrapolated value
    last_ts, last_val = result.points[-1]
    assert last_ts == BASE + timedelta(minutes=18 + 30)
    assert last_val == pytest.approx(780 + 10 * 30, abs=0.1)


def test_flat_series_has_no_time_to_threshold():
    result = compute_forecast(make_rows(10, 2, 600, 0), 30, 1000)
    assert result is not None
    assert result.slope_per_min == pytest.approx(0.0, abs=1e-6)
    assert result.time_to_threshold_min is None


def test_moving_away_from_threshold_is_null():
    # Falling CO2 never reaches a higher threshold
    result = compute_forecast(make_rows(10, 2, 600, -10), 30, 1000)
    assert result is not None
    assert result.time_to_threshold_min is None


def test_already_past_threshold_moving_further_is_null():
    result = compute_forecast(make_rows(10, 2, 1200, 10), 30, 1000)
    assert result is not None
    assert result.time_to_threshold_min is None


def test_no_threshold_given():
    result = compute_forecast(make_rows(10, 2, 600, 10), 30, None)
    assert result is not None
    assert result.threshold is None
    assert result.time_to_threshold_min is None


def test_irregular_intervals_use_real_deltas():
    # Same +10/min trend but uneven sampling
    offsets = [0, 1, 3, 7, 8, 12, 15, 21]
    rows = [(BASE + timedelta(minutes=m), 600.0 + 10 * m) for m in offsets]
    result = compute_forecast(rows, 30, 1000)
    assert result is not None
    assert result.slope_per_min == pytest.approx(10.0, abs=1e-6)
    # last value 810 at t=21 → 19 min to 1000
    assert result.time_to_threshold_min == pytest.approx(19.0, abs=0.1)
