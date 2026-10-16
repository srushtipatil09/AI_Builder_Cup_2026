"""Voice reminder confirmation and medicine reporting logic."""

import logging
import uuid
from typing import Optional

from saathi.contracts.desk import Medicine
from saathi.contracts.reminders import ReminderProposal
from saathi.providers.firestore import get_repository

logger = logging.getLogger(__name__)


def prepare_reminder_readback(proposal: ReminderProposal) -> tuple[bool, str]:
    """Generates canonical spoken readback or clarifying question.

    Returns (is_complete, spoken_text).
    """
    if not proposal.name:
        return False, "Kripya dawai ya task ka naam batayein."
    if not proposal.time:
        return False, "Kis samay par yaad dilana hai? Jaise subah aath baje."
    if proposal.schedule == "Once" and not proposal.date:
        return False, "Kis tareekh ko yaad dilana hai? Jaise kal ya 20 October ko."

    when_desc = f"har din {proposal.time} baje" if proposal.schedule == "Daily" else f"{proposal.date} ko {proposal.time} baje"
    dose_part = f" ({proposal.dose})" if proposal.dose else ""
    note_part = f", {proposal.note}" if proposal.note else ""

    readback = f"Aapne kaha {when_desc} {proposal.name}{dose_part}{note_part}. Kya main ise save kar doon?"
    return True, readback


def confirm_and_save_reminder(household_id: str, proposal: ReminderProposal) -> Medicine:
    """Commits confirmed reminder to household Desk in Firestore."""
    repo = get_repository()
    desk = repo.get_desk(household_id)
    if not desk:
        from saathi.contracts.desk import Desk
        desk = Desk()

    med = Medicine(
        id=f"med-{uuid.uuid4().hex[:8]}",
        name=proposal.name,
        dose=proposal.dose,
        schedule=proposal.schedule,
        date=proposal.date,
        time=proposal.time,
        note=proposal.note,
    )
    desk.medicines.append(med)
    repo.save_desk(household_id, desk)
    return med


def evaluate_medicine_report(medicine_name: str, parent_statement: str) -> dict:
    """Processes parent spoken reply about scheduled medicine."""
    lowered = parent_statement.lower()

    if any(w in lowered for w in ["haan", "le li", "kha li", "taken", "yes"]):
        return {
            "status": "reported_done",
            "medicine": medicine_name,
            "spoken_feedback": f"Achha laga sunkar ki aapne {medicine_name} le li.",
            "escalation_needed": False,
        }

    if any(w in lowered for w in ["yaad nahi", "bhool gayi", "pata nahi", "not sure", "don't remember"]):
        return {
            "status": "uncertain",
            "medicine": medicine_name,
            "spoken_feedback": f"Koi baat nahi. Main Rahul ko inform karta hoon taaki woh confirm kar lein. Kripya bina confirm kiye doosri dawai mat lijiye.",
            "escalation_needed": True,
            "escalation_tier": 2,
            "escalation_note": f"Parent was uncertain about whether {medicine_name} was taken. Do not advise extra dose.",
        }

    return {
        "status": "reported_not_done",
        "medicine": medicine_name,
        "spoken_feedback": f"Theek hai, thodi der baad yaad dila doon?",
        "escalation_needed": False,
    }
