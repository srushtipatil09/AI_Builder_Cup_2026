"""The signed-in account's own profile: role, names, language, and the family it joined."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from saathi.auth.firebase import get_current_actor
from saathi.contracts.identity import ActorContext
from saathi.providers.firestore import get_repository

router = APIRouter(prefix="/api/v1/me", tags=["accounts"])


class AccountProfile(BaseModel):
    email: str = ""
    role: str = "caretaker"
    caretakerName: str = ""
    parentName: str = ""
    language: str = "Hindi"
    familyCode: Optional[str] = None
    joinSkipped: bool = False


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
    record = body.model_copy(update={"email": actor.email or body.email, "role": role})
    get_repository().doc_set(f"users/{actor.uid}", record.model_dump())
    return record
