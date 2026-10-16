"""Tests for household and Care Desk API routes."""

from fastapi.testclient import TestClient
from saathi.main import app

client = TestClient(app)


def test_get_demo_desk() -> None:
    res = client.get("/api/v1/demo/desk")
    assert res.status_code == 200
    body = res.json()
    assert body["profile"]["preferredName"] == "Kamla"
    assert body["profile"]["language"] == "Hindi"
    assert any(p["name"] == "Rahul" for p in body["people"])
    assert any(m["name"] == "BP tablet" for m in body["medicines"])


def test_household_crud_and_pairing_flow() -> None:
    # 1. Create household
    create_res = client.post(
        "/api/v1/households",
        json={"caretaker_name": "Rahul", "parent_name": "Kamla", "language": "Hindi"},
    )
    assert create_res.status_code == 200
    household = create_res.json()
    hh_id = household["id"]
    assert hh_id.startswith("hh-")
    assert household["parent_name"] == "Kamla"

    # 2. Get initial desk
    desk_res = client.get(f"/api/v1/households/{hh_id}/desk")
    assert desk_res.status_code == 200
    desk = desk_res.json()
    assert desk["profile"]["preferredName"] == "Kamla"

    # 3. Update desk (add a memory and a medicine)
    desk["memories"].append({
        "id": "mem-1",
        "text": "Likes the temple garden.",
        "author": "Rahul",
        "addedAt": "2026-10-15T10:00:00Z",
    })
    desk["medicines"].append({
        "id": "med-1",
        "name": "Vitamin D",
        "dose": "60k",
        "schedule": "Once",
        "date": "2026-10-20",
        "time": "09:00",
        "note": "with milk",
    })
    update_res = client.put(f"/api/v1/households/{hh_id}/desk", json=desk)
    assert update_res.status_code == 200
    updated_desk = update_res.json()
    assert len(updated_desk["memories"]) == 1
    assert updated_desk["memories"][0]["text"] == "Likes the temple garden."

    # 4. Generate family code
    pairing_res = client.post(
        f"/api/v1/households/{hh_id}/pairing",
        params={"caretaker_name": "Rahul", "parent_name": "Kamla"},
    )
    assert pairing_res.status_code == 200
    link = pairing_res.json()
    code = link["code"]
    assert len(code) == 7
    assert "-" in code

    # 5. Look up family code
    lookup_res = client.get(f"/api/v1/pair/{code}")
    assert lookup_res.status_code == 200
    assert lookup_res.json()["household_id"] == hh_id

    # 6. Parent pairs with the family code
    join_res = client.post("/api/v1/pair", json={"code": code, "parent_name": "Kamla"})
    assert join_res.status_code == 200
    assert join_res.json()["joined_name"] == "Kamla"
    assert join_res.json()["joined_at"] is not None
