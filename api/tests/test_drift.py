"""Tests for BigQuery behavioral drift calculations."""

from saathi.analytics.drift import DailyMetricRecord, evaluate_drift


def test_drift_sparse_history_returns_learning() -> None:
    # Only 4 days of history
    history = [
        DailyMetricRecord(local_date=f"2026-10-0{i}", response_gap_ms=500.0)
        for i in range(1, 5)
    ]
    res = evaluate_drift(history)
    assert res.status == "Learning usual routine"
    assert res.is_candidate is False


def test_drift_stable_history_no_candidate() -> None:
    # 14 days of ordinary variation (around 500ms)
    history = [
        DailyMetricRecord(local_date=f"2026-10-{i:02d}", response_gap_ms=500.0 + (i % 3) * 20.0)
        for i in range(1, 15)
    ]
    res = evaluate_drift(history)
    assert res.status == "Evaluated"
    assert res.is_candidate is False
    assert res.z_score is not None
    assert res.z_score < 2.0


def test_drift_changing_history_triggers_candidate() -> None:
    # 11 baseline days at 400ms, then 3 recent days at 1100ms (significant pause slowdown)
    history = []
    for i in range(1, 12):
        history.append(DailyMetricRecord(local_date=f"2026-10-{i:02d}", response_gap_ms=400.0))
    for i in range(12, 15):
        history.append(DailyMetricRecord(local_date=f"2026-10-{i:02d}", response_gap_ms=1100.0))

    res = evaluate_drift(history)
    assert res.status == "Evaluated"
    assert res.is_candidate is True
    assert res.z_score >= 2.0
    assert "response pauses averaged" in res.explanation


def test_drift_fasting_trap_suppresses_alert() -> None:
    # Fasting noted on day 13 and 14, meals skipped
    history = []
    for i in range(1, 12):
        history.append(DailyMetricRecord(local_date=f"2026-10-{i:02d}", response_gap_ms=450.0, meals_reported=3))
    history.append(DailyMetricRecord(local_date="2026-10-12", response_gap_ms=450.0, meals_reported=2, is_fasting=True))
    history.append(DailyMetricRecord(local_date="2026-10-13", response_gap_ms=460.0, meals_reported=1, is_fasting=True))
    history.append(DailyMetricRecord(local_date="2026-10-14", response_gap_ms=450.0, meals_reported=2, is_fasting=True))

    res = evaluate_drift(history)
    assert res.status == "Evaluated"
    assert res.is_candidate is False
    assert res.is_fasting_noted is True
    assert "Fasting context noted" in res.explanation
