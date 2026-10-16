"""Firebase Auth verification, actor context, and household access checks."""

import logging
from typing import Optional

from fastapi import Header, HTTPException, status
import firebase_admin
from firebase_admin import auth as firebase_auth

from saathi.config import load_settings
from saathi.contracts.identity import ActorContext, Role

logger = logging.getLogger(__name__)

# Initialize Firebase Admin once if configured
_firebase_initialized = False

DEMO_HOUSEHOLD_PREFIX = "demo"


def is_demo_household(household_id: str) -> bool:
    """The synthetic households are open to everyone: no real person's data lives there."""
    return household_id == "demo-kamla-sharma" or household_id.startswith("demo-")


def ensure_firebase_initialized() -> bool:
    global _firebase_initialized
    if _firebase_initialized:
        return True
    settings = load_settings()
    project_id = settings.firebase_project_id or settings.google_cloud_project
    if not project_id:
        return False
    try:
        if not firebase_admin._apps:
            firebase_admin.initialize_app(options={"projectId": project_id})
        _firebase_initialized = True
        return True
    except Exception as exc:
        logger.warning("Firebase Admin could not initialize (%s). Falling back to mock auth.", exc)
        return False


def actor_from_token(
    token: str,
    household_id: Optional[str] = None,
    role: Optional[str] = None,
    family_code: Optional[str] = None,
) -> ActorContext:
    """Build the ActorContext for a bearer token. Raises HTTPException(401) for a bad Firebase token."""
    role_val: Role = "parent" if role == "parent" else "caretaker"
    if not token:
        return ActorContext(
            uid="anonymous", household_id=household_id or "default", role=role_val,
            is_demo=True, family_code=family_code or "",
        )

    # Demo bypass
    if token.lower() in ("demo", "demo-token"):
        return ActorContext(
            uid="demo-user",
            household_id="demo-kamla-sharma",
            role=role_val,
            name="Rahul" if role_val == "caretaker" else "Kamla",
            is_demo=True,
        )

    # Real Firebase Auth Verification
    if ensure_firebase_initialized():
        try:
            decoded = firebase_auth.verify_id_token(token, clock_skew_seconds=60)
            uid = decoded.get("uid", "")
            return ActorContext(
                uid=uid,
                household_id=household_id or f"household-{uid[:8]}",
                role=role_val,
                email=decoded.get("email", ""),
                name=decoded.get("name", ""),
                is_demo=False,
                verified=True,
                family_code=family_code or "",
            )
        except Exception as exc:
            logger.warning("Token verification failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid authentication token: {exc}",
            )

    # Local development fallback
    return ActorContext(
        uid=f"dev-{token[:8]}",
        household_id=household_id or f"household-{token[:8]}",
        role=role_val,
        is_demo=False,
        family_code=family_code or "",
    )


def get_current_actor(
    authorization: Optional[str] = Header(None),
    x_household_id: Optional[str] = Header(None, alias="X-Household-Id"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
    x_family_code: Optional[str] = Header(None, alias="X-Family-Code"),
) -> ActorContext:
    """Resolve ActorContext from Authorization header or demo mode."""
    if not authorization:
        return actor_from_token("", x_household_id, x_role, x_family_code)
    parts = authorization.split(" ")
    token = parts[1] if len(parts) == 2 and parts[0].lower() == "bearer" else authorization
    return actor_from_token(token, x_household_id, x_role, x_family_code)


def has_household_access(actor: ActorContext, household_id: str) -> tuple[bool, str]:
    """Decide whether this actor may touch this household. Returns (allowed, reason).

    - Demo households: open.
    - A verified Firebase identity: the verified email equals the household id, the uid owns or belongs to the
      household, or the household is unclaimed (first verified caller claims it).
    - A joined family code that names this household: the parent's device.
    - Anything else is allowed only while REQUIRE_HOUSEHOLD_AUTH is off (local runs without Firebase).
    """
    if is_demo_household(household_id):
        return True, "demo"

    from saathi.providers.firestore import get_repository

    repo = get_repository()
    if actor.family_code and _code_names_household(actor.family_code, household_id):
        return True, "family_code"
    if actor.verified:
        if actor.email and actor.email.lower() == household_id.lower():
            return True, "email_matches_household"
        owner = repo.doc_get(f"households/{household_id}/access/owner")
        if owner is None:
            if "@" in household_id:
                # An email-named household belongs to that email alone; nobody else can claim it.
                return False, "not_a_member"
            record = repo.get_household(household_id)
            if record and record.creator_uid and record.creator_uid != actor.uid:
                return False, "not_a_member"
            repo.doc_set(f"households/{household_id}/access/owner", {"uid": actor.uid, "email": actor.email, "members": [actor.uid]})
            return True, "claimed"
        if owner.get("uid") == actor.uid or actor.uid in (owner.get("members") or []):
            return True, "member"
        return False, "not_a_member"

    if load_settings().require_household_auth:
        return False, "authentication_required"
    return True, "legacy_unauthenticated"


def _code_names_household(code: str, household_id: str) -> bool:
    from saathi.providers.firestore import get_repository

    record = get_repository().find_family_code(code)
    return bool(record and record.household_id == household_id and record.joined_at)


def ensure_household_access(actor: ActorContext, household_id: str) -> None:
    allowed, reason = has_household_access(actor, household_id)
    if not allowed:
        code = status.HTTP_401_UNAUTHORIZED if reason == "authentication_required" else status.HTTP_403_FORBIDDEN
        raise HTTPException(status_code=code, detail="You do not have access to this household.")


def add_member(household_id: str, uid: str) -> None:
    """Record a verified uid (a parent who joined by code) as a member."""
    from saathi.providers.firestore import get_repository

    repo = get_repository()
    owner = repo.doc_get(f"households/{household_id}/access/owner") or {}
    members = list(dict.fromkeys([*(owner.get("members") or []), uid]))
    repo.doc_set(f"households/{household_id}/access/owner", {"members": members})
