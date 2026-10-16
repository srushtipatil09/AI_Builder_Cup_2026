"""Post-call pipeline: extraction, family episodes, daily metrics, BigQuery drift, insight.

One run per session id. A retry rewrites the same documents, so a day is never double-counted.
Runs in the worker (Cloud Tasks) or in this process when no worker URL is configured.
Nothing here is shown to the parent; the caretaker reads the result on the Routine tab.
"""

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from saathi.analytics import bq
from saathi.analytics.drift import DailyMetricRecord, DriftEvaluationResult, evaluate_drift_rule
from saathi.memory.extract import ExtractionResult, extract_session
from saathi.memory.vectors import FamilyEpisodeVectorIndex, LONELINESS_PHRASES
from saathi.providers.firestore import get_repository

logger = logging.getLogger(__name__)

# Parent-local dates are resolved in code (master plan section 5.3). The prototype household is in India.
LOCAL_TZ = timezone(timedelta(hours=5, minutes=30))
STALE_CLAIM_SECONDS = 300
MIN_QUALITY_SECONDS = 20.0


def local_date_of(when: Optional[datetime] = None) -> str:
    return (when or datetime.now(timezone.utc)).astimezone(LOCAL_TZ).strftime("%Y-%m-%d")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hh(household_id: str) -> str:
    return f"households/{household_id}"


def session_quality_ok(session: dict) -> bool:
    """A noisy, short, or unmeasured session does not become a confident pause number."""
    flags = set(session.get("quality_flags") or [])
    if flags & {"noisy", "short", "no_turns_measured", "mic_blocked"}:
        return False
    duration = session.get("duration_seconds")
    return duration is None or float(duration) >= MIN_QUALITY_SECONDS


def build_daily_record(household_id: str, local_date: str) -> tuple[DailyMetricRecord, int]:
    """Recompute one day from the stored observations and sessions. Returns the record and the session count."""
    repo = get_repository()
    observations = [o for o in repo.col_list(f"{_hh(household_id)}/observations", 400) if o.get("local_date") == local_date]
    sessions = [s for s in repo.col_list(f"{_hh(household_id)}/sessions", 400) if s.get("local_date") == local_date]

    gaps = [
        float(s["response_gap_ms"]) for s in sessions
        if s.get("response_gap_ms") is not None and session_quality_ok(s)
    ]
    rates = [
        float(s["speaking_rate_wpm"]) for s in sessions
        if s.get("speaking_rate_wpm") is not None and session_quality_ok(s)
    ]
    eaten: set[str] = set()
    skipped: set[str] = set()
    mood: Optional[str] = None
    contact = False
    fasting = ill = False
    for o in observations:
        for m in o.get("meals", []):
            (eaten if m.get("reported_eaten") else skipped).add(m.get("meal") or "meal")
        if o.get("mood_stated"):
            mood = o["mood_stated"]
        contact = contact or bool(o.get("family_contact"))
        fasting = fasting or bool(o.get("fasting_stated"))
        ill = ill or bool(o.get("illness_stated"))

    record = DailyMetricRecord(
        local_date=local_date,
        response_gap_ms=round(sum(gaps) / len(gaps), 1) if gaps else None,
        speaking_rate_wpm=round(sum(rates) / len(rates), 1) if rates else None,
        meals_reported=min(3, len(eaten)),
        meals_skipped=len(skipped - eaten),
        family_contact=contact,
        mood=mood,
        is_fasting=fasting,
        is_ill=ill,
        quality_ok=bool(gaps or rates) or not sessions,
    )
    return record, len(sessions)


def load_history(household_id: str) -> list[DailyMetricRecord]:
    repo = get_repository()
    out: list[DailyMetricRecord] = []
    for row in repo.col_list(f"{_hh(household_id)}/dailyMetrics", 120):
        try:
            out.append(DailyMetricRecord(**{k: v for k, v in row.items() if k in DailyMetricRecord.model_fields}))
        except Exception:
            continue
    return sorted(out, key=lambda r: r.local_date)


def save_daily_record(household_id: str, record: DailyMetricRecord, session_count: int, synthetic: bool = False) -> bool:
    """Write the day to Firestore and BigQuery. Returns whether BigQuery took the row."""
    repo = get_repository()
    repo.doc_set(
        f"{_hh(household_id)}/dailyMetrics/{record.local_date}",
        {**record.model_dump(), "session_count": session_count, "synthetic": synthetic, "updated_at": _now_iso()},
        merge=False,
    )
    return bq.upsert_daily_metric(household_id, record, session_count, synthetic)


def evaluate_and_publish(
    household_id: str,
    eval_date: str,
    session_id: str = "",
    shift: Optional[dict] = None,
    extra_evidence: Optional[list[str]] = None,
) -> dict:
    """Run drift (BigQuery first), then the insight workflow, and store both for the care desk."""
    from saathi.insights.agent import run_insight_workflow

    repo = get_repository()
    history = load_history(household_id)
    drift: DriftEvaluationResult = bq.evaluate_drift_best(household_id, history, eval_date)

    evidence = list(extra_evidence or [])
    if session_id:
        evidence.append(session_id)
    if shift:
        evidence.extend([shift.get("earlier_episode_id", ""), shift.get("later_episode_id", "")])
    evidence = [e for e in dict.fromkeys(evidence) if e]

    insight = run_insight_workflow(household_id, drift, shift, evidence_ids=evidence)
    stamp = _now_iso()
    repo.doc_set(f"{_hh(household_id)}/driftResults/latest", {**drift.model_dump(), "eval_date": eval_date, "updated_at": stamp}, merge=False)
    repo.doc_set(
        f"{_hh(household_id)}/insights/latest",
        {**insight.model_dump(), "created_at": stamp, "eval_date": eval_date, "session_id": session_id, "drift_engine": drift.engine},
        merge=False,
    )
    repo.doc_set(
        f"{_hh(household_id)}/insights/{eval_date}-{session_id or 'manual'}",
        {**insight.model_dump(), "created_at": stamp, "eval_date": eval_date, "session_id": session_id},
        merge=False,
    )
    if shift:
        repo.doc_set(f"{_hh(household_id)}/familyCard/latest", {**shift, "updated_at": stamp}, merge=False)
    return {"drift": drift.model_dump(), "insight": insight.model_dump()}


def _loneliness_quotes(utterances: list[dict]) -> list[str]:
    return [
        u["text"] for u in utterances
        if u.get("speaker") in ("parent", "user") and any(p in u.get("text", "").lower() for p in LONELINESS_PHRASES)
    ]


def run_post_call(household_id: str, session_id: str, utterances: Optional[list[dict]] = None) -> dict:
    """Process one finished session. Safe to call twice."""
    repo = get_repository()
    path = f"{_hh(household_id)}/sessions/{session_id}"
    session = repo.doc_get(path) or {}

    status = session.get("pipeline_status")
    if status == "processed":
        return {"status": "already_processed", "sessionId": session_id}
    if status == "processing":
        started = session.get("pipeline_started_epoch", 0)
        if time.time() - float(started) < STALE_CLAIM_SECONDS:
            return {"status": "in_progress", "sessionId": session_id}

    lines = utterances if utterances is not None else session.get("utterances") or []
    started_at = time.time()
    repo.doc_set(path, {"pipeline_status": "processing", "pipeline_started_epoch": started_at, "id": session_id})
    if not lines:
        repo.doc_set(path, {"pipeline_status": "processed", "pipeline_note": "no_utterances"})
        return {"status": "processed", "sessionId": session_id, "note": "no_utterances"}

    # The session's own date, fixed the first time it is processed so a retry lands on the same day.
    local_date = session.get("local_date") or local_date_of()
    repo.doc_set(path, {"local_date": local_date})

    result: ExtractionResult = extract_session(lines)

    indexer = FamilyEpisodeVectorIndex(household_id)
    episode_ids: list[str] = []
    for i, ep in enumerate(result.family_episodes):
        ep.id = f"{session_id}-{i}"
        ep.date = local_date
        indexer.index_episode(ep)
        episode_ids.append(ep.id)
    shift = indexer.evaluate_family_shift()
    if shift:
        shift["loneliness_quotes"] = _loneliness_quotes(lines)

    family_contact = bool(result.social_contacts) or any(
        e.reported_last_contact not in ("", "unknown") for e in result.family_episodes
    )
    repo.doc_set(f"{_hh(household_id)}/observations/{session_id}", {
        "session_id": session_id,
        "local_date": local_date,
        "created_at": _now_iso(),
        "summary": result.summary,
        "meals": [m.model_dump() for m in result.meals],
        "mood_stated": result.mood_stated,
        "discomfort": [d.model_dump() for d in result.discomfort],
        "social_contacts": [c.model_dump() for c in result.social_contacts],
        "family_episode_ids": episode_ids,
        "family_contact": family_contact,
        "memory_corrections": [c.model_dump() for c in result.memory_corrections],
        "declined_topics": result.declined_topics,
        "fasting_stated": result.fasting_stated,
        "illness_stated": result.illness_stated,
    }, merge=False)

    _apply_corrections(household_id, session_id, local_date, result)

    record, session_count = build_daily_record(household_id, local_date)
    bq_ok = save_daily_record(household_id, record, session_count)
    published = evaluate_and_publish(household_id, local_date, session_id, shift, episode_ids)

    elapsed = round(time.time() - started_at, 2)
    repo.doc_set(path, {
        "pipeline_status": "processed",
        "pipeline_seconds": elapsed,
        "bigquery_written": bq_ok,
        "processed_at": _now_iso(),
    })
    logger.info("Post-call pipeline finished for %s in %ss (bigquery=%s)", session_id, elapsed, bq_ok)
    return {
        "status": "processed",
        "sessionId": session_id,
        "observationsExtracted": len(result.meals) + len(result.discomfort) + len(result.family_episodes),
        "familyShiftDetected": shift is not None,
        "shiftCard": shift,
        "bigqueryWritten": bq_ok,
        "driftStatus": published["drift"]["status"],
        "driftCandidate": published["drift"]["is_candidate"],
        "insightTier": published["insight"]["tier"],
        "seconds": elapsed,
    }


def _apply_corrections(household_id: str, session_id: str, local_date: str, result: ExtractionResult) -> None:
    """A correction the parent made becomes a conversation memory on the desk. Caretaker facts stay."""
    if not result.memory_corrections:
        return
    from saathi.contracts.desk import Desk, Memory

    repo = get_repository()
    desk = repo.get_desk(household_id) or Desk()
    have = {m.id for m in desk.memories}
    for i, corr in enumerate(result.memory_corrections):
        mid = f"mem-corr-{session_id}-{i}"
        if mid in have:
            continue
        desk.memories.insert(0, Memory(
            id=mid,
            text=f"Correction: {corr.corrected_fact}",
            author="conversation",
            addedAt=_now_iso(),
        ))
    repo.save_desk(household_id, desk)
