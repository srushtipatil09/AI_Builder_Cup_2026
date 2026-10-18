"""The next festival, and a nearby place only when it is not late."""

from datetime import date

from saathi.nearby.calendar import coming_up, merge_occasions, next_festival
from saathi.nearby.service import Place, save_check


def test_the_next_festival_after_18_october_2026_is_karwa_chauth() -> None:
    fest = next_festival(date(2026, 10, 18))
    assert fest is not None
    assert fest[1] == "Karwa Chauth"
    assert fest[0] == "2026-10-29"


def test_a_stored_park_is_an_invitation_and_is_left_out_at_night() -> None:
    save_check("hh-outing", "park", [Place(name="Assi Ghat Park")], None, "Varanasi")
    day = coming_up("hh-outing", late=False, today=date(2026, 10, 18))
    assert "Karwa Chauth" in day["invitation"]
    assert "Assi Ghat Park" in day["invitation"]
    night = coming_up("hh-outing", late=True, today=date(2026, 10, 18))
    assert night["placeName"] == ""
    assert "Assi Ghat Park" not in night["invitation"]


def test_a_holiday_between_built_in_festivals_is_kept_and_does_not_replace_them() -> None:
    rows = merge_occasions(
        date(2026, 10, 18),
        [{"date": "2026-10-20", "name": "Dussehra"}, {"date": "2026-11-08", "name": "Diwali"}],
    )
    assert rows[0]["name"] == "Dussehra" and rows[0]["source"] == "calendar"
    assert rows[1]["name"] == "Karwa Chauth" and rows[1]["source"] == "built-in"
    diwali = next(row for row in rows if row["date"] == "2026-11-08")
    assert diwali["source"] == "built-in"
    assert "lamps" in diwali["line"]
