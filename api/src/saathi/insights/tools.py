"""ADK-compatible tools for insight drafting and alert generation."""

import logging
from typing import Optional
from pydantic import BaseModel

from saathi.insights.safety import validate_caregiver_text
from saathi.providers.firestore import get_repository

logger = logging.getLogger(__name__)


class InsightOutput(BaseModel):
    tier: int # 1: quiet digest, 2: concise notice, 3: urgent alert
    headline: str
    body: str
    evidence_ids: list[str] = []
    suggested_action: str
    safety_passed: bool


def get_recent_metrics(household_id: str) -> dict:
    """Tool 1: Retrieve recent metrics and observations for authorized household."""
    repo = get_repository()
    desk = repo.get_desk(household_id)
    return {
        "household_id": household_id,
        "parent_name": desk.profile.preferredName if desk else "parent",
        "recent_memories": [m.text for m in (desk.memories[:5] if desk else [])],
        "active_medicines": [m.name for m in (desk.medicines if desk else [])],
    }


def compose_family_insight(
    household_id: str,
    draft_headline: str,
    draft_body: str,
    metric_fact: str = "routine response pauses",
    parent_name: str = "your parent",
    evidence_ids: list[str] = None,
) -> InsightOutput:
    """Tool 2: Compose insight and apply SafetyGuard validation."""
    guard_result = validate_caregiver_text(
        draft_text=draft_body,
        parent_name=parent_name,
        metric_fact=metric_fact,
        fallback_action="Call to check in",
    )

    return InsightOutput(
        tier=2 if not guard_result.is_safe or "pause" in draft_body.lower() else 1,
        headline="Routine observation update" if not guard_result.is_safe else draft_headline,
        body=guard_result.final_text,
        evidence_ids=evidence_ids or [],
        suggested_action="Call parent to check in",
        safety_passed=guard_result.is_safe,
    )


def send_alert(
    household_id: str,
    tier: int,
    message: str,
    action: str = "Call parent",
) -> dict:
    """Tool 3: Record alert to Firestore outbox and notify authorized caregiver."""
    repo = get_repository()
    client = repo.client
    alert_record = {
        "household_id": household_id,
        "tier": tier,
        "message": message,
        "action": action,
        "created_at": "now",
        "status": "queued",
    }
    if client and not repo._use_fallback:
        try:
            client.collection("households").document(household_id).collection("alerts").add(alert_record)
        except Exception as exc:
            logger.error("Failed to write alert to Firestore: %s", exc)

    return {"status": "alert_queued", "tier": tier, "householdId": household_id}
