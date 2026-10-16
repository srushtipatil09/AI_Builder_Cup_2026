"""Tests for demo logical clock advance and isolation."""

from fastapi.testclient import TestClient
from saathi.main import app

client = TestClient(app)


def test_demo_status() -> None:
    res = client.get("/api/v1/demo/status")
    assert res.status_code == 200
    body = res.json()
    assert body["isDemo"] is True
    assert body["household"] == "demo-kamla-sharma"
    assert "simulatedTime" in body


def test_advance_demo_clock() -> None:
    res = client.post("/api/v1/demo/advance", json={"seconds": 1800}) # +30 mins
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "clock_advanced"
    assert body["addedSeconds"] == 1800

    # Reset
    reset_res = client.post("/api/v1/demo/reset")
    assert reset_res.status_code == 200
    assert reset_res.json()["status"] == "reset"
