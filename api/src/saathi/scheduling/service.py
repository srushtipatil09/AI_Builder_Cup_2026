"""Scheduler tick: due check-ins and reminders, the invitation lifecycle, and FCM dispatch.

A closed phone app does not listen. A due check-in is a push that says "Saathi wants to talk" and, when the app
is already open and visible, an invitation the open chat picks up on its next poll. Speech starts after that.
"""

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from firebase_admin import messaging as fcm_messaging
from pydantic import BaseModel

from saathi.auth.firebase import ensure_firebase_initialized
from saathi.notify import PUSH_CHECK_IN, raise_alert
from saathi.pipeline import LOCAL_TZ
from saathi.providers.firestore import get_repository

logger = logging.getLogger(__name__)

InvitationOutcome = Literal[
    "responded",
    "awaiting_retry",
    "unanswered",
    "device_unavailable",
    "snoozed",
]

# Prototype timers (master plan section 5.3)
RETRY_AFTER_MINUTES = 5.0
DECISION_AFTER_MINUTES = 15.0
CLAIM_LEASE_SECONDS = 60
READY_HEARTBEAT_SECONDS = 30
# Firestore bills every document read and written. These keep the open chat and the minute tick cheap.
HEARTBEAT_WRITE_EVERY_SECONDS = 60
NO_INVITATION_RECHECK_SECONDS = 10
EVALUATE_EVERY_MINUTES = 5
SWEEP_EVERY_MINUTES = 60
INDEX_CHECK_SECONDS = 6 * 3600
WATCH_SECONDS = 25 * 60
OPEN_INVITATION_STATES = ["scheduled", "claimed", "invitation_played"]

_last_beat: dict[str, float] = {}
_none_until: dict[str, float] = {}
# Households this worker made an invitation for: their invitations are checked at every evaluation until the watch ends.
_watch: dict[str, float] = {}
_index_checked_at: float = -1e9


def evaluate_invitation_lifecycle(
    attempt: int,
    minutes_elapsed: float,
    responded: bool,
    device_healthy: bool,
    snoozed: bool = False,
) -> InvitationOutcome:
    """Evaluates the 30s/5min/15min unanswered check-in workflow."""
    if not device_healthy:
        return "device_unavailable"
    if responded:
        return "responded"
    if snoozed:
        return "snoozed"
    if attempt == 1 and minutes_elapsed < 15.0:
        return "awaiting_retry"
    if attempt >= 2 and minutes_elapsed >= 15.0:
        return "unanswered"
    return "awaiting_retry"


def send_fcm_notification(fcm_token: str, title: str, body: str) -> bool:
    """Dispatches push notification via Firebase Cloud Messaging."""
    if not fcm_token or fcm_token == "mock-token":
        logger.info("Mock FCM notification dispatched: '%s' - '%s'", title, body)
        return True

    if ensure_firebase_initialized():
        try:
            message = fcm_messaging.Message(
                notification=fcm_messaging.Notification(title=title, body=body),
                webpush=fcm_messaging.WebpushConfig(fcm_options=fcm_messaging.WebpushFCMOptions(link="/app")),
                token=fcm_token,
            )
            response = fcm_messaging.send(message)
            logger.info("FCM sent successfully: %s", response)
            return True
        except Exception as exc:
            logger.warning("FCM dispatch failed (%s)", exc)
            return False

    return True


def in_quiet_hours(hhmm: str, quiet: str) -> bool:
    """quiet is "HH:MM-HH:MM", possibly across midnight. Free text from older desks never blocks a check-in."""
    try:
        start, end = quiet.split("-")
        if len(start) != 5 or len(end) != 5:
            return False
    except ValueError:
        return False
    if start <= end:
        return start <= hhmm < end
    return hhmm >= start or hhmm < end


def _iso(when: datetime) -> str:
    return when.astimezone(timezone.utc).isoformat()


def _parse(value: Optional[str]) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(value) if value else None
    except ValueError:
        return None


def _push_parent_devices(household_id: str) -> int:
    sent = 0
    for row in get_repository().col_list(f"households/{household_id}/devices", 200):
        if row.get("role") == "parent" and row.get("token"):
            if send_fcm_notification(row["token"], PUSH_CHECK_IN[0], PUSH_CHECK_IN[1]):
                sent += 1
    return sent


def _create_invitation(household_id: str, key: str, reason: str, now: datetime) -> dict:
    repo = get_repository()
    path = f"households/{household_id}/invitations/{key}"
    if repo.doc_get(path):
        return {}
    doc = {
        "id": key, "reason": reason, "status": "scheduled", "attempts": 0,
        "created_at": _iso(now), "household_id": household_id,
    }
    repo.doc_set(path, doc, merge=False)
    _none_until.pop(household_id, None)
    _watch[household_id] = time.monotonic() + WATCH_SECONDS
    _push_parent_devices(household_id)
    return doc


def evaluate_invitations(household_id: str, now: datetime) -> list[dict]:
    """Move unanswered and unreachable invitations to their decision states. Safe to run every minute."""
    repo = get_repository()
    events: list[dict] = []
    open_rows = repo.col_query(f"households/{household_id}/invitations", "status", "in", OPEN_INVITATION_STATES, limit=20)
    if not open_rows:
        return events
    desk = repo.get_desk(household_id)
    name = (desk.profile.preferredName if desk and desk.profile.preferredName else "your parent")
    for inv in open_rows:
        status = inv.get("status")
        path = f"households/{household_id}/invitations/{inv['_id']}"
        created = _parse(inv.get("created_at")) or now
        first_played = _parse(inv.get("first_played_at"))

        if status in ("scheduled", "claimed") and (now - created) >= timedelta(minutes=DECISION_AFTER_MINUTES):
            repo.doc_set(path, {"status": "device_unavailable", "decided_at": _iso(now)})
            raise_alert(
                household_id, 1,
                f"Saathi could not reach {name}'s phone for the check-in. The app was closed or the microphone was "
                "unavailable. This is different from no reply.",
                "Call parent", f"device_unavailable:{inv['_id']}",
            )
            events.append({"type": "device_unavailable", "invitation": inv["_id"]})
        elif status == "invitation_played" and first_played:
            minutes = (now - first_played).total_seconds() / 60.0
            attempts = int(inv.get("attempts", 1))
            outcome = evaluate_invitation_lifecycle(attempts, minutes, responded=False, device_healthy=True)
            if outcome == "unanswered":
                repo.doc_set(path, {"status": "unanswered", "decided_at": _iso(now)})
                raise_alert(
                    household_id, 2,
                    f"Saathi played two check-in invitations to {name} and there was no reply. "
                    "This is a welfare check, not a finding. A phone call is a reasonable next step.",
                    "Call parent", f"unanswered:{inv['_id']}",
                )
                events.append({"type": "unanswered", "invitation": inv["_id"]})
            elif attempts == 1 and minutes >= RETRY_AFTER_MINUTES:
                repo.doc_set(path, {"status": "awaiting_retry"})
                events.append({"type": "retry_due", "invitation": inv["_id"]})
    return events


def _load_index(repo, now_mono: float) -> dict[str, dict]:
    """Every household's check-in and reminder times from one document. Once an hour it is checked against the desks."""
    global _index_checked_at
    from saathi.providers.firestore import SCHEDULE_INDEX, schedule_entry, schedule_key

    stored = repo.doc_get(SCHEDULE_INDEX) or {}
    if now_mono - _index_checked_at > INDEX_CHECK_SECONDS:
        _index_checked_at = now_mono
        repaired = False
        for household_id in repo.list_doc_ids("households"):
            desk = repo.get_desk(household_id)
            if desk:
                known = stored.get(schedule_key(household_id))
                if known != schedule_entry(household_id, desk):
                    repo.note_schedule(household_id, desk, known=known)
                    repaired = True
        if repaired:
            stored = repo.doc_get(SCHEDULE_INDEX) or {}
    return {v["id"]: v for k, v in stored.items() if k.startswith("h_") and isinstance(v, dict) and v.get("id")}


def run_scheduler_tick(current_hhmm: Optional[str] = None, now: Optional[datetime] = None) -> list[dict]:
    """Runs the minute tick.

    Cloud Scheduler calls this every minute, so it must be nearly free when nothing is due. It reads one document (the
    schedule index) and opens a household's desk only at that household's check-in or reminder minute. Unanswered
    invitations are looked at every five minutes for the demo households and the ones this worker just made
    invitations for, and for every household every half hour. A tick called with an explicit time (tests, a manual run)
    checks every household in full.
    """
    repo = get_repository()
    now = now or datetime.now(timezone.utc)
    local = now.astimezone(LOCAL_TZ)
    hhmm = current_hhmm or local.strftime("%H:%M")
    today = local.strftime("%Y-%m-%d")
    events: list[dict] = []
    mono = time.monotonic()

    full = current_hhmm is not None
    if full:
        index: dict[str, dict] = {}
        household_ids = repo.list_doc_ids("households")
    else:
        index = _load_index(repo, mono)
        household_ids = list(index)
    evaluate_now = full or now.minute % EVALUATE_EVERY_MINUTES == 0
    sweep = full or now.minute % SWEEP_EVERY_MINUTES == 0

    for household_id in household_ids:
        entry = index.get(household_id)
        due_now = entry is None or entry.get("checkIn") == hhmm or hhmm in (entry.get("times") or [])
        look_at_invitations = evaluate_now and (
            sweep or household_id.startswith("demo-") or _watch.get(household_id, 0.0) > mono
        )
        if not due_now and not look_at_invitations:
            continue

        if due_now:
            desk = repo.get_desk(household_id, fresh=not full)
            if not desk:
                continue
            state_path = f"households/{household_id}/schedule/state"
            is_due = desk.profile.checkIn == hhmm or any(m.time == hhmm for m in desk.medicines)
            state = (repo.doc_get(state_path) or {}) if is_due else {}

            if desk.profile.checkIn == hhmm and state.get("lastCheckInDate") != today:
                if in_quiet_hours(hhmm, desk.profile.quietHours):
                    events.append({"type": "check_in_skipped_quiet_hours", "household_id": household_id})
                elif _create_invitation(household_id, f"{today}-checkin", "check_in", now):
                    events.append({"type": "check_in_due", "household_id": household_id, "lockscreen_text": PUSH_CHECK_IN[1]})
                repo.doc_set(state_path, {"lastCheckInDate": today})

            fired = dict(state.get("reminders") or {})
            for med in desk.medicines:
                due = med.time == hhmm and (med.schedule == "Daily" or med.date == today)
                if due and med.confirmedOn != today and fired.get(med.id) != today:
                    fired[med.id] = today
                    _create_invitation(household_id, f"{today}-{med.id}", "reminder", now)
                    events.append({"type": "reminder_due", "household_id": household_id, "medicine_id": med.id, "lockscreen_text": PUSH_CHECK_IN[1]})
            if fired != (state.get("reminders") or {}):
                repo.doc_set(state_path, {"reminders": fired})

        if look_at_invitations:
            events.extend({**e, "household_id": household_id} for e in evaluate_invitations(household_id, now))
    return events


# ---- what the open chat on the parent's phone calls -------------------------------------------------

def record_heartbeat(household_id: str, visible: bool = True) -> None:
    # The open chat says it is ready every few seconds; one write every 25 seconds says the same thing.
    if time.monotonic() - _last_beat.get(household_id, -1e9) < HEARTBEAT_WRITE_EVERY_SECONDS:
        return
    _last_beat[household_id] = time.monotonic()
    get_repository().doc_set(
        f"households/{household_id}/presence/parent",
        {"last_seen": _iso(datetime.now(timezone.utc)), "visible": visible},
    )


def claim_due_invitation(household_id: str, now: Optional[datetime] = None) -> Optional[dict]:
    """The next invitation the open chat should play, leased for 60 seconds so two tabs do not both play it."""
    repo = get_repository()
    now = now or datetime.now(timezone.utc)
    if time.monotonic() < _none_until.get(household_id, 0.0):
        return None
    open_rows = repo.col_query(
        f"households/{household_id}/invitations", "status", "in", ["scheduled", "awaiting_retry", "claimed"], limit=20
    )
    if not open_rows:
        _none_until[household_id] = time.monotonic() + NO_INVITATION_RECHECK_SECONDS
    for inv in sorted(open_rows, key=lambda r: r.get("created_at", "")):
        status = inv.get("status")
        if status not in ("scheduled", "awaiting_retry", "claimed"):
            continue
        leased = _parse(inv.get("claimed_at"))
        if status == "claimed" and leased and (now - leased).total_seconds() < CLAIM_LEASE_SECONDS:
            continue
        repo.doc_set(f"households/{household_id}/invitations/{inv['_id']}", {"status": "claimed", "claimed_at": _iso(now)})
        return {"id": inv["_id"], "reason": inv.get("reason", "check_in"), "attempt": int(inv.get("attempts", 0)) + 1}
    return None


def mark_invitation(household_id: str, invitation_id: str, event: str, reason: str = "") -> dict:
    """played, responded, snoozed, or device_unavailable, reported by the chat on the phone."""
    repo = get_repository()
    now = datetime.now(timezone.utc)
    path = f"households/{household_id}/invitations/{invitation_id}"
    inv = repo.doc_get(path)
    if not inv:
        return {"status": "not_found"}
    if inv.get("status") in ("responded", "snoozed", "unanswered", "device_unavailable"):
        return {"status": inv["status"]}
    if event == "played":
        updates = {"status": "invitation_played", "attempts": int(inv.get("attempts", 0)) + 1, "last_played_at": _iso(now)}
        if not inv.get("first_played_at"):
            updates["first_played_at"] = _iso(now)
    elif event in ("responded", "snoozed"):
        updates = {"status": event, "decided_at": _iso(now)}
    elif event == "device_unavailable":
        updates = {"status": "device_unavailable", "decided_at": _iso(now), "device_reason": reason[:60]}
        desk = repo.get_desk(household_id)
        name = desk.profile.preferredName if desk and desk.profile.preferredName else "your parent"
        raise_alert(
            household_id, 1,
            f"Saathi could not reach {name}'s phone for the check-in. The microphone was unavailable. This is different from no reply.",
            "Call parent", f"device_unavailable:{invitation_id}",
        )
    else:
        return {"status": "ignored"}
    repo.doc_set(path, updates)
    return {"status": updates["status"]}
