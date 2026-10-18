"""Nearby help for one household: the parent's allowed position and what is around it."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from saathi.auth.firebase import ensure_household_access, get_current_actor, is_demo_household
from saathi.contracts.desk import Desk
from saathi.contracts.identity import ActorContext
from saathi.nearby import service
from saathi.nearby.calendar import coming_up
from saathi.providers.firestore import get_repository

router = APIRouter(prefix="/api/v1/households/{household_id}", tags=["nearby"])


class LocationRequest(BaseModel):
    lat: float
    lng: float


@router.put("/location")
def put_location(household_id: str, body: LocationRequest, actor: ActorContext = Depends(get_current_actor)) -> dict:
    """The parent's phone sends its position once, after the parent allowed it. It is stored rounded."""
    ensure_household_access(actor, household_id, allow_family_code=True)
    if not service.valid_point(body.lat, body.lng):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That position is not valid.")
    if is_demo_household(household_id):
        # The demo is shared by every visitor, so one person's position is never kept there.
        return {"status": "not_saved_in_demo"}
    spot = service.save_spot(household_id, body.lat, body.lng)
    return {"status": "saved", "updatedAt": spot.updatedAt}


@router.delete("/location")
def remove_location(household_id: str, actor: ActorContext = Depends(get_current_actor)) -> dict:
    ensure_household_access(actor, household_id, allow_family_code=True)
    service.delete_spot(household_id)
    return {"status": "deleted"}


@router.get("/outing")
def get_outing(household_id: str, actor: ActorContext = Depends(get_current_actor)) -> dict:
    """The next festival, and one place the parent already looked up. No new Places search."""
    ensure_household_access(actor, household_id, allow_family_code=True)
    return coming_up(household_id, service.is_late())


@router.get("/nearby")
def get_nearby(
    household_id: str,
    kind: str = "all",
    remember: bool = False,
    actor: ActorContext = Depends(get_current_actor),
) -> dict:
    """Places near the saved position (or the desk's city), the trusted people, and the helplines.

    remember=1 is the parent's phone. That lookup is stored. The care desk reads the stored list.
    """
    ensure_household_access(actor, household_id, allow_family_code=True)
    if kind not in ("all", "people", "helplines", *service.KINDS):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown kind.")
    desk = get_repository().get_desk(household_id) or Desk()
    return service.overview(household_id, desk, kind, remember=remember)
