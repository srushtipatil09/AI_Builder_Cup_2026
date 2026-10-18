"""The next public festival, and one nearby place the family already looked up.

Dates are the civil calendar. The line is an invitation, not a plan the parent must follow,
and not medical advice. After 9 pm the place is left off.
"""

from datetime import date, datetime
from typing import Optional

from saathi.pipeline import LOCAL_TZ

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
