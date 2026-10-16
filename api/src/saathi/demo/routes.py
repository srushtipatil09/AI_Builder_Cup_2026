"""Demo routes for logical clock advance and synthetic isolation."""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter
from pydantic import BaseModel

from saathi.contracts.desk import create_demo_desk

router = APIRouter(prefix="/api/v1/demo", tags=["demo"])

# Demo logical clock state (scoped to demo household only)
_demo_offset_seconds: int = 0


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
