"""The three insight tools: get_recent_metrics, compose_family_insight, send_alert.

Each tool takes a household id that the server supplies. A model-supplied household id is ignored by
the agent wrapper (agent.py), which binds the id before the model sees the tools.
"""

import logging
from typing import Optional
from pydantic import BaseModel

from saathi.insights.safety import validate_caregiver_text
from saathi.notify import raise_alert
from saathi.providers.firestore import get_repository

logger = logging.getLogger(__name__)


class InsightOutput(BaseModel):
    tier: int  # 1: quiet digest, 2: concise notice, 3: urgent alert
    headline: str
    body: str
    evidence_ids: list[str] = []
    suggested_action: str
    safety_passed: bool


def get_recent_metrics(household_id: str) -> dict:
    """Tool 1: recent metrics and observations for the authorized household."""
    repo = get_repository()
    desk = repo.get_desk(household_id)
    daily = sorted(repo.col_list(f"households/{household_id}/dailyMetrics", 60), key=lambda r: r.get("local_date", ""))[-14:]
    drift = repo.doc_get(f"households/{household_id}/driftResults/latest") or {}
    return {
        "household_id": household_id,
        "parent_name": (desk.profile.preferredName if desk and desk.profile.preferredName else "your parent"),
        "recent_memories": [m.text for m in (desk.memories[:5] if desk else [])],
        "active_medicines": [m.name for m in (desk.medicines if desk else [])],
        "daily_metrics": [
            {k: r.get(k) for k in ("local_date", "response_gap_ms", "meals_reported", "meals_skipped", "family_contact", "mood", "is_fasting", "is_ill")}
            for r in daily
        ],
        "drift": {k: drift.get(k) for k in ("status", "is_candidate", "metric_name", "z_score", "explanation", "meal_followup", "context_notes")},
    }


def compose_family_insight(
    household_id: str,
    draft_headline: str,
    draft_body: str,
    metric_fact: str = "routine response pauses",
    parent_name: str = "your parent",
    evidence_ids: Optional[list[str]] = None,
    tier: int = 1,
    suggested_action: str = "Call to check in",
) -> InsightOutput:
    """Tool 2: SafetyGuard on the draft. On failure the sentence is a template built from stored facts."""
    guard_result = validate_caregiver_text(
        draft_text=f"{draft_headline}. {draft_body}",
        parent_name=parent_name,
        metric_fact=metric_fact,
        fallback_action="Call to check in",
        tier=tier,
        has_evidence=bool(evidence_ids),
    )
    body = draft_body if guard_result.is_safe else guard_result.final_text
    return InsightOutput(
        tier=tier,
        headline=draft_headline if guard_result.is_safe else "Routine observation update",
        body=body,
        evidence_ids=evidence_ids or [],
        suggested_action=suggested_action,
        safety_passed=guard_result.is_safe,
    )


def send_alert(
    household_id: str,
    tier: int,
    message: str,
    action: str = "Call parent",
    issue_key: str = "",
    evidence_ids: Optional[list[str]] = None,
) -> dict:
    """Tool 3: write the alert for the authorized caregiver. Duplicates inside 24 hours append evidence."""
    return raise_alert(
        household_id=household_id,
        tier=tier,
        message=message,
        action=action,
        issue_key=issue_key or f"insight:{tier}:{action}",
        evidence_ids=evidence_ids,
    )
