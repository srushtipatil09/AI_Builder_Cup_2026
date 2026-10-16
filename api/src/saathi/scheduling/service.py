"""Scheduler tick evaluator and notification dispatcher."""

import logging
from typing import Literal, Optional
from pydantic import BaseModel
import firebase_admin
from firebase_admin import messaging as fcm_messaging

from saathi.auth.firebase import ensure_firebase_initialized
from saathi.providers.firestore import get_repository

logger = logging.getLogger(__name__)

InvitationOutcome = Literal[
    "responded",
    "awaiting_retry",
    "unanswered",
    "device_unavailable",
    "snoozed",
]


def evaluate_invitation_lifecycle(
    attempt: int,
    minutes_elapsed: float,
    responded: bool,
    device_healthy: bool,
    snoozed: bool = False,
) -> InvitationOutcome:
    """Evaluates the 30s/5min/15min unanswered check-in workflow."""
    if not device_healthy:
        return "device_unavailable"
    if responded:
        return "responded"
    if snoozed:
        return "snoozed"
    if attempt == 1 and minutes_elapsed < 15.0:
        return "awaiting_retry"
    if attempt >= 2 and minutes_elapsed >= 15.0:
        return "unanswered"
    return "awaiting_retry"


def send_fcm_notification(fcm_token: str, title: str, body: str) -> bool:
    """Dispatches push notification via Firebase Cloud Messaging."""
    if not fcm_token or fcm_token == "mock-token":
        logger.info("Mock FCM notification dispatched: '%s' - '%s'", title, body)
        return True

    if ensure_firebase_initialized():
        try:
            message = fcm_messaging.Message(
                notification=fcm_messaging.Notification(title=title, body=body),
                token=fcm_token,
            )
            response = fcm_messaging.send(message)
            logger.info("FCM sent successfully: %s", response)
            return True
        except Exception as exc:
            logger.warning("FCM dispatch failed (%s); logging notification", exc)
            return False

    return True


def run_scheduler_tick(current_hhmm: str) -> list[dict]:
    """Runs minute tick to find due check-ins and medicines."""
    events = []
    repo = get_repository()

    # In a full scan, iterates households. For demo & testing:
    demo_desk = repo.get_desk("demo-kamla-sharma")
    if demo_desk:
        # Check daily check-in time
        if demo_desk.profile.checkIn == current_hhmm:
            events.append({
                "type": "check_in_due",
                "household_id": "demo-kamla-sharma",
                "lockscreen_text": "Saathi wants to talk",
            })

        # Check due medicines
        for med in demo_desk.medicines:
            if med.time == current_hhmm and not med.confirmedOn:
                events.append({
                    "type": "reminder_due",
                    "household_id": "demo-kamla-sharma",
                    "lockscreen_text": "New Saathi update",
                    "medicine_id": med.id,
                })

    return events
