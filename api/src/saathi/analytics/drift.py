"""BigQuery behavioral drift calculation rules."""

import math
from typing import Optional
from pydantic import BaseModel, Field


class DailyMetricRecord(BaseModel):
    local_date: str # YYYY-MM-DD
    response_gap_ms: Optional[float] = None
    speaking_rate_wpm: Optional[float] = None
    meals_reported: int = 3
    family_contact: bool = False
    mood: Optional[str] = None
    is_fasting: bool = False
    notes: str = ""


class DriftEvaluationResult(BaseModel):
    status: str # "Learning usual routine" or "Evaluated"
    baseline_days_count: int
    recent_days_count: int
    is_candidate: bool = False
    metric_name: Optional[str] = None
    z_score: Optional[float] = None
    recent_mean: Optional[float] = None
    baseline_mean: Optional[float] = None
    explanation: str = ""
    is_fasting_noted: bool = False


def evaluate_drift(history: list[DailyMetricRecord]) -> DriftEvaluationResult:
    """Evaluates drift across 14-day window following Master Plan specification."""
    # Ensure history is sorted by date ascending
    sorted_history = sorted(history, key=lambda d: d.local_date)

    if len(sorted_history) < 10:
        return DriftEvaluationResult(
            status="Learning usual routine",
            baseline_days_count=max(0, len(sorted_history) - 3),
            recent_days_count=min(3, len(sorted_history)),
            is_candidate=False,
            explanation="Requires at least 7 baseline days. Saathi is learning the person's usual routine.",
        )

    recent_days = sorted_history[-3:]
    baseline_days = sorted_history[-14:-3]

    valid_baseline_gaps = [d.response_gap_ms for d in baseline_days if d.response_gap_ms is not None]
    valid_recent_gaps = [d.response_gap_ms for d in recent_days if d.response_gap_ms is not None]

    if len(valid_baseline_gaps) < 7:
        return DriftEvaluationResult(
            status="Learning usual routine",
            baseline_days_count=len(valid_baseline_gaps),
            recent_days_count=len(valid_recent_gaps),
            is_candidate=False,
            explanation=f"Only {len(valid_baseline_gaps)} valid baseline days with speech timing. Need 7 days.",
        )

    # 1. Fasting Check on Meals
    fasting_in_recent = any(d.is_fasting for d in recent_days)
    recent_meals_skipped = sum(1 for d in recent_days if d.meals_reported < 3)

    if recent_meals_skipped >= 2:
        if fasting_in_recent:
            return DriftEvaluationResult(
                status="Evaluated",
                baseline_days_count=len(valid_baseline_gaps),
                recent_days_count=len(valid_recent_gaps),
                is_candidate=False,
                is_fasting_noted=True,
                explanation="Fasting context noted; skipped meal reports are excluded from escalation.",
            )

    # 2. Continuous Metric: Response Gap (Acoustic pause)
    # Variance floor: 250 ms (0.25 s)
    b_mean = sum(valid_baseline_gaps) / len(valid_baseline_gaps)
    variance = sum((x - b_mean) ** 2 for x in valid_baseline_gaps) / len(valid_baseline_gaps)
    stddev = max(math.sqrt(variance), 250.0)

    r_mean = sum(valid_recent_gaps) / len(valid_recent_gaps) if valid_recent_gaps else b_mean
    z = (r_mean - b_mean) / stddev

    # Candidate rule: z >= 2.0 in slower direction
    is_candidate = z >= 2.0

    return DriftEvaluationResult(
        status="Evaluated",
        baseline_days_count=len(valid_baseline_gaps),
        recent_days_count=len(valid_recent_gaps),
        is_candidate=is_candidate,
        metric_name="response_gap_ms",
        z_score=round(z, 2),
        recent_mean=round(r_mean, 1),
        baseline_mean=round(b_mean, 1),
        explanation=(
            f"Recent response pauses averaged {round(r_mean)}ms compared to baseline {round(b_mean)}ms (z={round(z, 2)})."
            if is_candidate else "Ordinary variation observed across days."
        ),
    )
