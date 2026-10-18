"""What is near the parent: hospitals, parks, restaurants, pharmacies, grocery stores, trusted people, and helplines.

Places come from the Google Places API (New). The API needs `places.googleapis.com` enabled on the Cloud project.
If it is not enabled, or the call fails, the answer is an empty list with `available: false`; the helplines and the
trusted people still work because they are stored data. Nothing here advises on a medical matter: a hospital is a
place and a phone number, and an emergency always points to 112 first.

The parent's position is one rounded point (about 100 m), saved only after the parent allowed it, and replaced
or deleted on request. Without a position the search uses the city on the care desk.
"""

import logging
import math
import re
import time
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel

from saathi.config import load_settings
from saathi.contracts.desk import Desk
from saathi.pipeline import LOCAL_TZ
from saathi.providers.firestore import get_repository

logger = logging.getLogger(__name__)

PLACES_URL = "https://places.googleapis.com/v1/places"
FIELD_MASK = ",".join([
    "places.displayName", "places.formattedAddress", "places.location",
    "places.nationalPhoneNumber", "places.internationalPhoneNumber", "places.currentOpeningHours.openNow",
])
# What the parent or the model may ask for, and the Places type each one searches.
KINDS: dict[str, dict] = {
    "hospital": {"types": ["hospital"], "label": "Hospitals", "query": "hospital"},
    "pharmacy": {"types": ["pharmacy"], "label": "Medical shops", "query": "pharmacy"},
    "park": {"types": ["park"], "label": "Parks", "query": "park"},
    "restaurant": {"types": ["restaurant"], "label": "Food", "query": "restaurant"},
    "grocery": {"types": ["grocery_store"], "label": "Grocery stores", "query": "grocery store"},
}
SEARCH_RADIUS_M = 5000
# Each lookup is a paid Places call. Places near a home rarely change; an hour keeps "open now" close to true.
CACHE_SECONDS = 60 * 60
# A list the parent already opened is reused for a day before another Places call.
SAVED_FRESH_SECONDS = 24 * 60 * 60
MAX_RESULTS = 5

# National numbers that do not depend on where the parent is. Elderline is a published line for older people;
# the care desk text elsewhere already tells the family to confirm it serves their state.
HELPLINES = [
    {"name": "Emergency (police, fire, ambulance)", "phone": "112", "note": "Call this first in an emergency."},
    {"name": "Ambulance", "phone": "108", "note": "Free ambulance in most states."},
    {"name": "Elderline (older people's helpline)", "phone": "14567", "note": "Advice and support for older people."},
]


class Place(BaseModel):
    name: str
    address: str = ""
    phone: str = ""
    distanceM: Optional[int] = None
    openNow: Optional[bool] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


class Spot(BaseModel):
    lat: float
    lng: float
    updatedAt: str = ""


_cache: dict[tuple, tuple[float, list[Place]]] = {}


def clean_phone(raw: str) -> str:
    """Digits and a leading plus only, so it is safe in a tel: link."""
    raw = (raw or "").strip()
    digits = re.sub(r"[^\d]", "", raw)
    if not digits:
        return ""
    return ("+" if raw.startswith("+") else "") + digits


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> int:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return int(2 * r * math.asin(math.sqrt(a)))


def valid_point(lat: float, lng: float) -> bool:
    return -90 <= lat <= 90 and -180 <= lng <= 180 and not (lat == 0 and lng == 0)


def _path(household_id: str) -> str:
    return f"households/{household_id}/place/current"


def save_spot(household_id: str, lat: float, lng: float) -> Spot:
    """One rounded point. Rounded to three decimals (about 100 m) before it is stored."""
    spot = Spot(lat=round(lat, 3), lng=round(lng, 3), updatedAt=datetime.now(timezone.utc).isoformat())
    get_repository().doc_set(_path(household_id), spot.model_dump(), merge=False)
    clear_checks(household_id)
    return spot


def get_spot(household_id: str) -> Optional[Spot]:
    row = get_repository().doc_get(_path(household_id))
    try:
        return Spot(**row) if row else None
    except Exception:
        return None


def delete_spot(household_id: str) -> None:
    get_repository().doc_delete(_path(household_id))
    clear_checks(household_id)


def _check_path(household_id: str, kind: str) -> str:
    return f"households/{household_id}/nearbyChecks/{kind}"


def save_check(household_id: str, kind: str, places: list[Place], spot: Optional[Spot], city: str) -> str:
    """The list the parent just opened. The care desk reads this instead of looking again."""
    checked_at = datetime.now(timezone.utc).isoformat()
    get_repository().doc_set(
        _check_path(household_id, kind),
        {
            "places": [p.model_dump() for p in places],
            "checkedAt": checked_at,
            "city": city,
            "locationSet": bool(spot),
        },
        merge=False,
    )
    return checked_at


def get_check(household_id: str, kind: str) -> Optional[dict]:
    row = get_repository().doc_get(_check_path(household_id, kind))
    if not row or "places" not in row:
        return None
    return row


def clear_checks(household_id: str) -> None:
    repo = get_repository()
    for kind in KINDS:
        repo.doc_delete(_check_path(household_id, kind))
    asked = repo.doc_get(_asked_path(household_id)) or {}
    if asked.get("key"):
        repo.doc_delete(_check_path(household_id, str(asked["key"])))
    repo.doc_delete(_asked_path(household_id))


def _asked_path(household_id: str) -> str:
    return f"households/{household_id}/place/asked"


def _authorized_session():
    import google.auth
    from google.auth.transport.requests import AuthorizedSession

    credentials, _project = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    return AuthorizedSession(credentials)


def _places_call(kind: str, spot: Optional[Spot], city: str) -> list[Place]:
    settings = load_settings()
    headers = {"X-Goog-FieldMask": FIELD_MASK}
    if settings.google_cloud_project:
        headers["X-Goog-User-Project"] = settings.google_cloud_project
    spec = KINDS[kind]
    if spot:
        url = f"{PLACES_URL}:searchNearby"
        body = {
            "includedTypes": spec["types"], "maxResultCount": MAX_RESULTS, "rankPreference": "DISTANCE",
            "locationRestriction": {"circle": {"center": {"latitude": spot.lat, "longitude": spot.lng}, "radius": float(SEARCH_RADIUS_M)}},
        }
    else:
        url = f"{PLACES_URL}:searchText"
        body = {"textQuery": f"{spec['query']} in {city}", "pageSize": MAX_RESULTS}
    response = _authorized_session().post(url, json=body, headers=headers, timeout=8)
    if response.status_code != 200:
        raise RuntimeError(f"Places API answered {response.status_code}: {response.text[:200]}")
    places: list[Place] = []
    for row in response.json().get("places", [])[:MAX_RESULTS]:
        loc = row.get("location") or {}
        lat, lng = loc.get("latitude"), loc.get("longitude")
        places.append(Place(
            name=(row.get("displayName") or {}).get("text", "")[:120],
            address=row.get("formattedAddress", "")[:200],
            phone=clean_phone(row.get("internationalPhoneNumber") or row.get("nationalPhoneNumber") or ""),
            distanceM=haversine_m(spot.lat, spot.lng, lat, lng) if spot and lat is not None and lng is not None else None,
            openNow=(row.get("currentOpeningHours") or {}).get("openNow"),
            lat=lat, lng=lng,
        ))
    return [p for p in places if p.name]


def find_places(kind: str, spot: Optional[Spot], city: str) -> tuple[list[Place], bool]:
    """(places, available). Not available means the lookup itself failed or there is nothing to search from."""
    if kind not in KINDS:
        return [], False
    if not spot and not city.strip():
        return [], False
    key = (kind, round(spot.lat, 2) if spot else None, round(spot.lng, 2) if spot else None, "" if spot else city.strip().lower())
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1], True
    try:
        places = _places_call(kind, spot, city)
    except Exception as exc:
        logger.warning("Nearby %s lookup failed (%s)", kind, exc)
        return [], False
    _cache[key] = (time.monotonic(), places)
    return places, True


def _checked_fresh(checked_at: str) -> bool:
    try:
        when = datetime.fromisoformat(checked_at)
    except Exception:
        return False
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - when).total_seconds() < SAVED_FRESH_SECONDS


def ask_places(household_id: str, desk: Desk, kind: str) -> tuple[list[dict], bool, str]:
    """Places for one spoken question.

    A list saved in the last day is returned as-is (`saved`), so the talk does not pay for Places again.
    Otherwise `find_places` reuses the hour cache and makes one Places call only on a miss, then stores it.
    """
    if kind not in KINDS:
        return [], False, "none"
    saved = get_check(household_id, kind)
    if saved and _checked_fresh(str(saved.get("checkedAt") or "")):
        return (saved.get("places") or [])[:2], True, "saved"
    spot = get_spot(household_id)
    places, ok = find_places(kind, spot, desk.profile.city)
    dumped = [p.model_dump() for p in places]
    if ok:
        save_check(household_id, kind, places, spot, desk.profile.city)
    return dumped[:2], ok, "places"


# A word the parent may say, and the English place search it should run.
# Known kinds stay on the typed search. Anything else is one text search.
_QUERY_TO_KIND = {
    "hospital": "hospital", "pharmacy": "pharmacy", "medical shop": "pharmacy",
    "grocery": "grocery", "grocery store": "grocery", "kirana": "grocery", "groceries": "grocery",
    "park": "park", "restaurant": "restaurant", "food": "restaurant",
}
_WORD_TO_QUERY = {
    "mandir": "temple", "masjid": "mosque", "gurudwara": "gurdwara", "gurdwara": "gurdwara",
    "girja": "church", "church": "church", "dak ghar": "post office",
    "bus stand": "bus station", "bus stop": "bus station", "railway station": "train station",
    "sabzi mandi": "vegetable market",
}


def place_query(raw: str) -> str:
    """A short place name safe to send as a search. Empty when there is nothing specific."""
    text = re.sub(r"[^a-z0-9\u0900-\u097F\s-]", "", (raw or "").lower())
    text = re.sub(r"\s+", " ", text).strip()[:40]
    return _WORD_TO_QUERY.get(text, text)


def _query_key(query: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", query).strip("-")[:40] or "place"
    return f"q-{slug}"


def _search_text(query: str, spot: Optional[Spot], city: str) -> list[Place]:
    """One Places text search for a place that is not a fixed kind. Same fields as the typed search."""
    settings = load_settings()
    headers = {"X-Goog-FieldMask": FIELD_MASK}
    if settings.google_cloud_project:
        headers["X-Goog-User-Project"] = settings.google_cloud_project
    body: dict = {"textQuery": query if spot else f"{query} in {city}", "pageSize": MAX_RESULTS}
    if spot:
        body["locationBias"] = {
            "circle": {"center": {"latitude": spot.lat, "longitude": spot.lng}, "radius": float(SEARCH_RADIUS_M)},
        }
    response = _authorized_session().post(f"{PLACES_URL}:searchText", json=body, headers=headers, timeout=8)
    if response.status_code != 200:
        raise RuntimeError(f"Places API answered {response.status_code}: {response.text[:200]}")
    places: list[Place] = []
    for row in response.json().get("places", [])[:MAX_RESULTS]:
        loc = row.get("location") or {}
        lat, lng = loc.get("latitude"), loc.get("longitude")
        places.append(Place(
            name=(row.get("displayName") or {}).get("text", "")[:120],
            address=row.get("formattedAddress", "")[:200],
            phone=clean_phone(row.get("internationalPhoneNumber") or row.get("nationalPhoneNumber") or ""),
            distanceM=haversine_m(spot.lat, spot.lng, lat, lng) if spot and lat is not None and lng is not None else None,
            openNow=(row.get("currentOpeningHours") or {}).get("openNow"),
            lat=lat, lng=lng,
        ))
    return [p for p in places if p.name]


def find_text(query: str, spot: Optional[Spot], city: str) -> tuple[list[Place], bool]:
    if not spot and not city.strip():
        return [], False
    key = ("text", query, round(spot.lat, 2) if spot else None, round(spot.lng, 2) if spot else None, "" if spot else city.strip().lower())
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1], True
    try:
        places = _search_text(query, spot, city)
    except Exception as exc:
        logger.warning("Nearby text lookup failed (%s)", exc)
        return [], False
    _cache[key] = (time.monotonic(), places)
    return places, True


def _remember_asked(household_id: str, key: str, query: str, places: list[Place], spot: Optional[Spot], city: str) -> None:
    save_check(household_id, key, places, spot, city)
    get_repository().doc_set(
        _asked_path(household_id),
        {"key": key, "query": query, "name": places[0].name if places else "", "checkedAt": datetime.now(timezone.utc).isoformat()},
        merge=False,
    )


def last_asked(household_id: str) -> Optional[dict]:
    row = get_repository().doc_get(_asked_path(household_id))
    if not row or not row.get("query"):
        return None
    return {"query": row.get("query") or "", "name": row.get("name") or "", "checkedAt": row.get("checkedAt") or ""}


def ask_any_place(household_id: str, desk: Desk, raw: str) -> tuple[list[dict], bool, str]:
    """Any specific place the parent names. A fixed kind uses the typed search. Anything else is one text search.

    A list saved in the last day is reused, so asking again does not pay for Places.
    """
    query = place_query(raw)
    if len(query) < 3 or query in {"nearby", "place", "places", "help"}:
        return [], False, "none"
    kind = _QUERY_TO_KIND.get(query)
    if kind:
        return ask_places(household_id, desk, kind)
    key = _query_key(query)
    saved = get_check(household_id, key)
    if saved and _checked_fresh(str(saved.get("checkedAt") or "")):
        return (saved.get("places") or [])[:2], True, "saved"
    spot = get_spot(household_id)
    places, ok = find_text(query, spot, desk.profile.city)
    dumped = [p.model_dump() for p in places]
    if ok:
        _remember_asked(household_id, key, query, places, spot, desk.profile.city)
    return dumped[:2], ok, "places"


def trusted_nearby(desk: Desk) -> list[dict]:
    """Trusted contacts, those who live nearby first. These are the people the family named; nothing is looked up."""
    rows = [
        {"name": c.name, "relation": c.relation, "phone": clean_phone(c.phone), "nearby": c.local}
        for c in desk.contacts
    ]
    return sorted(rows, key=lambda r: (not r["nearby"], r["name"].lower()))


def is_late(now: Optional[datetime] = None) -> bool:
    hour = (now or datetime.now(timezone.utc)).astimezone(LOCAL_TZ).hour
    return hour >= 21 or hour < 5


def overview(household_id: str, desk: Desk, kind: str = "all", remember: bool = False) -> dict:
    """What the parent's phone and the care desk show. `kind` is one of KINDS, people, helplines, or all.

    `remember` is the parent's own lookup. That list is written to Firestore. The care desk reads it back,
    so the family sees the places the parent just opened.
    """
    spot = get_spot(household_id)
    city = desk.profile.city
    out: dict = {
        "location": {"set": bool(spot), "updatedAt": spot.updatedAt if spot else "", "city": city},
        "helplines": HELPLINES,
        "people": trusted_nearby(desk),
        "places": {},
        "checked": {},
        "available": True,
    }
    wanted = list(KINDS) if kind == "all" else [kind] if kind in KINDS else []
    for k in wanted:
        saved = None if remember else get_check(household_id, k)
        if saved is not None:
            out["places"][k] = saved.get("places") or []
            out["checked"][k] = saved.get("checkedAt") or ""
            continue
        places, ok = find_places(k, spot, city)
        out["places"][k] = [p.model_dump() for p in places]
        if remember and ok:
            out["checked"][k] = save_check(household_id, k, places, spot, city)
        if not ok:
            out["available"] = False
    return out
