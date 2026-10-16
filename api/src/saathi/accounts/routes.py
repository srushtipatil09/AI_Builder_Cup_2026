"""The signed-in account's own profile: role, names, language, the family it joined, and, for a caretaker,
every family member they look after.

A caretaker's first household is named by their email, as before. Each family member added later gets its own
household (`hh-...`) owned by the caretaker. The list of household ids is written only by this server, so a
client cannot add a household it does not own by editing its profile.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from saathi.auth.firebase import get_current_actor
from saathi.contracts.identity import ActorContext
from saathi.contracts.desk import Desk
from saathi.contracts.identity import HouseholdRecord
from saathi.providers.firestore import get_repository

MAX_HOUSEHOLDS = 10

router = APIRouter(prefix="/api/v1/me", tags=["accounts"])


class HouseholdRef(BaseModel):
    id: str
    parentName: str = ""
    language: str = "Hindi"
    addedAt: str = ""


class AccountProfile(BaseModel):
    email: str = ""
    role: str = "caretaker"
    caretakerName: str = ""
    parentName: str = ""
    language: str = "Hindi"
    familyCode: Optional[str] = None
    joinSkipped: bool = False
    # When the account holder agreed, at signup, to what Saathi stores (docs/PRIVACY.md). ISO time.
    consentAt: Optional[str] = None
    # Family members added after the first. Written by POST /me/households only.
    households: list[HouseholdRef] = []
    # The household the care desk shows. Must be one of this account's households.
    activeHousehold: Optional[str] = None


def _require_verified(actor: ActorContext) -> None:
    if not actor.verified:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to use your account.")


@router.get("", response_model=AccountProfile)
def get_account(actor: ActorContext = Depends(get_current_actor)) -> AccountProfile:
    _require_verified(actor)
    data = get_repository().doc_get(f"users/{actor.uid}")
    if not data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No profile yet.")
    return AccountProfile(**{**data, "email": actor.email or data.get("email", "")})


@router.put("", response_model=AccountProfile)
def put_account(body: AccountProfile, actor: ActorContext = Depends(get_current_actor)) -> AccountProfile:
    _require_verified(actor)
    role = "parent" if body.role == "parent" else "caretaker"
    repo = get_repository()
    stored = repo.doc_get(f"users/{actor.uid}") or {}
    # Consent is given once. A later save from a device that never saw it does not erase it.
    consent = body.consentAt or stored.get("consentAt")
    households = [HouseholdRef(**h) for h in stored.get("households") or []]
    active = body.activeHousehold if body.activeHousehold in _own_ids(actor, households) else stored.get("activeHousehold")
    record = body.model_copy(update={
        "email": actor.email or body.email, "role": role, "consentAt": consent,
        "households": households, "activeHousehold": active,
    })
    repo.doc_set(f"users/{actor.uid}", record.model_dump())
    return record


def _own_ids(actor: ActorContext, households: list[HouseholdRef]) -> list[str]:
    return [i for i in [actor.email, *[h.id for h in households]] if i]


class HouseholdSummary(BaseModel):
    id: str
    parentName: str = ""
    language: str = "Hindi"
    city: str = ""
    primary: bool = False
    phoneConnected: bool = False
    openAlerts: int = 0
    urgentAlerts: int = 0


def _summary(household_id: str, fallback_name: str, fallback_language: str, primary: bool) -> HouseholdSummary:
    repo = get_repository()
    desk = repo.get_desk(household_id)
    alerts = [a for a in repo.col_list(f"households/{household_id}/alerts", 50) if a.get("status") == "open"]
    codes = repo.household_family_codes(household_id)
    return HouseholdSummary(
        id=household_id,
        parentName=(desk.profile.preferredName if desk else "") or fallback_name,
        language=(desk.profile.language if desk else "") or fallback_language,
        city=desk.profile.city if desk else "",
        primary=primary,
        phoneConnected=any(c.joined_at for c in codes),
        openAlerts=len(alerts),
        urgentAlerts=sum(1 for a in alerts if int(a.get("tier", 1)) >= 2),
    )


def _caretaker_profile(actor: ActorContext) -> dict:
    _require_verified(actor)
    data = get_repository().doc_get(f"users/{actor.uid}") or {}
    if data.get("role") == "parent":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only a caretaker account looks after family members.")
    return data


@router.get("/households", response_model=list[HouseholdSummary])
def list_households(actor: ActorContext = Depends(get_current_actor)) -> list[HouseholdSummary]:
    """Every family member this caretaker looks after, with whether the phone is connected and open alerts."""
    data = _caretaker_profile(actor)
    rows = [_summary(actor.email, data.get("parentName", ""), data.get("language", "Hindi"), True)] if actor.email else []
    for h in data.get("households") or []:
        ref = HouseholdRef(**h)
        rows.append(_summary(ref.id, ref.parentName, ref.language, False))
    return rows


class AddHouseholdRequest(BaseModel):
    parentName: str
    language: str = "Hindi"


@router.post("/households", response_model=HouseholdSummary)
def add_household(body: AddHouseholdRequest, actor: ActorContext = Depends(get_current_actor)) -> HouseholdSummary:
    """Add a family member: a new household owned by this caretaker, with its own desk and family code."""
    data = _caretaker_profile(actor)
    name = body.parentName.strip()[:60]
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter the name Saathi should use.")
    households = [HouseholdRef(**h) for h in data.get("households") or []]
    if len(households) + 1 >= MAX_HOUSEHOLDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"One account can look after {MAX_HOUSEHOLDS} family members.")
    language = body.language if body.language in ("Hindi", "English") else "Hindi"
    repo = get_repository()
    now = datetime.now(timezone.utc).isoformat()
    household_id = f"hh-{uuid.uuid4().hex[:12]}"
    repo.save_household(HouseholdRecord(
        id=household_id, created_at=now, creator_uid=actor.uid,
        caretaker_name=data.get("caretakerName", ""), parent_name=name, language=language,
    ))
    desk = Desk()
    desk.profile.preferredName = name
    desk.profile.language = language
    repo.save_desk(household_id, desk)
    repo.doc_set(f"households/{household_id}/access/owner", {"uid": actor.uid, "email": actor.email, "members": [actor.uid]})
    households.append(HouseholdRef(id=household_id, parentName=name, language=language, addedAt=now))
    repo.doc_set(f"users/{actor.uid}", {
        "households": [h.model_dump() for h in households], "activeHousehold": household_id,
    })
    return _summary(household_id, name, language, False)
