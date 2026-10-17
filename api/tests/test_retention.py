"""Retention, the demo visitor limit, and the inactivity simulation."""

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from saathi.main import app
from saathi.providers.firestore import get_repository
from saathi.retention import purge_household

client = TestClient(app)


def test_transcripts_after_7_days_and_observations_after_30() -> None:
    repo = get_repository()
    now = datetime(2026, 10, 20, tzinfo=timezone.utc)
    base = "households/hh-retain"
    old, fresh = (now - timedelta(days=8)).isoformat(), (now - timedelta(days=2)).isoformat()
    repo.doc_set(f"{base}/sessions/s-old", {"utterances": [{"speaker": "parent", "text": "Namaste"}], "completed_at": old, "response_gap_ms": 900})
    repo.doc_set(f"{base}/sessions/s-new", {"utterances": [{"speaker": "parent", "text": "Haan"}], "completed_at": fresh})
    repo.doc_set(f"{base}/observations/o-old", {"summary": "old", "created_at": (now - timedelta(days=31)).isoformat()})
    repo.doc_set(f"{base}/observations/o-new", {"summary": "new", "created_at": old})
    repo.doc_set(f"{base}/dailyMetrics/2026-09-01", {"local_date": "2026-09-01"})
    repo.doc_set(f"{base}/dailyMetrics/2026-10-15", {"local_date": "2026-10-15"})

    counts = purge_household("hh-retain", now)

    assert counts == {"transcripts": 1, "observations": 1, "daily_metrics": 1}
    kept = repo.doc_get(f"{base}/sessions/s-old")
    assert kept["utterances"] == [] and kept["response_gap_ms"] == 900
    assert repo.doc_get(f"{base}/sessions/s-new")["utterances"]
    assert repo.doc_get(f"{base}/observations/o-old") is None
    assert repo.doc_get(f"{base}/observations/o-new")
    assert repo.doc_get(f"{base}/dailyMetrics/2026-09-01") is None


def test_demo_visitor_gets_three_voice_sessions(monkeypatch) -> None:
    from saathi.live.routes import _demo_gate

    monkeypatch.setenv("DEMO_SESSIONS_PER_VISITOR", "3")
    gate = _demo_gate("demo-kamla-sharma", "203.0.113.7")
    assert [gate() for _ in range(3)] == [None, None, None]
    assert "three voice sessions" in (gate() or "")
    assert _demo_gate("demo-kamla-sharma", "203.0.113.8")() is None
    monkeypatch.setenv("DEMO_SESSIONS_PER_VISITOR", "0")
    assert gate() is None


def test_simulated_inactivity_creates_an_invitation_for_the_demo_only() -> None:
    res = client.post("/api/v1/demo/simulate-inactivity", json={})
    assert res.status_code == 200
    assert res.json()["label"].startswith("Simulated.")
    inv = get_repository().doc_get(f"households/demo-kamla-sharma/invitations/{res.json()['invitation']}")
    assert inv["reason"] == "inactivity" and inv["status"] == "scheduled"
    assert client.post("/api/v1/demo/simulate-inactivity", json={"household": "hh-real"}).status_code == 400
