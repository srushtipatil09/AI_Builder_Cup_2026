"""Post-call pipeline, drift fixtures, alerts, Ask Saathi, access, and the task hand-off."""

import pytest
from fastapi.testclient import TestClient

from saathi import pipeline
from saathi.analytics.drift import evaluate_drift_rule
from saathi.asks import service as asks
from saathi.auth.firebase import has_household_access
from saathi.contracts.desk import Desk
from saathi.contracts.identity import ActorContext
from saathi.demo.seed import scenario_records
from saathi.insights.safety import validate_caregiver_text
from saathi.live.distress import check_distress_keywords, has_explicit_help
from saathi.memory.extract import ExtractionResult, FamilyEpisode, MealObservation
from saathi.notify import raise_alert
from saathi.providers.firestore import get_repository
from saathi.taskqueue import build_task, task_name


def test_drift_fixtures_disagree_as_expected() -> None:
    assert evaluate_drift_rule(scenario_records("stable")).is_candidate is False
    changing = evaluate_drift_rule(scenario_records("changing"))
    assert changing.is_candidate and changing.metric_name == "response_gap_ms"
    fasting = evaluate_drift_rule(scenario_records("fasting"))
    assert fasting.is_candidate is False and fasting.meal_followup is False
    assert fasting.context_notes, "the fast or illness context is stored"


def test_drift_needs_a_week_of_baseline() -> None:
    res = evaluate_drift_rule(scenario_records("stable")[-6:])
    assert res.status == "Learning usual routine"
    assert res.is_candidate is False


def _fake_extraction(_lines):
    return ExtractionResult(
        meals=[MealObservation(meal="lunch", reported_eaten=True, description="roti", evidence_quote="roti khayi")],
        family_episodes=[FamilyEpisode(
            person_name="Rahul", relation="Son", what_was_said="phone nahi utha rahe",
            evidence_quote="phone nahi utha rahe", reported_last_contact="unknown",
        )],
        summary="Talked about lunch and Rahul.",
    )


def test_pipeline_is_idempotent_and_writes_everything(monkeypatch) -> None:
    monkeypatch.setattr(pipeline, "extract_session", _fake_extraction)
    repo = get_repository()
    hh, sid = "hh-test-pipe", "sess-1"
    repo.doc_set(f"households/{hh}/sessions/{sid}", {
        "utterances": [{"speaker": "parent", "text": "roti khayi, phone nahi utha rahe"}],
        "response_gap_ms": 640.0, "duration_seconds": 90.0, "quality_flags": [],
    })
    first = pipeline.run_post_call(hh, sid)
    assert first["status"] == "processed"
    again = pipeline.run_post_call(hh, sid)
    assert again["status"] == "already_processed"
    assert len(repo.col_list(f"households/{hh}/dailyMetrics")) == 1
    assert len(repo.col_list(f"households/{hh}/familyEpisodes")) == 1
    day = repo.col_list(f"households/{hh}/dailyMetrics")[0]
    assert day["response_gap_ms"] == 640.0 and day["meals_reported"] == 1
    assert repo.doc_get(f"households/{hh}/insights/latest")["tier"] == 1


def test_noisy_session_gap_is_not_a_confident_number(monkeypatch) -> None:
    monkeypatch.setattr(pipeline, "extract_session", _fake_extraction)
    repo = get_repository()
    hh = "hh-test-noisy"
    repo.doc_set(f"households/{hh}/sessions/s", {
        "utterances": [{"speaker": "parent", "text": "roti khayi, phone nahi utha rahe"}],
        "response_gap_ms": 300.0, "duration_seconds": 8.0, "quality_flags": ["short"],
    })
    pipeline.run_post_call(hh, "s")
    assert repo.col_list(f"households/{hh}/dailyMetrics")[0]["response_gap_ms"] is None


def test_alert_cooldown_appends_evidence() -> None:
    first = raise_alert("hh-test-alert", 2, "m", "Call", "drift:gap", ["a"])
    second = raise_alert("hh-test-alert", 2, "m", "Call", "drift:gap", ["b"])
    assert first["status"] == "alert_created" and second["status"] == "evidence_appended"
    rows = get_repository().col_list("households/hh-test-alert/alerts")
    assert len(rows) == 1 and rows[0]["evidence_ids"] == ["a", "b"]
    # A new explicit help request ignores the cooldown
    assert raise_alert("hh-test-alert", 3, "m", "Call", "live:said_help:s1")["status"] == "alert_created"


def test_safety_alarm_and_ungrounded_rules() -> None:
    assert validate_caregiver_text("An emergency happened today", tier=2).is_safe is False
    assert validate_caregiver_text("She fell this morning", tier=2).is_safe is False
    assert validate_caregiver_text("Pauses were 900 ms", has_evidence=False).is_safe is False
    assert validate_caregiver_text("Pauses were 900 ms", has_evidence=True).is_safe is True


def test_distress_words_and_negation() -> None:
    assert has_explicit_help("bachao, main gir gayi")
    assert check_distress_keywords("ouch") == (True, False)
    assert has_explicit_help("ouch") is False
    assert check_distress_keywords("main gir nahi gayi") == (False, True)
    assert has_explicit_help("I did not fall, I am fine") is False


def test_household_access_rules() -> None:
    repo = get_repository()
    anon = ActorContext(uid="anonymous", household_id="x", role="caretaker")
    assert has_household_access(anon, "demo-kamla-sharma")[0] is True
    mine = ActorContext(uid="u1", household_id="a@b.com", role="caretaker", email="a@b.com", verified=True)
    other = ActorContext(uid="u2", household_id="a@b.com", role="caretaker", email="c@d.com", verified=True)
    assert has_household_access(mine, "a@b.com")[0] is True
    assert has_household_access(other, "a@b.com")[0] is False
    # A parent device that joined with the family code
    rec = repo.create_family_code("hh-test-access")
    repo.mark_family_code_joined(rec.code, "Kamla")
    parent = ActorContext(uid="anonymous", household_id="hh-test-access", role="parent", family_code=rec.code)
    assert has_household_access(parent, "hh-test-access", allow_family_code=True)[0] is True
    assert has_household_access(parent, "hh-test-someone-else")[0] is True  # legacy mode, flag off
    from saathi.config import load_settings
    import saathi.auth.firebase as fb
    fb.load_settings = lambda: type("S", (), {"require_household_auth": True})()
    try:
        assert has_household_access(parent, "hh-test-someone-else", allow_family_code=True)[0] is False
        assert has_household_access(parent, "hh-test-access", allow_family_code=True)[0] is True
        # Off the phone routes the code opens nothing: files, pairing, desk writes.
        assert has_household_access(parent, "hh-test-access")[0] is False
    finally:
        fb.load_settings = load_settings


def test_ask_proposal_confirm_and_hash() -> None:
    hh = "hh-test-ask"
    get_repository().save_desk(hh, Desk())
    intent = asks.AskIntent(kind="add_reminder", reminder_name="BP tablet", reminder_dose_as_typed="5mg",
                            reminder_schedule="Daily", time_24h="08:30")
    prop = asks.build_proposal(hh, "BP tablet 5mg every day at 8:30", "Rahul", intent)
    assert prop.status == "awaiting_confirmation" and "8:30 AM" in prop.readback
    with pytest.raises(asks.ConfirmError):
        asks.confirm(hh, prop.id, "wrong")
    _, desk = asks.confirm(hh, prop.id, prop.hash)
    assert desk.medicines[0].dose == "5mg"
    _, desk2 = asks.confirm(hh, prop.id, prop.hash)  # repeat does not add a second reminder
    assert len(desk2.medicines) == 1


def test_ask_drops_a_dose_the_caretaker_did_not_type() -> None:
    intent = asks.AskIntent(kind="add_reminder", reminder_name="BP tablet", reminder_dose_as_typed="10mg",
                            reminder_schedule="Daily", time_24h="08:30")
    prop = asks.build_proposal("hh-test-ask2", "BP tablet every day at 8:30", "Rahul", intent)
    assert prop.payload["dose"] == ""


def test_ask_missing_time_is_a_question_not_a_guess() -> None:
    intent = asks.AskIntent(kind="add_reminder", reminder_name="Walk", reminder_schedule="Daily")
    prop = asks.build_proposal("hh-test-ask3", "remind her to walk", "Rahul", intent)
    assert prop.status == "needs_more" and "time" in prop.question.lower()


def test_ask_refuses_medical_advice() -> None:
    prop = asks.build_proposal("hh-test-ask4", "what dose should she take", "Rahul", asks.AskIntent(asks_for_medical_advice=True))
    assert prop.status == "needs_more" and "dose" in prop.question.lower()


def test_task_name_is_stable_per_session() -> None:
    assert task_name("s1") == task_name("s1") != task_name("s2")
    task = build_task("s1", "hh", "https://worker.example", "invoker@x.iam.gserviceaccount.com", "projects/p/locations/l/queues/q")
    assert task["name"].endswith(task_name("s1"))
    assert task["http_request"]["oidc_token"]["service_account_email"].startswith("invoker@")
    assert task["http_request"]["url"] == "https://worker.example/internal/process-session"


def test_worker_rejects_unauthenticated_calls_when_invoker_is_configured(monkeypatch) -> None:
    import saathi.worker as w

    class S:
        task_invoker_email = "invoker@x.iam.gserviceaccount.com"
        worker_url = "https://worker.example"

    monkeypatch.setattr(w, "load_settings", lambda: S())
    res = TestClient(w.app).post("/internal/process-session", json={"sessionId": "s", "householdId": "h"})
    assert res.status_code == 401


def test_demo_clock_unanswered_versus_device_unavailable() -> None:
    from saathi.main import app

    client = TestClient(app)
    hh = "demo-test-clock"
    get_repository().save_desk(hh, Desk())
    a = client.post("/api/v1/demo/simulate-checkin", json={"household": hh, "outcome": "unanswered"}).json()
    b = client.post("/api/v1/demo/simulate-checkin", json={"household": hh, "outcome": "device_unavailable"}).json()
    assert a["events"][0]["type"] == "unanswered" and b["events"][0]["type"] == "device_unavailable"
    alerts = {r["issue_key"].split(":")[0]: r for r in get_repository().col_list(f"households/{hh}/alerts")}
    assert alerts["unanswered"]["tier"] == 2 and "welfare check" in alerts["unanswered"]["message"]
    assert alerts["device_unavailable"]["tier"] == 1 and "different from no reply" in alerts["device_unavailable"]["message"]


def test_tick_fires_a_check_in_once_and_respects_quiet_hours() -> None:
    from saathi.scheduling.service import claim_due_invitation, in_quiet_hours, mark_invitation, run_scheduler_tick

    hh = "hh-test-tick"
    desk = Desk()
    desk.profile.checkIn = "09:00"
    get_repository().save_desk(hh, desk)
    first = [e for e in run_scheduler_tick("09:00") if e.get("household_id") == hh]
    again = [e for e in run_scheduler_tick("09:00") if e.get("household_id") == hh]
    assert first and first[0]["type"] == "check_in_due" and not again
    inv = claim_due_invitation(hh)
    assert inv and inv["attempt"] == 1
    assert claim_due_invitation(hh) is None  # leased
    assert mark_invitation(hh, inv["id"], "snoozed")["status"] == "snoozed"
    assert in_quiet_hours("14:00", "13:00-15:00") and in_quiet_hours("02:00", "22:00-06:00")
    assert not in_quiet_hours("09:00", "13:00-15:00")
