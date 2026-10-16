"""Caregiver notification: an in-app alert document always, an FCM push when a device token is stored.

Push text is fixed. It never carries a name, a quote, or a medicine label (master plan section 3, Alerts).
"""

import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional

from saathi.providers.firestore import get_repository

logger = logging.getLogger(__name__)

PUSH_CHECK_IN = ("Saathi", "Saathi wants to talk")
PUSH_UPDATE = ("Saathi", "New Saathi update")


def register_device(household_id: str, token: str, role: str) -> str:
    """Store one browser's FCM token for a household. The document id is a hash of the token."""
    key = hashlib.sha256(token.encode("utf-8")).hexdigest()[:24]
    get_repository().doc_set(
        f"households/{household_id}/devices/{key}",
        {"token": token, "role": role, "updated_at": datetime.now(timezone.utc).isoformat()},
        merge=True,
    )
    return key


def push_to_caretakers(household_id: str, title_body: tuple[str, str] = PUSH_UPDATE) -> int:
    """Send the generic push to every caretaker device. Returns how many sends were accepted."""
    from saathi.scheduling.service import send_fcm_notification

    sent = 0
    for row in get_repository().col_list(f"households/{household_id}/devices", 20):
        if row.get("role") == "parent" or not row.get("token"):
            continue
        if send_fcm_notification(row["token"], title_body[0], title_body[1]):
            sent += 1
    return sent


def raise_alert(
    household_id: str,
    tier: int,
    message: str,
    action: str,
    issue_key: str,
    evidence_ids: Optional[list[str]] = None,
    cooldown_hours: float = 24.0,
) -> dict:
    """Write an alert for the care desk and push the generic notice.

    A repeat of the same issue inside the cooldown appends evidence to the open alert instead of making
    another. A Level 3 alert ignores the cooldown (a new explicit request for help is always new).
    """
    repo = get_repository()
    now = datetime.now(timezone.utc)
    alert_id = hashlib.sha256(f"{issue_key}".encode("utf-8")).hexdigest()[:16]
    path = f"households/{household_id}/alerts/{alert_id}"

    existing = repo.doc_get(path) if tier < 3 else None
    if existing and existing.get("status") == "open":
        try:
            age_h = (now - datetime.fromisoformat(existing["created_at"])).total_seconds() / 3600
        except Exception:
            age_h = 0.0
        if age_h < cooldown_hours:
            merged = list(dict.fromkeys([*(existing.get("evidence_ids") or []), *(evidence_ids or [])]))
            repo.doc_set(path, {"evidence_ids": merged, "updated_at": now.isoformat()})
            return {"status": "evidence_appended", "alertId": alert_id, "tier": existing.get("tier", tier)}

    if tier >= 3:
        alert_id = f"{alert_id}-{int(now.timestamp())}"
        path = f"households/{household_id}/alerts/{alert_id}"

    repo.doc_set(path, {
        "id": alert_id,
        "household_id": household_id,
        "tier": tier,
        "message": message,
        "action": action,
        "issue_key": issue_key,
        "evidence_ids": evidence_ids or [],
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
        "status": "open",
    }, merge=False)
    pushed = 0
    if tier >= 2:
        try:
            pushed = push_to_caretakers(household_id)
        except Exception as exc:
            logger.warning("Push skipped (%s)", exc)
    return {"status": "alert_created", "alertId": alert_id, "tier": tier, "pushed": pushed}
