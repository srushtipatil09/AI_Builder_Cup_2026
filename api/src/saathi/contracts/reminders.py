"""Reminder and occurrence contracts."""

from typing import Literal, Optional
from pydantic import BaseModel, Field


class ReminderProposal(BaseModel):
    action: Literal["create", "update", "pause", "resume", "delete"] = "create"
    name: str
    dose: str = ""
    schedule: Literal["Once", "Daily"] = "Daily"
    date: Optional[str] = ""
    time: str = ""
    note: str = ""


class ReminderOccurrence(BaseModel):
    id: str
    reminder_id: str
    household_id: str
    scheduled_time: str
    status: Literal[
        "pending",
        "reported_done",
        "reported_not_done",
        "uncertain",
        "snoozed",
        "unanswered",
        "device_unavailable"
    ] = "pending"
    evidence_quote: str = ""
    updated_at: str = ""
