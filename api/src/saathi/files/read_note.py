"""One Gemini Flash read of a stored prescription or report.

The call is per page. No model machine stays on. The family summary does not
add a dose, a diagnosis, or an order. A caretaker confirms before anything is saved.
"""

import json
import logging
import re
from typing import Literal

from google.genai import types
from pydantic import BaseModel, Field

from saathi.config import load_settings
from saathi.insights.safety import validate_caregiver_text
from saathi.providers.gemini import get_genai_client

logger = logging.getLogger(__name__)

READABLE_CATEGORIES = frozenset({"prescriptions", "medical_reports"})
READABLE_TYPES = frozenset({"image/jpeg", "image/png", "image/webp", "application/pdf"})

_MG = re.compile(r"\d+(?:\.\d+)?\s*(?:mg|ml|mcg|tablets?)\b", re.IGNORECASE)
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_KINDS = frozenset({"medicine", "exercise", "call", "meal", "other"})

_INSTRUCTION = (
    "Copy a doctor's note for a family. Use only words printed on the page. "
    "Do not diagnose. Do not add a medicine, a dose, or a schedule that is not printed. "
    "Do not tell anyone to start, stop, or change a medicine. "
    "plainSummary and hindiSummary are a few lines for the family and must not contain milligram amounts. "
    "If a medicine name and amount are printed, put the amount only in dose, exactly as written. "
    "If the page is not a note or cannot be read, set source to unreadable and leave routines empty."
)

_CONFIRM = "The page was read. Confirm each line before it is saved."


class PageRoutine(BaseModel):
    kind: Literal["medicine", "exercise", "call", "meal", "other"] = "other"
    name: str = ""
    dose: str = ""
    schedule: str = "Daily"
    time: str = ""
    note: str = ""


class PageRead(BaseModel):
    reportTitle: str = "Uploaded page"
    doctorName: str = ""
    plainSummary: str = ""
    hindiSummary: str = ""
    prescribedRoutines: list[PageRoutine] = Field(default_factory=list)
    clinicalObservations: list[str] = Field(default_factory=list)
    disclaimer: str = "Copied from this page. Confirm before adding it to the desk."
    source: Literal["page", "unreadable"] = "page"


def can_read_note(category: str, content_type: str) -> bool:
    return category in READABLE_CATEGORIES and content_type in READABLE_TYPES


def _family_line(text: str) -> str:
    cleaned = _MG.sub("", text or "").strip(" .,-")
    if not cleaned:
        return _CONFIRM
    checked = validate_caregiver_text(
        cleaned,
        parent_name="the parent",
        metric_fact="the uploaded page",
        fallback_action="Confirm the lines",
        tier=2,
        has_evidence=True,
    )
    if not checked.is_safe:
        return _CONFIRM
    return checked.final_text[:500]


def _keep_line(text: str) -> str | None:
    cleaned = _MG.sub("", text or "").strip(" .,-")
    if not cleaned:
        return None
    checked = validate_caregiver_text(
        cleaned,
        parent_name="the parent",
        metric_fact="the uploaded page",
        fallback_action="Confirm the lines",
        tier=2,
        has_evidence=True,
    )
    if not checked.is_safe:
        return None
    return checked.final_text[:240]


def _routine(item: PageRoutine) -> PageRoutine | None:
    name = item.name.strip()[:80]
    if not name:
        return None
    kind = item.kind if item.kind in _KINDS else "other"
    when = item.time.strip()
    return PageRoutine(
        kind=kind,
        name=name,
        dose=item.dose.strip()[:40],
        schedule=(item.schedule.strip() or "Daily")[:40],
        time=when if _TIME.match(when) else "",
        note=item.note.strip()[:120],
    )


def prepare_page_read(raw: PageRead) -> PageRead:
    """Drop invented clinical prose. Keep a dose only as a field copied from the page."""
    if raw.source == "unreadable":
        return PageRead(
            reportTitle=raw.reportTitle.strip()[:120] or "Uploaded page",
            source="unreadable",
            plainSummary="This page could not be read. Nothing was added.",
            hindiSummary="यह पेज पढ़ा नहीं जा सका। कुछ जोड़ा नहीं गया।",
            disclaimer="Nothing was added.",
        )
    routines = [kept for item in raw.prescribedRoutines[:6] if (kept := _routine(item))]
    notes = [kept for line in raw.clinicalObservations[:6] if (kept := _keep_line(line))]
    title = raw.reportTitle.strip()[:120] or "Uploaded page"
    if not routines and not notes and not raw.plainSummary.strip():
        return prepare_page_read(PageRead(reportTitle=title, source="unreadable"))
    return PageRead(
        reportTitle=title,
        doctorName=raw.doctorName.strip()[:120],
        plainSummary=_family_line(raw.plainSummary),
        hindiSummary=_family_line(raw.hindiSummary) if raw.hindiSummary.strip() else "",
        prescribedRoutines=routines,
        clinicalObservations=notes,
        disclaimer="Copied from this page. Confirm before adding it to the desk.",
        source="page",
    )


def read_page(data: bytes, content_type: str) -> PageRead:
    """Send one stored file to Gemini Flash and return the family-facing copy."""
    settings = load_settings()
    client = get_genai_client()
    response = client.models.generate_content(
        model=settings.extract_model or "gemini-2.5-flash",
        contents=[
            _INSTRUCTION,
            types.Part.from_bytes(data=data, mime_type=content_type),
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=PageRead,
            temperature=0.0,
        ),
    )
    if not response or not response.text:
        return prepare_page_read(PageRead(source="unreadable"))
    return prepare_page_read(PageRead(**json.loads(response.text)))
