"""Household and Care Desk API routes."""

from datetime import datetime, timezone
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from saathi.auth.firebase import add_member, ensure_household_access, get_current_actor, is_demo_household
from saathi.contracts.desk import Desk, create_demo_desk
from saathi.contracts.identity import ActorContext, FamilyLinkRecord, HouseholdRecord
from saathi.providers.firestore import get_repository

router = APIRouter(prefix="/api/v1", tags=["households"])


class CreateHouseholdRequest(BaseModel):
    caretaker_name: str = ""
    parent_name: str = ""
    language: str = "Hindi"


class PairRequest(BaseModel):
    code: str
    parent_name: str


@router.post("/households", response_model=HouseholdRecord)
def create_household(
    body: CreateHouseholdRequest,
    actor: ActorContext = Depends(get_current_actor),
) -> HouseholdRecord:
    repo = get_repository()
    household_id = f"hh-{uuid.uuid4().hex[:12]}"
    record = HouseholdRecord(
        id=household_id,
        created_at=datetime.now(timezone.utc).isoformat(),
        creator_uid=actor.uid,
        caretaker_name=body.caretaker_name,
        parent_name=body.parent_name,
        language=body.language,
    )
    repo.save_household(record)

    # Initialize desk
    desk = Desk()
    desk.profile.preferredName = body.parent_name
    desk.profile.language = body.language
    repo.save_desk(household_id, desk)
    return record


@router.get("/households/{household_id}/desk", response_model=Desk)
def get_household_desk(
    household_id: str,
    actor: ActorContext = Depends(get_current_actor),
) -> Desk:
    ensure_household_access(actor, household_id, allow_family_code=True)
    repo = get_repository()
    desk = repo.get_desk(household_id)
    if not desk:
        desk = create_demo_desk() if is_demo_household(household_id) else Desk()
        repo.save_desk(household_id, desk)
    return desk


@router.put("/households/{household_id}/desk", response_model=Desk)
def update_household_desk(
    household_id: str,
    desk: Desk,
    actor: ActorContext = Depends(get_current_actor),
) -> Desk:
    ensure_household_access(actor, household_id)
    repo = get_repository()
    repo.save_desk(household_id, desk)
    return desk


@router.post("/households/{household_id}/pairing", response_model=FamilyLinkRecord)
def create_pairing_link(
    household_id: str,
    caretaker_name: str = "",
    parent_name: str = "",
    actor: ActorContext = Depends(get_current_actor),
) -> FamilyLinkRecord:
    ensure_household_access(actor, household_id)
    if household_id in ("demo", "demo-kamla-sharma"):
        return FamilyLinkRecord(
            code="KMR-4F7",
            household_id=household_id,
            caretaker_name="Rahul",
            parent_name="Kamla",
            created_at=datetime.now(timezone.utc).isoformat(),
        )

    repo = get_repository()
    record = repo.create_family_code(
        household_id=household_id,
        caretaker_name=caretaker_name,
        parent_name=parent_name,
    )
    repo.revoke_family_codes(household_id, keep=record.code)
    return record


@router.get("/households/{household_id}/pairing", response_model=Optional[FamilyLinkRecord])
def current_pairing_link(
    household_id: str,
    actor: ActorContext = Depends(get_current_actor),
) -> Optional[FamilyLinkRecord]:
    """The household's current family code and whether the parent has joined with it."""
    ensure_household_access(actor, household_id)
    if household_id in ("demo", "demo-kamla-sharma"):
        return None
    codes = get_repository().household_family_codes(household_id)
    return codes[0] if codes else None


@router.get("/pair/{code}", response_model=FamilyLinkRecord)
def lookup_family_code(code: str) -> FamilyLinkRecord:
    if code.upper().replace("-", "") == "KMR4F7":
        return FamilyLinkRecord(
            code="KMR-4F7",
            household_id="demo-kamla-sharma",
            caretaker_name="Rahul",
            parent_name="Kamla",
            created_at=datetime.now(timezone.utc).isoformat(),
        )

    repo = get_repository()
    record = repo.find_family_code(code)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Family code not found. Check the code and try again.",
        )
    return record


@router.post("/pair", response_model=FamilyLinkRecord)
def pair_with_family_code(body: PairRequest, actor: ActorContext = Depends(get_current_actor)) -> FamilyLinkRecord:
    if body.code.upper().replace("-", "") == "KMR4F7":
        return FamilyLinkRecord(
            code="KMR-4F7",
            household_id="demo-kamla-sharma",
            caretaker_name="Rahul",
            parent_name="Kamla",
            created_at=datetime.now(timezone.utc).isoformat(),
            joined_at=datetime.now(timezone.utc).isoformat(),
            joined_name=body.parent_name,
        )

    repo = get_repository()
    record = repo.mark_family_code_joined(body.code, body.parent_name)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid or expired family code.",
        )
    if actor.verified:
        add_member(record.household_id, actor.uid)
    return record


@router.get("/demo/desk", response_model=Desk)
def get_demo_desk() -> Desk:
    """Returns the synthetic Kamla Sharma desk."""
    return create_demo_desk()
