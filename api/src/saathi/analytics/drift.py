"""BigQuery behavioral drift calculation rules."""

import math
from typing import Optional
from pydantic import BaseModel, Field


class DailyMetricRecord(BaseModel):
    local_date: str # YYYY-MM-DD
    response_gap_ms: Optional[float] = None
    speaking_rate_wpm: Optional[float] = None
    meals_reported: int = 3
    meals_skipped: int = 0
    is_ill: bool = False
    quality_ok: bool = True
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
    # Rule outputs beyond the acoustic metric
    meal_followup: bool = False
    context_notes: list[str] = Field(default_factory=list)
    z_scores: dict[str, float] = Field(default_factory=dict)
    engine: str = "python"


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


# ---------------------------------------------------------------------------
# Master plan section 11.1: calendar windows, two successive evaluation dates,
# variance floors, meals as counts. The BigQuery query in bq.py implements the same rule.
# ---------------------------------------------------------------------------

from datetime import date, timedelta

GAP_FLOOR_MS = 250.0
RATE_FLOOR_WPM = 5.0
MIN_BASELINE_DAYS = 7
MIN_RECENT_DAYS = 2


def _d(value: str) -> date:
    return date.fromisoformat(value)


def _window_stats(values: list[float]) -> tuple[int, float, float]:
    if not values:
        return 0, 0.0, 0.0
    mean = sum(values) / len(values)
    sd = math.sqrt(sum((x - mean) ** 2 for x in values) / len(values))
    return len(values), mean, sd


def metric_z_at(history: list[DailyMetricRecord], eval_date: date, attr: str, floor: float) -> Optional[dict]:
    """z for one metric on one evaluation date. None while the baseline or recent window is too short."""
    recent_lo = eval_date - timedelta(days=2)
    baseline_lo = eval_date - timedelta(days=13)
    baseline_hi = eval_date - timedelta(days=3)
    recent: list[float] = []
    baseline: list[float] = []
    for rec in history:
        value = getattr(rec, attr)
        if value is None or not rec.quality_ok:
            continue
        day = _d(rec.local_date)
        if recent_lo <= day <= eval_date:
            recent.append(float(value))
        elif baseline_lo <= day <= baseline_hi:
            baseline.append(float(value))
    n_base, b_mean, b_sd = _window_stats(baseline)
    n_recent, r_mean, _ = _window_stats(recent)
    if n_base < MIN_BASELINE_DAYS or n_recent < MIN_RECENT_DAYS:
        return None
    z = (r_mean - b_mean) / max(b_sd, floor)
    return {"z": z, "baseline_n": n_base, "recent_n": n_recent, "baseline_mean": b_mean, "recent_mean": r_mean}


def evaluate_drift_rule(history: list[DailyMetricRecord], eval_date: Optional[str] = None) -> DriftEvaluationResult:
    """The product rule: candidate only when z >= 2 in the concerning direction on two successive dates."""
    if not history:
        return DriftEvaluationResult(
            status="Learning usual routine", baseline_days_count=0, recent_days_count=0,
            explanation="No conversations processed yet.",
        )
    last = _d(eval_date) if eval_date else max(_d(r.local_date) for r in history)
    prev = last - timedelta(days=1)
    notes: list[str] = []
    z_scores: dict[str, float] = {}
    candidate_metric: Optional[str] = None
    detail: Optional[dict] = None

    # attr, sign (+1 higher is concerning, -1 lower is concerning), floor
    for attr, sign, floor in (
        ("response_gap_ms", 1.0, GAP_FLOOR_MS),
        ("speaking_rate_wpm", -1.0, RATE_FLOOR_WPM),
    ):
        today_stats = metric_z_at(history, last, attr, floor)
        prev_stats = metric_z_at(history, prev, attr, floor)
        if today_stats:
            z_scores[attr] = round(sign * today_stats["z"], 2)
        if (
            today_stats and prev_stats and candidate_metric is None
            and sign * today_stats["z"] >= 2.0 and sign * prev_stats["z"] >= 2.0
        ):
            candidate_metric, detail = attr, today_stats

    gap_now = metric_z_at(history, last, "response_gap_ms", GAP_FLOOR_MS)
    in_baseline = [
        r for r in history
        if r.response_gap_ms is not None and r.quality_ok and last - timedelta(days=13) <= _d(r.local_date) <= last - timedelta(days=3)
    ]
    in_recent = [
        r for r in history
        if r.response_gap_ms is not None and r.quality_ok and last - timedelta(days=2) <= _d(r.local_date) <= last
    ]
    baseline_n, recent_n = len(in_baseline), len(in_recent)

    # Meals: skipped reports on two different dates in the last three days,
    # leaving out days where the person stated a fast or an illness.
    recent_days = [r for r in history if last - timedelta(days=2) <= _d(r.local_date) <= last]
    explained = [r for r in recent_days if r.meals_skipped > 0 and (r.is_fasting or r.is_ill)]
    skipped_days = {r.local_date for r in recent_days if r.meals_skipped > 0 and not (r.is_fasting or r.is_ill)}
    meal_followup = len(skipped_days) >= 2
    fasting_noted = any(r.is_fasting for r in recent_days)
    if explained:
        notes.append("A stated fast or illness explains skipped meal reports; no nutrition follow-up is raised.")
    if any(r.is_ill for r in recent_days):
        notes.append("Illness was mentioned in the last three days.")

    if baseline_n < MIN_BASELINE_DAYS and not meal_followup:
        return DriftEvaluationResult(
            status="Learning usual routine", baseline_days_count=baseline_n, recent_days_count=recent_n,
            explanation=f"{baseline_n} of {MIN_BASELINE_DAYS} baseline days with speech timing so far.",
            is_fasting_noted=fasting_noted, context_notes=notes, z_scores=z_scores,
        )

    shown = detail or gap_now
    if candidate_metric and detail:
        explanation = (
            f"{candidate_metric}: recent days averaged {round(detail['recent_mean'])} against "
            f"{round(detail['baseline_mean'])} before (z={round(detail['z'], 2)}), on two successive dates."
        )
    elif meal_followup:
        explanation = "Skipped meals were reported on two different dates in the last three days."
    else:
        explanation = "Ordinary variation observed across days."

    return DriftEvaluationResult(
        status="Evaluated",
        baseline_days_count=baseline_n,
        recent_days_count=recent_n,
        is_candidate=bool(candidate_metric),
        metric_name=candidate_metric or ("response_gap_ms" if gap_now else None),
        z_score=round(shown["z"], 2) if shown else None,
        recent_mean=round(shown["recent_mean"], 1) if shown else None,
        baseline_mean=round(shown["baseline_mean"], 1) if shown else None,
        explanation=explanation,
        is_fasting_noted=fasting_noted,
        meal_followup=meal_followup,
        context_notes=notes,
        z_scores=z_scores,
    )
