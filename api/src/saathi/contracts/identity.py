"""Identity and household contracts."""

from typing import Literal, Optional
from pydantic import BaseModel, Field

Role = Literal["caretaker", "parent"]


class ActorContext(BaseModel):
    uid: str
    household_id: str
    role: Role
    email: str = ""
    name: str = ""
    is_demo: bool = False
    # True only when a Firebase ID token was verified for this request.
    verified: bool = False
    # A joined family code the caller presented (the parent's device has no account).
    family_code: str = ""


class HouseholdRecord(BaseModel):
    id: str
    created_at: str
    creator_uid: str
    caretaker_name: str = ""
    parent_name: str = ""
    language: str = "Hindi"
    family_code: Optional[str] = None


class FamilyLinkRecord(BaseModel):
    code: str
    household_id: str
    parent_name: str = ""
    caretaker_name: str = ""
    created_at: str
    joined_at: Optional[str] = None
    joined_name: Optional[str] = None
