"""Reads and writes that repeat every few seconds are kept cheap (the free Firestore quota is small)."""

from saathi.providers.firestore import get_repository
from saathi.scheduling import service as scheduling


def test_col_query_filters_orders_and_limits() -> None:
    repo = get_repository()
    for i, status in enumerate(["open", "done", "open", "open"]):
        repo.doc_set(f"households/q1/alerts/a{i}", {"status": status, "n": i})
    open_rows = repo.col_query("households/q1/alerts", "status", "==", "open")
    assert {r["_id"] for r in open_rows} == {"a0", "a2", "a3"}
    either = repo.col_query("households/q1/alerts", "status", "in", ["done", "open"], order_by="n", descending=True, limit=2)
    assert [r["_id"] for r in either] == ["a3", "a2"]


def test_heartbeat_writes_once_in_the_throttle_window() -> None:
    repo = get_repository()
    scheduling.record_heartbeat("hb1")
    first = repo.doc_get("households/hb1/presence/parent")["last_seen"]
    scheduling.record_heartbeat("hb1")
    assert repo.doc_get("households/hb1/presence/parent")["last_seen"] == first


def test_no_invitation_is_remembered_briefly_and_a_new_one_clears_it() -> None:
    from datetime import datetime, timezone

    assert scheduling.claim_due_invitation("inv1") is None
    assert "inv1" in scheduling._none_until
    scheduling._create_invitation("inv1", "k1", "check_in", datetime.now(timezone.utc))
    assert "inv1" not in scheduling._none_until
    assert scheduling.claim_due_invitation("inv1")["id"] == "k1"


def test_cache_serves_the_older_copy_when_the_rebuild_fails(monkeypatch) -> None:
    from saathi import cache

    monkeypatch.setattr(cache, "ENABLED", True)
    monkeypatch.setattr(cache, "_store", {})
    assert cache.cached("k", 0.0, lambda: "first") == "first"

    def boom() -> str:
        raise RuntimeError("429 Quota exceeded")

    assert cache.cached("k", 0.0, boom) == "first"
    try:
        cache.cached("never-built", 10, boom)
    except RuntimeError:
        pass
    else:
        raise AssertionError("with no older copy the error must surface")


def test_quota_error_becomes_503_with_retry_after() -> None:
    from fastapi.testclient import TestClient
    from google.api_core.exceptions import ResourceExhausted

    from saathi.main import app

    def over_quota():
        raise ResourceExhausted("Quota exceeded")

    app.add_api_route("/api/v1/_quota_probe", over_quota)
    res = TestClient(app, raise_server_exceptions=False).get("/api/v1/_quota_probe")
    assert res.status_code == 503
    assert res.headers["Retry-After"] == "60"
    assert "paused" in res.json()["detail"]


def test_tick_reads_the_schedule_index_and_opens_a_desk_only_when_due() -> None:
    from datetime import datetime, timezone

    from saathi.contracts.desk import Desk

    repo = get_repository()
    desk = Desk()
    desk.profile.checkIn = "09:30"
    repo.save_desk("sched1", desk)
    assert repo.doc_get("_schedule/index")["h_sched1"]["checkIn"] == "09:30"

    reads = []
    original = repo.get_desk
    repo.get_desk = lambda hid, fresh=False: reads.append(hid) or original(hid, fresh)  # type: ignore
    try:
        scheduling._index_checked_at = 1e18  # the hourly check is not what is under test
        quiet = datetime(2026, 10, 18, 3, 1, tzinfo=timezone.utc)  # 08:31 in India
        assert scheduling.run_scheduler_tick(None, quiet) == []
        assert "sched1" not in reads
        due = datetime(2026, 10, 18, 4, 0, tzinfo=timezone.utc)  # 09:30 in India
        events = scheduling.run_scheduler_tick(None, due)
    finally:
        repo.get_desk = original  # type: ignore
    assert any(e["type"] == "check_in_due" and e["household_id"] == "sched1" for e in events)


def test_access_yes_is_remembered_and_forgotten_on_demand(monkeypatch) -> None:
    from saathi.auth import firebase as auth
    from saathi.contracts.identity import ActorContext

    repo = get_repository()
    repo.doc_set("households/acc1/access/owner", {"uid": "u1", "members": ["u1"]})
    actor = ActorContext(uid="u1", household_id="acc1", role="caretaker", verified=True, email="a@example.com")
    assert auth.has_household_access(actor, "acc1") == (True, "member")
    repo.doc_set("households/acc1/access/owner", {"uid": "other", "members": ["other"]})
    assert auth.has_household_access(actor, "acc1") == (True, "member")  # remembered for a minute
    auth.forget_access("acc1")
    assert auth.has_household_access(actor, "acc1")[0] is False
