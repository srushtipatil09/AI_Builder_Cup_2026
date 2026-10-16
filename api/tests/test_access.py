"""A joined family code opens only what the parent's phone needs; CORS allows only known origins."""

from fastapi.testclient import TestClient

from saathi.main import app

client = TestClient(app)


def _joined_household() -> tuple[str, str]:
    hh_id = client.post("/api/v1/households", json={"caretaker_name": "Rahul", "parent_name": "Kamla"}).json()["id"]
    code = client.post(f"/api/v1/households/{hh_id}/pairing").json()["code"]
    assert client.post("/api/v1/pair", json={"code": code, "parent_name": "Kamla"}).status_code == 200
    return hh_id, code


def test_family_code_is_limited_to_phone_routes(monkeypatch) -> None:
    hh_id, code = _joined_household()
    other, _ = _joined_household()
    monkeypatch.setenv("REQUIRE_HOUSEHOLD_AUTH", "true")
    phone = {"X-Family-Code": code, "X-Household-Id": hh_id, "X-Role": "parent"}
    base = f"/api/v1/households/{hh_id}"

    desk = client.get(f"{base}/desk", headers=phone)
    assert desk.status_code == 200
    assert client.post(f"{base}/heartbeat", headers=phone).status_code == 200
    assert client.get(f"{base}/invitation", headers=phone).status_code == 200

    assert client.put(f"{base}/desk", headers=phone, json=desk.json()).status_code == 401
    assert client.get(f"{base}/files", headers=phone).status_code == 401
    assert client.get(f"{base}/files/any-id/link", headers=phone).status_code == 401
    assert client.get(f"{base}/pairing", headers=phone).status_code == 401
    assert client.get(f"{base}/updates", headers=phone).status_code == 401
    assert client.post(
        "/api/v1/sessions/s1/classify-impact", headers=phone, json={"description": "thud"}
    ).status_code == 401

    # A code for another household opens nothing.
    assert client.get(f"/api/v1/households/{other}/desk", headers=phone).status_code == 401


def test_cors_allows_only_known_origins() -> None:
    def allowed(origin: str) -> bool:
        res = client.options("/health", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
        return res.headers.get("access-control-allow-origin") == origin

    assert allowed("http://localhost:5173")
    assert allowed("http://localhost:4173")
    assert not allowed("https://evil.example.com")
    assert not allowed("http://evil.localhost.example.com:80")
