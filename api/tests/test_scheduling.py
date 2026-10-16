"""Tests for scheduler tick, invitation lifecycle, and FCM dispatch."""

from fastapi.testclient import TestClient
from saathi.scheduling.service import evaluate_invitation_lifecycle, send_fcm_notification
from saathi.worker import app as worker_app

worker_client = TestClient(worker_app)


def test_invitation_lifecycle_states() -> None:
    # 1. Device failure is distinct from non-response
    outcome_offline = evaluate_invitation_lifecycle(
        attempt=1,
        minutes_elapsed=2.0,
        responded=False,
        device_healthy=False,
    )
    assert outcome_offline == "device_unavailable"

    # 2. Responded
    outcome_resp = evaluate_invitation_lifecycle(
        attempt=1,
        minutes_elapsed=1.0,
        responded=True,
        device_healthy=True,
    )
    assert outcome_resp == "responded"

    # 3. Snoozed
    outcome_snooze = evaluate_invitation_lifecycle(
        attempt=1,
        minutes_elapsed=1.0,
        responded=False,
        device_healthy=True,
        snoozed=True,
    )
    assert outcome_snooze == "snoozed"

    # 4. Attempt 1 silence -> retry
    outcome_retry = evaluate_invitation_lifecycle(
        attempt=1,
        minutes_elapsed=5.0,
        responded=False,
        device_healthy=True,
    )
    assert outcome_retry == "awaiting_retry"

    # 5. Attempt 2 silence after 15 min -> unanswered (Level 2 welfare check)
    outcome_unanswered = evaluate_invitation_lifecycle(
        attempt=2,
        minutes_elapsed=15.5,
        responded=False,
        device_healthy=True,
    )
    assert outcome_unanswered == "unanswered"


def test_send_fcm_notification_mock() -> None:
    sent = send_fcm_notification("mock-token", "Saathi wants to talk", "Check-in invitation")
    assert sent is True


def test_worker_scheduler_tick() -> None:
    res = worker_client.post("/internal/tick", json={"current_time_hhmm": "08:30"})
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "tick_processed"
    assert "dueEvents" in body
