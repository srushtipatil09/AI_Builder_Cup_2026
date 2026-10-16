"""Firebase Auth verification and actor context resolution."""

import logging
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
import firebase_admin
from firebase_admin import auth as firebase_auth

from saathi.config import load_settings
from saathi.contracts.identity import ActorContext, Role

logger = logging.getLogger(__name__)

# Initialize Firebase Admin once if configured
_firebase_initialized = False


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


def get_current_actor(
    authorization: Optional[str] = Header(None),
    x_household_id: Optional[str] = Header(None, alias="X-Household-Id"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> ActorContext:
    """Resolve ActorContext from Authorization header or demo mode."""
    if not authorization:
        # Default anonymous/demo actor
        return ActorContext(
            uid="anonymous",
            household_id=x_household_id or "default",
            role="caretaker" if x_role != "parent" else "parent",
            is_demo=True,
        )

    parts = authorization.split(" ")
    token = parts[1] if len(parts) == 2 and parts[0].lower() == "bearer" else authorization

    # Demo bypass
    if token.lower() in ("demo", "demo-token"):
        return ActorContext(
            uid="demo-user",
            household_id="demo-kamla-sharma",
            role="caretaker" if x_role != "parent" else "parent",
            name="Rahul" if x_role != "parent" else "Kamla",
            is_demo=True,
        )

    # Real Firebase Auth Verification
    if ensure_firebase_initialized():
        try:
            decoded = firebase_auth.verify_id_token(token)
            uid = decoded.get("uid", "")
            email = decoded.get("email", "")
            role_val: Role = "parent" if x_role == "parent" else "caretaker"
            household = x_household_id or f"household-{uid[:8]}"
            return ActorContext(
                uid=uid,
                household_id=household,
                role=role_val,
                email=email,
                name=decoded.get("name", ""),
                is_demo=False,
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
        household_id=x_household_id or f"household-{token[:8]}",
        role="caretaker" if x_role != "parent" else "parent",
        is_demo=False,
    )
