"""Nearby help: the saved position, the lookup, and the voice tools."""

from datetime import datetime, timezone

from fastapi.testclient import TestClient

from saathi.contracts.desk import Contact, Desk, Profile
from saathi.main import app
from saathi.nearby import service
from saathi.providers.firestore import get_repository

client = TestClient(app)
HH = "hh-nearby-test"


def _fake_places(kind, spot, city):
    return [service.Place(name=f"Test {kind}", phone="+91 98765 43210", distanceM=400, lat=25.3, lng=83.0)]


def _desk() -> Desk:
    return Desk(
        profile=Profile(preferredName="Kamla", city="Varanasi"),
        contacts=[
            Contact(id="a", name="Rahul", relation="Son", phone="+91 99999 11111", local=False),
            Contact(id="b", name="Meena", relation="Neighbour", phone="98765 00000", local=True),
        ],
    )


def test_position_is_rounded_and_validated(monkeypatch) -> None:
    monkeypatch.setattr(service, "_places_call", _fake_places)
    res = client.put(f"/api/v1/households/{HH}/location", json={"lat": 25.31234, "lng": 83.00678})
    assert res.status_code == 200
    spot = service.get_spot(HH)
    assert (spot.lat, spot.lng) == (25.312, 83.007)
    assert client.put(f"/api/v1/households/{HH}/location", json={"lat": 0, "lng": 0}).status_code == 400
    assert client.put(f"/api/v1/households/{HH}/location", json={"lat": 120, "lng": 10}).status_code == 400
    assert client.delete(f"/api/v1/households/{HH}/location").status_code == 200
    assert service.get_spot(HH) is None


def test_overview_lists_places_people_and_helplines(monkeypatch) -> None:
    monkeypatch.setattr(service, "_places_call", _fake_places)
    service._cache.clear()
    get_repository().save_desk(HH, _desk())
    res = client.get(f"/api/v1/households/{HH}/nearby?kind=all")
    body = res.json()
    assert res.status_code == 200
    assert set(body["places"]) == {"hospital", "pharmacy", "grocery", "park", "restaurant"}
    assert body["people"][0]["name"] == "Meena" and body["people"][0]["nearby"] is True
    assert body["people"][0]["phone"] == "9876500000"
    assert {h["phone"] for h in body["helplines"]} >= {"112", "108"}


def test_lookup_failure_still_returns_helplines(monkeypatch) -> None:
    def boom(*_a):
        raise RuntimeError("Places API is not enabled")

    monkeypatch.setattr(service, "_places_call", boom)
    service._cache.clear()
    body = client.get(f"/api/v1/households/{HH}/nearby?kind=hospital").json()
    assert body["available"] is False and body["places"]["hospital"] == []
    assert body["helplines"]


def test_parent_grocery_lookup_is_what_the_caretaker_sees(monkeypatch) -> None:
    household = "hh-nearby-grocery"
    calls = []

    def fake(kind, _spot, _city):
        calls.append(kind)
        return [service.Place(name=f"Shop {kind}", phone="9876500000")]

    monkeypatch.setattr(service, "_places_call", fake)
    service._cache.clear()
    get_repository().save_desk(household, _desk())
    parent = client.get(f"/api/v1/households/{household}/nearby?kind=grocery&remember=true")
    assert parent.status_code == 200
    assert parent.json()["places"]["grocery"][0]["name"] == "Shop grocery"
    assert parent.json()["checked"]["grocery"]

    def boom(*_args):
        raise RuntimeError("the caretaker should read the stored list")

    monkeypatch.setattr(service, "_places_call", boom)
    service._cache.clear()
    desk = client.get(f"/api/v1/households/{household}/nearby?kind=grocery").json()
    assert desk["places"]["grocery"][0]["name"] == "Shop grocery"
    assert desk["checked"]["grocery"]
    assert calls == ["grocery"]


def test_phone_is_safe_for_a_tel_link() -> None:
    assert service.clean_phone("+91 (98765) 43-210; rm") == "+919876543210"
    assert service.clean_phone("javascript:alert(1)") == "1"


def _bridge():
    from saathi.live.bridge import LiveBridgeSession

    get_repository().save_desk(HH, _desk())
    return LiveBridgeSession(websocket=None, session_id="s", household_id=HH, desk=_desk())


def test_voice_tools_find_and_offer_a_call(monkeypatch) -> None:
    monkeypatch.setattr(service, "_places_call", _fake_places)
    monkeypatch.setattr(service, "is_late", lambda now=None: False)
    service._cache.clear()
    bridge = _bridge()
    found = bridge._run_tool("find_nearby", {"kind": "hospital"})
    assert found["status"] == "found" and found["_ui"]["type"] == "nearby"
    assert "112" in found["note"]
    offer = bridge._run_tool("offer_call", {"who": "Test hospital"})
    assert offer["_ui"] == {"type": "call_offer", "name": "Test hospital", "phone": "+919876543210"}
    assert bridge._run_tool("offer_call", {"who": "Meena"})["_ui"]["phone"] == "9876500000"
    assert bridge._run_tool("offer_call", {"who": "112"})["_ui"]["phone"] == "112"
    assert bridge._run_tool("offer_call", {"who": "a stranger"})["status"] == "no_number"


def test_no_park_suggestion_late_at_night(monkeypatch) -> None:
    monkeypatch.setattr(service, "is_late", lambda now=None: True)
    result = _bridge()._run_tool("find_nearby", {"kind": "park"})
    assert result["status"] == "not_now"
    assert "_ui" not in result
    # A hospital is still answered at night.
    monkeypatch.setattr(service, "_places_call", _fake_places)
    service._cache.clear()
    assert _bridge()._run_tool("find_nearby", {"kind": "hospital"})["status"] == "found"
    assert datetime.now(timezone.utc)
