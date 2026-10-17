"""A caretaker can look after several family members; the list of households is the server's, not the client's."""

from fastapi.testclient import TestClient

from saathi.auth.firebase import get_current_actor
from saathi.contracts.identity import ActorContext
from saathi.main import app

client = TestClient(app)


def _as(uid: str, email: str):
    app.dependency_overrides[get_current_actor] = lambda: ActorContext(
        uid=uid, household_id=email, role="caretaker", email=email, verified=True,
    )


def test_add_and_list_family_members() -> None:
    try:
        _as("u-care-1", "rahul@example.test")
        client.put("/api/v1/me", json={"role": "caretaker", "caretakerName": "Rahul", "parentName": "Kamla"})
        added = client.post("/api/v1/me/households", json={"parentName": "Shanti", "language": "Hindi"})
        assert added.status_code == 200
        new_id = added.json()["id"]
        assert new_id.startswith("hh-")

        rows = client.get("/api/v1/me/households").json()
        assert [r["parentName"] for r in rows] == ["Kamla", "Shanti"]
        assert rows[0]["primary"] and rows[0]["id"] == "rahul@example.test"
        assert client.get("/api/v1/me").json()["activeHousehold"] == new_id

        # The owner can open the new desk; another caretaker cannot.
        assert client.get(f"/api/v1/households/{new_id}/desk").json()["profile"]["preferredName"] == "Shanti"
        _as("u-care-2", "someone@example.test")
        assert client.get(f"/api/v1/households/{new_id}/desk").status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_profile_save_cannot_add_households_or_point_elsewhere() -> None:
    try:
        _as("u-care-3", "meera@example.test")
        res = client.put("/api/v1/me", json={
            "role": "caretaker", "households": [{"id": "hh-not-mine"}], "activeHousehold": "hh-not-mine",
        })
        assert res.json()["households"] == [] and res.json()["activeHousehold"] is None
        res = client.put("/api/v1/me", json={"role": "caretaker", "activeHousehold": "meera@example.test"})
        assert res.json()["activeHousehold"] == "meera@example.test"
    finally:
        app.dependency_overrides.clear()
