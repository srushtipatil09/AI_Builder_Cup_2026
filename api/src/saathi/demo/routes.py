"""Demo routes for logical clock advance and synthetic isolation."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
import logging
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from saathi.contracts.desk import Desk, create_demo_desk
from saathi.demo.seed import SCENARIOS, SEEDED_TRANSCRIPT, seed_household
from saathi.files.read_note import PageRead, read_page
from saathi.pipeline import local_date_of
from saathi.providers.firestore import get_repository
from saathi.taskqueue import enqueue_post_call
from saathi.usage import extraction_allowed, record_extraction

logger = logging.getLogger(__name__)
_SAMPLE_NOTE = Path(__file__).with_name("sample_note.png")

router = APIRouter(prefix="/api/v1/demo", tags=["demo"])

# Demo logical clock state (scoped to demo household only)
_demo_offset_seconds: int = 0


@router.get("/desk", response_model=Desk)
def get_demo_desk() -> Desk:
    """Returns the persistent demo Care Desk from Firestore, seeded if missing."""
    repo = get_repository()
    desk = repo.get_desk("demo-kamla-sharma")
    if not desk:
        desk = create_demo_desk()
        repo.save_desk("demo-kamla-sharma", desk)
    return desk


@router.put("/desk", response_model=Desk)
def update_demo_desk(desk: Desk) -> Desk:
    """Saves updates to the demo Care Desk in live Firestore."""
    repo = get_repository()
    repo.save_desk("demo-kamla-sharma", desk)
    return desk



class AdvanceClockRequest(BaseModel):
    seconds: int = 1200 # Default +20 minutes


@router.post("/advance")
def advance_demo_clock(body: AdvanceClockRequest):
    """Advances the logical clock for the synthetic Kamla Sharma household."""
    global _demo_offset_seconds
    _demo_offset_seconds += body.seconds
    simulated_now = datetime.now(timezone.utc) + timedelta(seconds=_demo_offset_seconds)
    return {
        "status": "clock_advanced",
        "addedSeconds": body.seconds,
        "simulatedTime": simulated_now.isoformat(),
        "simulatedTimeFormatted": simulated_now.strftime("%I:%M %p"),
    }


@router.post("/reset")
def reset_demo_state():
    """Resets demo household state and logical clock."""
    global _demo_offset_seconds
    _demo_offset_seconds = 0
    return {
        "status": "reset",
        "desk": create_demo_desk(),
        "simulatedTime": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/status")
def get_demo_status():
    """Returns status and simulated time for the demo."""
    simulated_now = datetime.now(timezone.utc) + timedelta(seconds=_demo_offset_seconds)
    return {
        "isDemo": True,
        "household": "demo-kamla-sharma",
        "simulatedTime": simulated_now.isoformat(),
        "simulatedTimeFormatted": simulated_now.strftime("%I:%M %p"),
        "clockOffsetSeconds": _demo_offset_seconds,
    }


class SeedRequest(BaseModel):
    household: str = "demo-kamla-sharma"
    scenario: str = "family"


@router.post("/seed")
def seed_history(body: SeedRequest):
    """Writes a labeled synthetic 16-day history for a demo household, then runs drift and the insight on it."""
    if not body.household.startswith("demo-"):
        raise HTTPException(status_code=400, detail="Only demo households can be seeded.")
    if body.scenario not in SCENARIOS:
        raise HTTPException(status_code=400, detail=f"Scenario must be one of {', '.join(SCENARIOS)}.")
    return seed_household(body.household, body.scenario)


class SeededSessionRequest(BaseModel):
    household: str = "demo-kamla-sharma"


@router.post("/run-seeded-session")
def run_seeded_session(body: SeededSessionRequest):
    """Feeds a recorded transcript through the real pipeline. No speech timing is invented for it."""
    if not body.household.startswith("demo-"):
        raise HTTPException(status_code=400, detail="Only demo households can run the seeded session.")
    session_id = f"seed-{uuid.uuid4().hex[:8]}"
    get_repository().doc_set(f"households/{body.household}/sessions/{session_id}", {
        "id": session_id,
        "household_id": body.household,
        "utterances": SEEDED_TRANSCRIPT,
        "local_date": local_date_of(),
        "quality_flags": ["recorded_transcript", "no_turns_measured"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }, merge=True)
    return {"status": "started", "sessionId": session_id, "handoff": enqueue_post_call(body.household, session_id)}


class SimulateInactivity(BaseModel):
    household: str = "demo-kamla-sharma"


INACTIVITY_LABEL = "Simulated. This build does not read a Nest sensor."


@router.post("/simulate-inactivity")
def simulate_inactivity(body: SimulateInactivity):
    """Sends the same kind of event the scheduler already understands: an invitation the open chat plays."""
    from saathi.scheduling.service import _create_invitation

    if not body.household.startswith("demo-"):
        raise HTTPException(status_code=400, detail="Only demo households can simulate inactivity.")
    now = datetime.now(timezone.utc)
    key = f"demo-inactivity-{uuid.uuid4().hex[:6]}"
    _create_invitation(body.household, key, "inactivity", now)
    return {"label": INACTIVITY_LABEL, "invitation": key}


class SimulateCheckin(BaseModel):
    household: str = "demo-kamla-sharma"
    outcome: str = "unanswered"  # or "device_unavailable" or "quiet"


@router.post("/simulate-checkin")
def simulate_checkin(body: SimulateCheckin):
    """Demo clock for the synthetic household only: backdate a check-in invitation, then run the real evaluation."""
    from datetime import timedelta
    from saathi.scheduling.service import evaluate_invitations

    if not body.household.startswith("demo-"):
        raise HTTPException(status_code=400, detail="Only demo households can use the demo clock.")
    if body.outcome not in ("unanswered", "device_unavailable", "quiet"):
        raise HTTPException(status_code=400, detail="Outcome must be unanswered, device_unavailable, or quiet.")
    repo = get_repository()
    now = datetime.now(timezone.utc)
    if body.outcome == "quiet":
        from saathi.scheduling.service import in_quiet_hours

        desk = repo.get_desk(body.household, fresh=True)
        if desk is None:
            raise HTTPException(status_code=404, detail="This demo household has no desk yet.")
        desk.profile.quietHours = "13:00-15:00"
        repo.save_desk(body.household, desk)
        skipped = in_quiet_hours("14:00", desk.profile.quietHours)
        note = "Quiet hours are 1 pm to 3 pm. A check-in at 2 pm does not start."
        return {"label": note if skipped else "The quiet-hours check did not apply.", "invitation": "", "events": [{"type": "check_in_skipped_quiet_hours" if skipped else "check_in_due"}]}
    key = f"demo-{body.outcome}-{uuid.uuid4().hex[:6]}"
    past = (now - timedelta(minutes=16)).isoformat()
    if body.outcome == "unanswered":
        doc = {"status": "invitation_played", "attempts": 2, "first_played_at": past, "created_at": past}
    else:
        doc = {"status": "scheduled", "attempts": 0, "created_at": past}
    repo.doc_set(f"households/{body.household}/invitations/{key}", {"id": key, "reason": "check_in", "household_id": body.household, **doc}, merge=False)
    events = evaluate_invitations(body.household, now)
    return {"label": "Demo clock for this synthetic household only.", "invitation": key, "events": events}


@router.post("/read-sample", response_model=PageRead)
def read_sample_note() -> PageRead:
    """One Flash read of the synthetic sample page. The same guard as a saved file."""
    if not extraction_allowed():
        raise HTTPException(status_code=429, detail="The daily reading limit is reached. Try again tomorrow.")
    if not _SAMPLE_NOTE.is_file():
        raise HTTPException(status_code=404, detail="The sample page is not in this build.")
    desk = get_repository().get_desk("demo-kamla-sharma")
    record_extraction()
    try:
        return read_page(_SAMPLE_NOTE.read_bytes(), "image/png", desk.profile.language if desk else "")
    except Exception as exc:
        logger.warning("Sample page read failed (%s)", exc)
        raise HTTPException(status_code=502, detail="This page could not be read.") from exc
