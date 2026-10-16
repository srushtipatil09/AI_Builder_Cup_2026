"""Ask Saathi: a caretaker's typed or spoken note becomes one proposed change, read back, saved only after confirm.

The model only fills fields. The read-back sentence is built here from those fields, the hash of the payload is
fixed when the proposal is stored, and the model's own word is never authorization. Medicine doses are kept only
when the caretaker typed them; Saathi never suggests one.
"""

import hashlib
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from google.genai import types
from pydantic import BaseModel, Field

from saathi.config import load_settings
from saathi.contracts.desk import Contact, Desk, Medicine, Memory, Person
from saathi.pipeline import local_date_of
from saathi.providers.firestore import get_repository
from saathi.providers.gemini import get_genai_client

logger = logging.getLogger(__name__)

Kind = Literal["add_memory", "add_person", "set_checkin", "set_quiet_hours", "add_reminder", "unknown"]


class AskIntent(BaseModel):
    """What the model fills in. Everything is optional; missing required fields become a question."""
    kind: Kind = "unknown"
    memory_text: str = ""
    person_name: str = ""
    person_relation: str = ""
    person_city: str = ""
    time_24h: str = ""  # HH:MM
    quiet_start_24h: str = ""
    quiet_end_24h: str = ""
    reminder_name: str = ""
    reminder_dose_as_typed: str = ""
    reminder_schedule: Literal["Once", "Daily", "none"] = "none"
    reminder_date: str = ""  # YYYY-MM-DD
    reminder_note: str = ""
    asks_for_medical_advice: bool = False


class Proposal(BaseModel):
    id: str
    status: Literal["awaiting_confirmation", "applied", "cancelled", "needs_more"] = "awaiting_confirmation"
    kind: Kind = "unknown"
    readback: str = ""
    question: str = ""
    payload: dict = Field(default_factory=dict)
    hash: str = ""
    created_at: str = ""


PROMPT = """You turn a family caretaker's note about an older parent into ONE change for the Saathi care desk.
Choose kind:
- add_memory: a fact about the parent's life to remember (likes, routines, relations). Put the sentence in memory_text, as the caretaker wrote it.
- add_person: a NEW person who matters (name, relation, city if given). A correction about who someone is (for example "Meena is her sister, not her daughter") is add_memory with the sentence as written.
- set_checkin: the daily check-in time. time_24h as HH:MM.
- set_quiet_hours: a quiet period. quiet_start_24h and quiet_end_24h as HH:MM.
- add_reminder: a reminder. reminder_name, reminder_schedule Once or Daily, time_24h, reminder_date (YYYY-MM-DD) for Once, reminder_note. Copy any dose text exactly as typed into reminder_dose_as_typed; leave it empty if none was typed. Never invent a dose.
- unknown: anything else, or a question.
Set asks_for_medical_advice true if the caretaker asks what dose to give, what medicine to take, or for a diagnosis.
Leave a field empty when the note does not say it. Do not guess times or dates. Today is {today}.

Note: {text}"""


def _hash(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def _squash(text: str) -> str:
    return "".join(ch for ch in text.lower() if ch.isalnum())


def interpret(text: str) -> AskIntent:
    """Ask Gemini Flash for the fields. If it cannot be reached, the note is kept as a memory, word for word."""
    try:
        response = get_genai_client().models.generate_content(
            model=load_settings().extract_model,
            contents=PROMPT.format(today=local_date_of(), text=text),
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=AskIntent,
                temperature=0.0,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        if response and response.text:
            return AskIntent(**json.loads(response.text))
    except Exception as exc:
        logger.warning("Ask interpretation failed (%s); keeping the note as a memory", exc)
    return AskIntent(kind="add_memory", memory_text=text.strip())


TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _norm_time(value: str) -> str:
    """"8:30" or "8:30 AM" style slips from the model become HH:MM, or stay unrecognised."""
    m = re.match(r"^\s*(\d{1,2}):(\d{2})\s*$", value or "")
    if not m:
        return value
    return f"{int(m.group(1)):02d}:{m.group(2)}"


def _clock(value: str) -> str:
    """HH:MM as 12-hour words for the read-back."""
    hour, minute = int(value[:2]), int(value[3:])
    suffix = "AM" if hour < 12 else "PM"
    return f"{hour % 12 or 12}:{minute:02d} {suffix}"


def build_proposal(household_id: str, text: str, author: str, intent: Optional[AskIntent] = None) -> Proposal:
    """Validate the fields and make the proposal, or the one question that is missing."""
    intent = intent or interpret(text)
    intent.time_24h = _norm_time(intent.time_24h)
    intent.quiet_start_24h = _norm_time(intent.quiet_start_24h)
    intent.quiet_end_24h = _norm_time(intent.quiet_end_24h)
    pid = f"ask-{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc).isoformat()

    def needs(question: str) -> Proposal:
        return Proposal(id=pid, status="needs_more", kind=intent.kind, question=question, created_at=now)

    if intent.asks_for_medical_advice:
        return Proposal(
            id=pid, status="needs_more", kind="unknown", created_at=now,
            question="I cannot suggest a medicine, a dose, or a diagnosis. Please ask the doctor. I can save a reminder using the exact words you give me.",
        )

    payload: dict
    readback: str
    if intent.kind == "add_memory" and intent.memory_text.strip():
        payload = {"text": intent.memory_text.strip(), "author": author}
        readback = f'Add this to the memories Saathi may use: "{payload["text"]}"'
    elif intent.kind == "add_person":
        if not intent.person_name.strip():
            return needs("What is the person's name?")
        payload = {"name": intent.person_name.strip(), "relation": intent.person_relation.strip(), "city": intent.person_city.strip()}
        detail = ", ".join(x for x in (payload["relation"], payload["city"]) if x)
        readback = f"Add {payload['name']}" + (f" ({detail})" if detail else "") + " to the people who matter."
    elif intent.kind == "set_checkin":
        if not TIME_RE.match(intent.time_24h):
            return needs("What time should the daily check-in be? For example 9 in the morning.")
        payload = {"time": intent.time_24h}
        readback = f"Set the daily check-in to {_clock(intent.time_24h)}."
    elif intent.kind == "set_quiet_hours":
        if not (TIME_RE.match(intent.quiet_start_24h) and TIME_RE.match(intent.quiet_end_24h)):
            return needs("Which hours should be quiet? For example 1 pm to 3 pm.")
        payload = {"start": intent.quiet_start_24h, "end": intent.quiet_end_24h}
        readback = f"Set quiet hours from {_clock(intent.quiet_start_24h)} to {_clock(intent.quiet_end_24h)}. Saathi will not start a check-in then."
    elif intent.kind == "add_reminder":
        if not intent.reminder_name.strip():
            return needs("What is the reminder for?")
        if not TIME_RE.match(intent.time_24h):
            return needs("What time should the reminder be?")
        schedule = intent.reminder_schedule if intent.reminder_schedule in ("Once", "Daily") else "Daily"
        if schedule == "Once" and not re.match(r"^\d{4}-\d{2}-\d{2}$", intent.reminder_date):
            return needs("On which date should this one-time reminder be?")
        dose = intent.reminder_dose_as_typed.strip()
        if dose and _squash(dose) not in _squash(text):
            dose = ""  # a dose the caretaker did not type is dropped
        payload = {
            "name": intent.reminder_name.strip(), "dose": dose, "schedule": schedule,
            "date": intent.reminder_date if schedule == "Once" else "", "time": intent.time_24h,
            "note": intent.reminder_note.strip(),
        }
        when = f"on {payload['date']} at {_clock(payload['time'])}" if schedule == "Once" else f"every day at {_clock(payload['time'])}"
        readback = "Remind: " + ", ".join(x for x in (payload["name"], payload["dose"], when, payload["note"]) if x) + "."
    else:
        return Proposal(
            id=pid, status="needs_more", kind="unknown", created_at=now,
            question="I could not turn that into one change. Try a fact to remember, a person, a check-in time, quiet hours, or a reminder.",
        )

    proposal = Proposal(
        id=pid, status="awaiting_confirmation", kind=intent.kind, readback=readback,
        payload=payload, hash=_hash({"kind": intent.kind, "payload": payload}), created_at=now,
    )
    get_repository().doc_set(f"households/{household_id}/proposals/{pid}", proposal.model_dump(), merge=False)
    return proposal


class ConfirmError(Exception):
    pass


def confirm(household_id: str, proposal_id: str, given_hash: str) -> tuple[Proposal, Desk]:
    """Apply a stored proposal. The hash must match what was read back; a repeat confirm changes nothing."""
    repo = get_repository()
    row = repo.doc_get(f"households/{household_id}/proposals/{proposal_id}")
    if not row:
        raise ConfirmError("That proposal was not found.")
    proposal = Proposal(**row)
    desk = repo.get_desk(household_id) or Desk()
    if proposal.status == "applied":
        return proposal, desk
    if proposal.status != "awaiting_confirmation":
        raise ConfirmError("That proposal cannot be confirmed.")
    if given_hash != proposal.hash or _hash({"kind": proposal.kind, "payload": proposal.payload}) != proposal.hash:
        raise ConfirmError("The confirmation does not match what was read back.")

    p = proposal.payload
    uid = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).isoformat()
    if proposal.kind == "add_memory":
        desk.memories.insert(0, Memory(id=f"mem-{uid}", text=p["text"], author=p.get("author", "caretaker"), addedAt=now))
    elif proposal.kind == "add_person":
        desk.people.append(Person(id=f"p-{uid}", name=p["name"], relation=p["relation"], city=p["city"]))
        if not any(c.name.lower() == p["name"].lower() for c in desk.contacts):
            desk.contacts.append(Contact(id=f"c-{uid}", name=p["name"], relation=p["relation"], phone="", local=False))
    elif proposal.kind == "set_checkin":
        desk.profile.checkIn = p["time"]
    elif proposal.kind == "set_quiet_hours":
        desk.profile.quietHours = f"{p['start']}-{p['end']}"
    elif proposal.kind == "add_reminder":
        desk.medicines.append(Medicine(
            id=f"med-{uid}", name=p["name"], dose=p["dose"], schedule=p["schedule"], date=p["date"],
            time=p["time"], note=p["note"],
        ))
    repo.save_desk(household_id, desk)
    proposal.status = "applied"
    repo.doc_set(f"households/{household_id}/proposals/{proposal.id}", {"status": "applied", "applied_at": now})
    return proposal, desk


def cancel(household_id: str, proposal_id: str) -> None:
    get_repository().doc_set(f"households/{household_id}/proposals/{proposal_id}", {"status": "cancelled"})
