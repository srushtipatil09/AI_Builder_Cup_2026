"""Prototype retention policy (master plan section 5.3).

Transcripts: 7 days. The session record keeps its measurements; only the words are removed.
Summaries, observations, and daily numbers: 30 days, in Firestore and in BigQuery.
Caretaker facts, family episodes, and active reminders stay until someone deletes them.

The worker runs this once a day from Cloud Scheduler. Safe to run more often.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from saathi.providers.firestore import get_repository

logger = logging.getLogger(__name__)

TRANSCRIPT_DAYS = 7
ANALYTICS_DAYS = 30


def _when(row: dict, *fields: str) -> Optional[datetime]:
    for field in fields:
        value = row.get(field)
        if not value:
            continue
        try:
            parsed = datetime.fromisoformat(str(value))
        except ValueError:
            continue
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def _local_date_before(row: dict, cutoff: datetime) -> bool:
    value = row.get("local_date") or row.get("_id", "")
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date() < cutoff.date()
    except ValueError:
        return False


def purge_household(household_id: str, now: Optional[datetime] = None) -> dict:
    repo = get_repository()
    now = now or datetime.now(timezone.utc)
    transcript_cutoff = now - timedelta(days=TRANSCRIPT_DAYS)
    analytics_cutoff = now - timedelta(days=ANALYTICS_DAYS)
    base = f"households/{household_id}"
    counts = {"transcripts": 0, "observations": 0, "daily_metrics": 0}

    for row in repo.col_list(f"{base}/sessions", 500):
        when = _when(row, "completed_at", "created_at")
        if row.get("utterances") and when and when < transcript_cutoff:
            repo.doc_set(f"{base}/sessions/{row['_id']}", {"utterances": [], "transcript_purged_at": now.isoformat()})
            counts["transcripts"] += 1

    for row in repo.col_list(f"{base}/observations", 500):
        when = _when(row, "created_at")
        if (when and when < analytics_cutoff) or (not when and _local_date_before(row, analytics_cutoff)):
            repo.doc_delete(f"{base}/observations/{row['_id']}")
            counts["observations"] += 1

    for row in repo.col_list(f"{base}/dailyMetrics", 500):
        if _local_date_before(row, analytics_cutoff):
            repo.doc_delete(f"{base}/dailyMetrics/{row['_id']}")
            counts["daily_metrics"] += 1
    return counts


def purge_bigquery(now: Optional[datetime] = None) -> bool:
    """Delete daily_metrics rows older than the analytics window. False when BigQuery is not reachable."""
    from saathi.analytics import bq

    if not bq.ensure_table():
        return False
    from google.cloud import bigquery

    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=ANALYTICS_DAYS)).date()
    try:
        sql = f"DELETE FROM {bq._table()} WHERE local_date < @cutoff"
        params = [bigquery.ScalarQueryParameter("cutoff", "DATE", cutoff)]
        bq._bq().query(sql, job_config=bq._job_config(params)).result()
        return True
    except Exception as exc:
        logger.warning("BigQuery retention delete failed (%s)", exc)
        return False


def run_retention(now: Optional[datetime] = None) -> dict:
    repo = get_repository()
    totals = {"households": 0, "transcripts": 0, "observations": 0, "daily_metrics": 0}
    for household_id in repo.list_doc_ids("households"):
        counts = purge_household(household_id, now)
        totals["households"] += 1
        for key, value in counts.items():
            totals[key] += value
    totals["bigquery"] = purge_bigquery(now)
    return totals
