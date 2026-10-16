"""What the care desk reads and acts on: updates, metrics, alerts, Ask Saathi, device tokens, invitations."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from saathi.asks import service as asks
from saathi.auth.firebase import ensure_household_access, get_current_actor, is_demo_household
from saathi.contracts.desk import Desk
from saathi.contracts.identity import ActorContext
from saathi.notify import register_device
from saathi.providers.firestore import get_repository

router = APIRouter(prefix="/api/v1/households/{household_id}", tags=["updates"])


def _access(actor: ActorContext, household_id: str) -> None:
    ensure_household_access(actor, household_id)


def _phone_access(actor: ActorContext, household_id: str) -> None:
    """The parent's phone may use its joined family code here."""
    ensure_household_access(actor, household_id, allow_family_code=True)


def _clean(row: dict) -> dict:
    return {k: v for k, v in row.items() if k != "_id" and k != "embedding"}


@router.get("/updates")
def get_updates(household_id: str, actor: ActorContext = Depends(get_current_actor)) -> dict:
    """Latest insight, family card, open alerts, drift status, and the last three conversation summaries."""
    _access(actor, household_id)
    repo = get_repository()
    base = f"households/{household_id}"
    alerts = [_clean({**a, "id": a.get("id") or a["_id"]}) for a in repo.col_list(f"{base}/alerts", 50)]
    alerts = sorted([a for a in alerts if a.get("status") == "open"], key=lambda a: a.get("created_at", ""), reverse=True)
    observations = sorted(repo.col_list(f"{base}/observations", 60), key=lambda o: o.get("created_at", ""), reverse=True)
    sessions = repo.col_list(f"{base}/sessions", 60)
    processed = sorted([s.get("processed_at", "") for s in sessions if s.get("processed_at")], reverse=True)
    return {
        "insight": repo.doc_get(f"{base}/insights/latest"),
        "familyCard": repo.doc_get(f"{base}/familyCard/latest"),
        "drift": repo.doc_get(f"{base}/driftResults/latest"),
        "alerts": alerts,
        "summaries": [
            {"date": o.get("local_date"), "text": o["summary"], "session_id": o.get("session_id")}
            for o in observations if o.get("summary")
        ][:3],
        "sessionsProcessed": len(processed),
        "lastProcessedAt": processed[0] if processed else None,
        "synthetic": is_demo_household(household_id),
        "serverTime": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/metrics")
def get_metrics(household_id: str, days: int = 14, actor: ActorContext = Depends(get_current_actor)) -> dict:
    """The last N local days of daily metrics. Missing days are absent, not zero."""
    _access(actor, household_id)
    rows = get_repository().col_list(f"households/{household_id}/dailyMetrics", 120)
    rows = sorted([_clean(r) for r in rows], key=lambda r: r.get("local_date", ""))[-max(1, min(days, 60)):]
    drift = get_repository().doc_get(f"households/{household_id}/driftResults/latest")
    return {"days": rows, "drift": drift, "synthetic": any(r.get("synthetic") for r in rows)}


@router.post("/alerts/{alert_id}/ack")
def ack_alert(household_id: str, alert_id: str, actor: ActorContext = Depends(get_current_actor)) -> dict:
    _access(actor, household_id)
    get_repository().doc_set(
        f"households/{household_id}/alerts/{alert_id}",
        {"status": "acknowledged", "acknowledged_at": datetime.now(timezone.utc).isoformat(), "acknowledged_by": actor.name or actor.email or actor.uid},
    )
    return {"status": "acknowledged", "alertId": alert_id}


class DeviceRequest(BaseModel):
    token: str
    role: str = "caretaker"


@router.post("/devices")
def add_device(household_id: str, body: DeviceRequest, actor: ActorContext = Depends(get_current_actor)) -> dict:
    """Store an FCM token. The push text is fixed and carries no name, quote, or medicine.

    The parent's phone registers its own token with its joined family code; a caretaker device needs membership.
    """
    if body.role == "parent":
        _phone_access(actor, household_id)
    else:
        _access(actor, household_id)
    if not body.token or len(body.token) > 4096:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A device token is required.")
    return {"status": "registered", "deviceId": register_device(household_id, body.token, body.role)}


class AskRequest(BaseModel):
    text: str


class AskConfirmRequest(BaseModel):
    proposal_id: str
    hash: str


@router.post("/ask", response_model=asks.Proposal)
def ask_saathi(household_id: str, body: AskRequest, actor: ActorContext = Depends(get_current_actor)) -> asks.Proposal:
    """Turn a note into one proposed change and its read-back. Nothing is saved yet."""
    _access(actor, household_id)
    text = body.text.strip()
    if not text or len(text) > 600:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Write the change in 600 characters or fewer.")
    author = actor.name or ("Rahul" if is_demo_household(household_id) else "Caretaker")
    return asks.build_proposal(household_id, text, author)


@router.post("/ask/confirm")
def confirm_ask(household_id: str, body: AskConfirmRequest, actor: ActorContext = Depends(get_current_actor)) -> dict:
    """Save a proposal after the caretaker confirmed the read-back."""
    _access(actor, household_id)
    try:
        proposal, desk = asks.confirm(household_id, body.proposal_id, body.hash)
    except asks.ConfirmError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    return {"status": proposal.status, "proposalId": proposal.id, "desk": desk.model_dump()}


@router.post("/ask/{proposal_id}/cancel")
def cancel_ask(household_id: str, proposal_id: str, actor: ActorContext = Depends(get_current_actor)) -> dict:
    _access(actor, household_id)
    asks.cancel(household_id, proposal_id)
    return {"status": "cancelled", "proposalId": proposal_id}


# ---- the parent's open chat: presence, due invitations ---------------------------------------------

@router.post("/heartbeat")
def heartbeat(household_id: str, actor: ActorContext = Depends(get_current_actor)) -> dict:
    """The open, visible chat says it is ready. A closed app sends nothing."""
    _phone_access(actor, household_id)
    from saathi.scheduling.service import record_heartbeat

    record_heartbeat(household_id)
    return {"status": "ok"}


@router.get("/invitation")
def next_invitation(household_id: str, actor: ActorContext = Depends(get_current_actor)) -> dict:
    """The check-in the open chat should play now, or none."""
    _phone_access(actor, household_id)
    from saathi.scheduling.service import claim_due_invitation

    return {"invitation": claim_due_invitation(household_id)}


class InvitationEvent(BaseModel):
    reason: str = ""


@router.post("/invitation/{invitation_id}/{event}")
def invitation_event(
    household_id: str, invitation_id: str, event: str, body: InvitationEvent = InvitationEvent(),
    actor: ActorContext = Depends(get_current_actor),
) -> dict:
    """played, responded, snoozed (counts as a response), or device_unavailable."""
    _phone_access(actor, household_id)
    from saathi.scheduling.service import mark_invitation

    return mark_invitation(household_id, invitation_id, event, body.reason)


@router.post("/contact-family")
def contact_family(household_id: str, actor: ActorContext = Depends(get_current_actor)) -> dict:
    """The parent pressed Contact family. Level 3: the caregiver is told now, with no analytics in the way."""
    _phone_access(actor, household_id)
    from saathi.notify import raise_alert

    desk = get_repository().get_desk(household_id)
    who = desk.profile.preferredName if desk and desk.profile.preferredName else "Your parent"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return raise_alert(
        household_id, 3,
        f"{who} pressed Contact family on the phone and wants to talk. Please call them now.",
        "Call parent", f"contact_family:{stamp}",
    )
