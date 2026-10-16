"""BigQuery daily metrics and the SQL drift rule (master plan section 11.1).

BigQuery is the decision engine when it is reachable. Household ids are stored as a one-way hash:
pseudonymous, still linkable (docs/PRIVACY.md). No quotes, names, or medicine labels go to BigQuery.
Every query is capped by maximum_bytes_billed.
"""

import hashlib
import logging
from typing import Optional

from saathi.analytics.drift import (
    GAP_FLOOR_MS,
    MIN_BASELINE_DAYS,
    MIN_RECENT_DAYS,
    RATE_FLOOR_WPM,
    DailyMetricRecord,
    DriftEvaluationResult,
    evaluate_drift_rule,
)
from saathi.config import load_settings

logger = logging.getLogger(__name__)

_client = None
_ready = False
_unavailable = False


def pseudonym(household_id: str) -> str:
    return hashlib.sha256(f"saathi:{household_id}".encode("utf-8")).hexdigest()[:20]


def _bq():
    """BigQuery client, or None when the project is not configured or the library cannot reach Google."""
    global _client, _unavailable
    if _unavailable:
        return None
    if _client is None:
        settings = load_settings()
        if not settings.google_cloud_project:
            _unavailable = True
            return None
        try:
            from google.cloud import bigquery

            _client = bigquery.Client(project=settings.google_cloud_project, location=settings.bigquery_location)
        except Exception as exc:
            logger.warning("BigQuery client unavailable (%s)", exc)
            _unavailable = True
            return None
    return _client


def _table() -> str:
    s = load_settings()
    return f"`{s.google_cloud_project}.{s.bigquery_dataset}.daily_metrics`"


def _job_config(params: list):
    from google.cloud import bigquery

    return bigquery.QueryJobConfig(
        query_parameters=params,
        maximum_bytes_billed=load_settings().bigquery_max_bytes_billed,
    )


def ensure_table() -> bool:
    """Create the dataset and daily_metrics table when missing. Safe to call on every run."""
    global _ready
    if _ready:
        return True
    client = _bq()
    if client is None:
        return False
    try:
        from google.cloud import bigquery

        s = load_settings()
        dataset = bigquery.Dataset(f"{s.google_cloud_project}.{s.bigquery_dataset}")
        dataset.location = s.bigquery_location
        client.create_dataset(dataset, exists_ok=True)
        schema = [
            bigquery.SchemaField("household_key", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("local_date", "DATE", mode="REQUIRED"),
            bigquery.SchemaField("response_gap_ms", "FLOAT64"),
            bigquery.SchemaField("speaking_rate_wpm", "FLOAT64"),
            bigquery.SchemaField("meals_reported", "INT64"),
            bigquery.SchemaField("meals_skipped", "INT64"),
            bigquery.SchemaField("family_contact", "BOOL"),
            bigquery.SchemaField("mood", "STRING"),
            bigquery.SchemaField("is_fasting", "BOOL"),
            bigquery.SchemaField("is_ill", "BOOL"),
            bigquery.SchemaField("session_count", "INT64"),
            bigquery.SchemaField("quality_ok", "BOOL"),
            bigquery.SchemaField("synthetic", "BOOL"),
            bigquery.SchemaField("updated_at", "TIMESTAMP"),
        ]
        table = bigquery.Table(f"{s.google_cloud_project}.{s.bigquery_dataset}.daily_metrics", schema=schema)
        client.create_table(table, exists_ok=True)
        _ready = True
        return True
    except Exception as exc:
        logger.warning("BigQuery table setup failed (%s)", exc)
        return False


def upsert_daily_metric(household_id: str, rec: DailyMetricRecord, session_count: int = 1, synthetic: bool = False) -> bool:
    """Replace the row for (household, date). A retry rewrites the same row; it never adds to it."""
    if not ensure_table():
        return False
    from google.cloud import bigquery as bq

    sql = f"""
    MERGE {_table()} T
    USING (SELECT @hk AS household_key, DATE(@d) AS local_date, @gap AS response_gap_ms, @rate AS speaking_rate_wpm,
                  @meals AS meals_reported, @skipped AS meals_skipped, @fam AS family_contact, @mood AS mood,
                  @fast AS is_fasting, @ill AS is_ill, @n AS session_count, @q AS quality_ok, @syn AS synthetic,
                  CURRENT_TIMESTAMP() AS updated_at) S
    ON T.household_key = S.household_key AND T.local_date = S.local_date
    WHEN MATCHED THEN UPDATE SET response_gap_ms = S.response_gap_ms, speaking_rate_wpm = S.speaking_rate_wpm,
        meals_reported = S.meals_reported, meals_skipped = S.meals_skipped, family_contact = S.family_contact,
        mood = S.mood, is_fasting = S.is_fasting, is_ill = S.is_ill, session_count = S.session_count,
        quality_ok = S.quality_ok, synthetic = S.synthetic, updated_at = S.updated_at
    WHEN NOT MATCHED THEN INSERT ROW
    """
    params = [
        bq.ScalarQueryParameter("hk", "STRING", pseudonym(household_id)),
        bq.ScalarQueryParameter("d", "STRING", rec.local_date),
        bq.ScalarQueryParameter("gap", "FLOAT64", rec.response_gap_ms),
        bq.ScalarQueryParameter("rate", "FLOAT64", rec.speaking_rate_wpm),
        bq.ScalarQueryParameter("meals", "INT64", rec.meals_reported),
        bq.ScalarQueryParameter("skipped", "INT64", rec.meals_skipped),
        bq.ScalarQueryParameter("fam", "BOOL", rec.family_contact),
        bq.ScalarQueryParameter("mood", "STRING", rec.mood),
        bq.ScalarQueryParameter("fast", "BOOL", rec.is_fasting),
        bq.ScalarQueryParameter("ill", "BOOL", rec.is_ill),
        bq.ScalarQueryParameter("n", "INT64", session_count),
        bq.ScalarQueryParameter("q", "BOOL", rec.quality_ok),
        bq.ScalarQueryParameter("syn", "BOOL", synthetic),
    ]
    try:
        _bq().query(sql, job_config=_job_config(params)).result()
        return True
    except Exception as exc:
        logger.warning("BigQuery upsert failed (%s)", exc)
        return False


def delete_household_rows(household_id: str) -> bool:
    """Remove every row for one household. Used to clean up test data."""
    if not ensure_table():
        return False
    from google.cloud import bigquery as bq

    try:
        sql = f"DELETE FROM {_table()} WHERE household_key = @hk"
        params = [bq.ScalarQueryParameter("hk", "STRING", pseudonym(household_id))]
        _bq().query(sql, job_config=_job_config(params)).result()
        return True
    except Exception as exc:
        logger.warning("BigQuery delete failed (%s)", exc)
        return False


DRIFT_SQL = """
WITH base AS (
  SELECT local_date, response_gap_ms, speaking_rate_wpm
  FROM {table}
  WHERE household_key = @hk AND quality_ok
    AND local_date BETWEEN DATE_SUB(DATE(@d), INTERVAL 14 DAY) AND DATE(@d)
),
evals AS (SELECT e FROM UNNEST([DATE(@d), DATE_SUB(DATE(@d), INTERVAL 1 DAY)]) AS e),
stats AS (
  SELECT
    e,
    COUNTIF(local_date BETWEEN DATE_SUB(e, INTERVAL 13 DAY) AND DATE_SUB(e, INTERVAL 3 DAY) AND response_gap_ms IS NOT NULL) AS gap_base_n,
    AVG(IF(local_date BETWEEN DATE_SUB(e, INTERVAL 13 DAY) AND DATE_SUB(e, INTERVAL 3 DAY), response_gap_ms, NULL)) AS gap_base_mean,
    STDDEV_POP(IF(local_date BETWEEN DATE_SUB(e, INTERVAL 13 DAY) AND DATE_SUB(e, INTERVAL 3 DAY), response_gap_ms, NULL)) AS gap_base_sd,
    COUNTIF(local_date BETWEEN DATE_SUB(e, INTERVAL 2 DAY) AND e AND response_gap_ms IS NOT NULL) AS gap_recent_n,
    AVG(IF(local_date BETWEEN DATE_SUB(e, INTERVAL 2 DAY) AND e, response_gap_ms, NULL)) AS gap_recent_mean,
    COUNTIF(local_date BETWEEN DATE_SUB(e, INTERVAL 13 DAY) AND DATE_SUB(e, INTERVAL 3 DAY) AND speaking_rate_wpm IS NOT NULL) AS rate_base_n,
    AVG(IF(local_date BETWEEN DATE_SUB(e, INTERVAL 13 DAY) AND DATE_SUB(e, INTERVAL 3 DAY), speaking_rate_wpm, NULL)) AS rate_base_mean,
    STDDEV_POP(IF(local_date BETWEEN DATE_SUB(e, INTERVAL 13 DAY) AND DATE_SUB(e, INTERVAL 3 DAY), speaking_rate_wpm, NULL)) AS rate_base_sd,
    COUNTIF(local_date BETWEEN DATE_SUB(e, INTERVAL 2 DAY) AND e AND speaking_rate_wpm IS NOT NULL) AS rate_recent_n,
    AVG(IF(local_date BETWEEN DATE_SUB(e, INTERVAL 2 DAY) AND e, speaking_rate_wpm, NULL)) AS rate_recent_mean
  FROM evals CROSS JOIN base
  GROUP BY e
)
SELECT
  e AS eval_date,
  gap_base_n, gap_base_mean, gap_recent_n, gap_recent_mean,
  IF(gap_base_n >= {min_base} AND gap_recent_n >= {min_recent},
     (gap_recent_mean - gap_base_mean) / GREATEST(IFNULL(gap_base_sd, 0), {gap_floor}), NULL) AS gap_z,
  rate_base_n, rate_base_mean, rate_recent_n, rate_recent_mean,
  IF(rate_base_n >= {min_base} AND rate_recent_n >= {min_recent},
     (rate_base_mean - rate_recent_mean) / GREATEST(IFNULL(rate_base_sd, 0), {rate_floor}), NULL) AS rate_z
FROM stats
ORDER BY e DESC
"""

MEALS_SQL = """
SELECT
  COUNT(DISTINCT IF(meals_skipped > 0 AND NOT is_fasting AND NOT is_ill, local_date, NULL)) AS skipped_days,
  LOGICAL_OR(is_fasting) AS any_fasting,
  LOGICAL_OR(is_ill) AS any_ill,
  LOGICAL_OR(meals_skipped > 0 AND (is_fasting OR is_ill)) AS explained_skips
FROM {table}
WHERE household_key = @hk AND local_date BETWEEN DATE_SUB(DATE(@d), INTERVAL 2 DAY) AND DATE(@d)
"""


def evaluate_drift_sql(household_id: str, eval_date: str) -> Optional[DriftEvaluationResult]:
    """Run the drift rule in BigQuery. None when BigQuery cannot be used (the caller falls back to Python)."""
    if not ensure_table():
        return None
    from google.cloud import bigquery as bq

    params = [
        bq.ScalarQueryParameter("hk", "STRING", pseudonym(household_id)),
        bq.ScalarQueryParameter("d", "STRING", eval_date),
    ]
    try:
        client = _bq()
        rows = list(client.query(
            DRIFT_SQL.format(
                table=_table(), min_base=MIN_BASELINE_DAYS, min_recent=MIN_RECENT_DAYS,
                gap_floor=GAP_FLOOR_MS, rate_floor=RATE_FLOOR_WPM,
            ),
            job_config=_job_config(params),
        ).result())
        meals = list(client.query(MEALS_SQL.format(table=_table()), job_config=_job_config(params)).result())
    except Exception as exc:
        logger.warning("BigQuery drift query failed (%s)", exc)
        return None

    today = next((r for r in rows if str(r["eval_date"]) == eval_date), None)
    prev = next((r for r in rows if str(r["eval_date"]) != eval_date), None)
    if today is None:
        return DriftEvaluationResult(
            status="Learning usual routine", baseline_days_count=0, recent_days_count=0,
            explanation="No metric rows in the window yet.", engine="bigquery",
        )

    def two_dates(col: str) -> bool:
        return bool(
            today[col] is not None and prev is not None and prev[col] is not None
            and today[col] >= 2.0 and prev[col] >= 2.0
        )

    z_scores = {}
    if today["gap_z"] is not None:
        z_scores["response_gap_ms"] = round(float(today["gap_z"]), 2)
    if today["rate_z"] is not None:
        z_scores["speaking_rate_wpm"] = round(float(today["rate_z"]), 2)

    metric = "response_gap_ms" if two_dates("gap_z") else ("speaking_rate_wpm" if two_dates("rate_z") else None)
    meal_row = meals[0] if meals else None
    meal_followup = bool(meal_row and (meal_row["skipped_days"] or 0) >= 2)
    notes = []
    if meal_row and meal_row["explained_skips"]:
        notes.append("A stated fast or illness explains skipped meal reports; no nutrition follow-up is raised.")
    if meal_row and meal_row["any_ill"]:
        notes.append("Illness was mentioned in the last three days.")

    base_n = int(today["gap_base_n"] or 0)
    if base_n < MIN_BASELINE_DAYS and not meal_followup:
        return DriftEvaluationResult(
            status="Learning usual routine", baseline_days_count=base_n, recent_days_count=int(today["gap_recent_n"] or 0),
            explanation=f"{base_n} of {MIN_BASELINE_DAYS} baseline days with speech timing so far.",
            is_fasting_noted=bool(meal_row and meal_row["any_fasting"]), context_notes=notes,
            z_scores=z_scores, engine="bigquery",
        )

    prefix = "gap" if metric != "speaking_rate_wpm" else "rate"
    mean_recent = today[f"{prefix}_recent_mean"]
    mean_base = today[f"{prefix}_base_mean"]
    z_val = today["gap_z"] if prefix == "gap" else today["rate_z"]
    if metric:
        explanation = (
            f"{metric}: recent days averaged {round(float(mean_recent))} against {round(float(mean_base))} before "
            f"(z={round(float(z_val), 2)}), on two successive dates."
        )
    elif meal_followup:
        explanation = "Skipped meals were reported on two different dates in the last three days."
    else:
        explanation = "Ordinary variation observed across days."
    return DriftEvaluationResult(
        status="Evaluated",
        baseline_days_count=base_n,
        recent_days_count=int(today["gap_recent_n"] or 0),
        is_candidate=metric is not None,
        metric_name=metric or ("response_gap_ms" if today["gap_z"] is not None else None),
        z_score=round(float(z_val), 2) if z_val is not None else None,
        recent_mean=round(float(mean_recent), 1) if mean_recent is not None else None,
        baseline_mean=round(float(mean_base), 1) if mean_base is not None else None,
        explanation=explanation,
        is_fasting_noted=bool(meal_row and meal_row["any_fasting"]),
        meal_followup=meal_followup,
        context_notes=notes,
        z_scores=z_scores,
        engine="bigquery",
    )


def evaluate_drift_best(household_id: str, history: list[DailyMetricRecord], eval_date: str) -> DriftEvaluationResult:
    """BigQuery when it answers, otherwise the same rule in Python over the Firestore history."""
    result = evaluate_drift_sql(household_id, eval_date)
    if result is not None:
        return result
    return evaluate_drift_rule(history, eval_date)
