"""Tests for scheduler tick, invitation lifecycle, and FCM dispatch."""

from fastapi.testclient import TestClient
from saathi.scheduling.service import evaluate_invitation_lifecycle, notification_link, send_fcm_notification
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


def test_reminder_copy_speaks_the_family_line_and_hides_a_dose() -> None:
    from saathi.contracts.desk import Medicine
    from saathi.scheduling.notice import agrees, reminder_copy

    title, body, speak = reminder_copy(Medicine(
        id="1", kind="exercise", name="Yoga", dose="10 Mins", time="05:49", note="Yoga ka time ho gya",
    ))
    assert title == "Yoga" and body == speak == "Yoga ka time ho gya" and "10" not in body
    pill_title, pill_body, _ = reminder_copy(Medicine(
        id="2", kind="medicine", name="BP tablet", dose="5mg", time="08:30", note="after breakfast",
    ))
    assert pill_title == "Reminder" and pill_body == "after breakfast" and "5mg" not in pill_body
    assert agrees("haan ja raha hoon, kar lunga")
    assert not agrees("nahi, baad mein")
    assert not agrees("ji")


def test_notification_link_is_https() -> None:
    assert notification_link("/care").startswith("https://")
    assert notification_link("/care").endswith("/care")


def test_worker_scheduler_tick() -> None:
    res = worker_client.post("/internal/tick", json={"current_time_hhmm": "08:30"})
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "tick_processed"
    assert "dueEvents" in body
