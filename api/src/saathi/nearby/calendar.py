"""The next public festival, and one nearby place the family already looked up.

The built-in list is free. The India holiday calendar is read at most once a day per process,
and only when someone asks. A failure keeps the built-in list. After 9 pm a place is left off.
The line is an invitation, not a plan they must follow, and not medical advice.
"""

import logging
import time
from datetime import date, datetime, timedelta
from typing import Optional
from urllib.parse import quote

from saathi.pipeline import LOCAL_TZ

logger = logging.getLogger(__name__)

# Public holiday calendar. One events.list, field-masked, cached 24 hours.
HOLIDAY_CALENDAR = "en.indian#holiday@group.v.calendar.google.com"
_HOLIDAY_OK_SECONDS = 24 * 60 * 60
_HOLIDAY_MISS_SECONDS = 10 * 60
_holiday_cache: tuple[float, list[dict]] = (0.0, [])

# Kept short on purpose. A date is included only when it is a fixed public day.
FESTIVALS: tuple[tuple[str, str, str], ...] = (
    ("2026-10-29", "Karwa Chauth", "A day many families keep a fast and share a late meal."),
    ("2026-11-08", "Diwali", "A day many families light lamps and share sweets."),
    ("2026-11-11", "Bhai Dooj", "A day many families visit each other."),
    ("2026-11-15", "Chhath", "A day many families meet by the water."),
    ("2026-12-25", "Christmas", "A day many families share a meal."),
    ("2027-01-01", "New Year", "A day many families start the year together."),
    ("2027-01-14", "Makar Sankranti", "A day many families share sweets in the sun."),
    ("2027-01-26", "Republic Day", "A public holiday."),
)

_PLACE = {
    "park": "A park nearby",
    "restaurant": "A place to eat nearby",
    "grocery": "A grocery store nearby",
}


def local_today(now: Optional[datetime] = None) -> date:
    moment = now or datetime.now(LOCAL_TZ)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=LOCAL_TZ)
    return moment.astimezone(LOCAL_TZ).date()


def next_festival(today: date) -> Optional[tuple[str, str, str]]:
    for row in FESTIVALS:
        if date.fromisoformat(row[0]) >= today:
            return row
    return None


def _holiday_call(today: date) -> list[dict]:
    """One Calendar API read of the next 60 days. The caller caches it."""
    import google.auth
    from google.auth.transport.requests import AuthorizedSession

    credentials, _project = google.auth.default(scopes=["https://www.googleapis.com/auth/calendar.readonly"])
    session = AuthorizedSession(credentials)
    end = today + timedelta(days=60)
    url = "https://www.googleapis.com/calendar/v3/calendars/" + quote(HOLIDAY_CALENDAR, safe="") + "/events"
    response = session.get(
        url,
        params={
            "timeMin": f"{today.isoformat()}T00:00:00+05:30",
            "timeMax": f"{end.isoformat()}T00:00:00+05:30",
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": "8",
            "fields": "items(summary,start/date)",
        },
        timeout=3,
    )
    if response.status_code != 200:
        raise RuntimeError(f"Calendar API answered {response.status_code}")
    rows = []
    for item in response.json().get("items") or []:
        day = (item.get("start") or {}).get("date") or ""
        name = (item.get("summary") or "").strip()
        if day and name:
            rows.append({"date": day[:10], "name": name[:80]})
    return rows


def holiday_events(today: date) -> list[dict]:
    """Cached holiday rows. An error is remembered for ten minutes so a talk does not retry."""
    global _holiday_cache
    fetched_at, rows = _holiday_cache
    age = time.monotonic() - fetched_at
    if fetched_at and age < (_HOLIDAY_OK_SECONDS if rows else _HOLIDAY_MISS_SECONDS):
        return rows
    try:
        rows = _holiday_call(today)
    except Exception as exc:
        logger.warning("Calendar API unavailable (%s); the built-in festival list is used", exc)
        rows = []
    _holiday_cache = (time.monotonic(), rows)
    return rows


def merge_occasions(today: date, remote: list[dict]) -> list[dict]:
    """Built-in festivals plus holiday-calendar days, nearest first. A built-in line wins on the same date."""
    rows: dict[str, dict] = {}
    for day, name, line in FESTIVALS:
        if date.fromisoformat(day) >= today:
            rows[day] = {"date": day, "name": name, "line": line, "source": "built-in"}
    for item in remote:
        day = str(item.get("date") or "")[:10]
        name = str(item.get("name") or "").strip()
        if not day or not name:
            continue
        try:
            if date.fromisoformat(day) < today:
                continue
        except ValueError:
            continue
        if day not in rows:
            rows[day] = {"date": day, "name": name, "line": "A public holiday.", "source": "calendar"}
    return [rows[key] for key in sorted(rows)][:4]


def occasions(today: Optional[date] = None, remote: Optional[list[dict]] = None) -> list[dict]:
    """What to say when the parent asks what is coming up. Pass `remote` to skip the Calendar API."""
    today = today or local_today()
    holidays = remote if remote is not None else holiday_events(today)
    return merge_occasions(today, holidays)


def _spoken(day: date) -> str:
    return f"{day.day} {day.strftime('%B')}"


def coming_up(household_id: str, late: bool, today: Optional[date] = None) -> dict:
    """The next festival, plus one stored park, restaurant, or grocery when it is not late."""
    today = today or local_today()
    fest = next_festival(today)
    if not fest:
        return {"name": "", "date": "", "line": "", "placeName": "", "placeKind": "", "late": late, "invitation": ""}
    when = _spoken(date.fromisoformat(fest[0]))
    place_name = ""
    place_kind = ""
    if not late:
        from saathi.nearby.service import get_check

        for kind in ("park", "restaurant", "grocery"):
            saved = get_check(household_id, kind)
            places = (saved or {}).get("places") or []
            name = (places[0] or {}).get("name") if places else ""
            if name:
                place_name = name
                place_kind = kind
                break
    if place_name:
        invitation = (
            f"{fest[1]} is on {when}. {fest[2]} {_PLACE[place_kind]} is {place_name}. "
            "This is one invitation, not a plan they must follow."
        )
    else:
        invitation = f"{fest[1]} is on {when}. {fest[2]}"
        if not late:
            invitation += " They can ask for a park if they would like to go out."
    return {
        "name": fest[1],
        "date": fest[0],
        "line": fest[2],
        "placeName": place_name,
        "placeKind": place_kind,
        "late": late,
        "invitation": invitation,
    }
