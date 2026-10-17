"""What a reminder push says, and when the desk may call it confirmed.

The lock screen uses the line the family wrote for Saathi to say. It never includes a dose.
"Confirmed" is only after the parent says they are doing it. A delivered push is "notification seen".
"""

import re
from datetime import datetime
from typing import Optional
from urllib.parse import quote

from saathi.contracts.desk import Desk, Medicine
from saathi.live.distress import _has
from saathi.pipeline import LOCAL_TZ
from saathi.providers.firestore import get_repository

# Clear agreement. A bare "ji" is not enough; people say that to almost anything.
AGREE = [
    "haan", "han", "yes", "yeah", "theek", "thik", "bilkul", "okay", "ok",
    "kar lunga", "kar lungi", "kr lunga", "kr lungi", "karunga", "karungi",
    "ja raha", "ja rha", "ja rahi", "ja rhi", "kar raha", "kar rahi",
    "kar deta", "kar deti", "kar leta", "kar leti", "kar diya", "kar di",
    "ho gaya", "ho gya", "le liya", "le li", "chali", "chala",
    "going", "i will", "i'll", "done", "let me",
]
REFUSE = [
    "nahi", "nahin", "mat", "no", "baad mein", "baad me", "later",
    "abhi nahi", "yaad nahi", "not now", "don't", "dont",
]


def agrees(text: str) -> bool:
    lowered = text.lower()
    if _has(lowered, REFUSE):
        return False
    return _has(lowered, AGREE)


def reminder_copy(med: Medicine) -> tuple[str, str, str]:
    """Title, lock-screen body, and the line to speak. A dose is never included."""
    name = (med.name or "Reminder").strip() or "Reminder"
    note = (med.note or "").strip()
    if (med.kind or "medicine") == "medicine":
        title = "Reminder"
        spoken = note or "It is time for a reminder"
    else:
        title = name[:40]
        spoken = note or f"It is time for {name}"
    return title, spoken[:140], spoken[:160]


def speak_path(path: str, phrase: str) -> str:
    if not phrase:
        return path
    return f"{path}?say={quote(phrase[:160])}"


def _local_now() -> tuple[str, str]:
    local = datetime.now(LOCAL_TZ)
    return local.strftime("%Y-%m-%d"), local.strftime("%H:%M")


def mark_reminder_seen(household_id: str, medicine_id: str, today: Optional[str] = None) -> None:
    """A phone accepted the push. That is not the parent saying they will do it."""
    repo = get_repository()
    desk = repo.get_desk(household_id, fresh=True)
    if not desk:
        return
    day = today or _local_now()[0]
    changed = False
    for med in desk.medicines:
        if med.id == medicine_id and med.seenOn != day:
            med.seenOn = day
            changed = True
    if changed:
        repo.save_desk(household_id, desk)


def confirm_from_parent(household_id: str, text: str) -> Optional[str]:
    """If the parent agrees, confirm the due reminder they named, or the latest one still open."""
    if not text or not agrees(text):
        return None
    repo = get_repository()
    desk = repo.get_desk(household_id, fresh=True)
    if not desk:
        return None
    today, hhmm = _local_now()
    due = [
        med for med in desk.medicines
        if med.time and med.time <= hhmm and med.confirmedOn != today
        and (med.schedule == "Daily" or med.date == today)
    ]
    if not due:
        return None
    lowered = text.lower()
    named = [med for med in due if med.name and re.search(re.escape(med.name.lower()), lowered)]
    med = named[0] if named else max(due, key=lambda item: item.time)
    med.confirmedOn = today
    med.confirmedBy = desk.profile.preferredName or "Mumma"
    if med.seenOn != today:
        med.seenOn = today
    repo.save_desk(household_id, desk)
    return med.id


def keep_reminder_status(incoming: Desk, stored: Optional[Desk]) -> Desk:
    """A desk saved from an open browser must not wipe a status the phone just recorded."""
    if not stored:
        return incoming
    previous = {med.id: med for med in stored.medicines}
    for med in incoming.medicines:
        old = previous.get(med.id)
        if not old:
            continue
        if not med.seenOn and old.seenOn:
            med.seenOn = old.seenOn
        if not med.confirmedOn and old.confirmedOn:
            med.confirmedOn = old.confirmedOn
            med.confirmedBy = old.confirmedBy
    return incoming
