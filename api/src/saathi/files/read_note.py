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

from saathi import languages
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
    "plainSummary and localSummary are a few lines for the family and must not contain milligram amounts. "
    "If a medicine name and amount are printed, put the amount only in dose, exactly as written. "
    "Brushing, flossing, or a walk the page says daily is kind other or exercise and schedule Daily. "
    "A filling, a cleaning, or any visit is kind other and schedule Once, never Daily. "
    "Put a clock time only when the page prints one. "
    "If the page is not a note or cannot be read, set source to unreadable and leave routines empty."
)

_CONFIRM = "The page was read. Confirm each line before it is saved."

# Said by the server when the page could not be read, so no model call is needed for it.
_UNREADABLE = {
    "Hindi": "यह पेज पढ़ा नहीं जा सका। कुछ जोड़ा नहीं गया।",
    "Bengali": "এই পাতাটি পড়া যায়নি। কিছু যোগ করা হয়নি।",
    "Marathi": "हे पान वाचता आले नाही. काहीही जोडले नाही.",
    "Gujarati": "આ પાનું વાંચી શકાયું નહીં. કંઈ ઉમેરાયું નથી.",
    "Punjabi": "ਇਹ ਪੰਨਾ ਪੜ੍ਹਿਆ ਨਹੀਂ ਜਾ ਸਕਿਆ। ਕੁਝ ਨਹੀਂ ਜੋੜਿਆ ਗਿਆ।",
    "Tamil": "இந்தப் பக்கத்தைப் படிக்க முடியவில்லை. எதுவும் சேர்க்கப்படவில்லை.",
    "Telugu": "ఈ పేజీని చదవలేకపోయాం. ఏమీ జోడించలేదు.",
    "Kannada": "ಈ ಪುಟವನ್ನು ಓದಲು ಆಗಲಿಲ್ಲ. ಏನನ್ನೂ ಸೇರಿಸಲಾಗಿಲ್ಲ.",
    "Malayalam": "ഈ പേജ് വായിക്കാൻ കഴിഞ്ഞില്ല. ഒന്നും ചേർത്തിട്ടില്ല.",
}


def _language_line(language: str) -> str:
    """The family's second summary follows the parent's language. English needs no second copy."""
    lang = languages.get(language)
    if lang.name == "English":
        return "Leave localSummary empty."
    return f"Write localSummary as the same lines in {lang.name}, in {lang.native} script."


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
    localSummary: str = ""
    # Set by the server from the household's profile, not by the model.
    localLanguage: str = ""
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


def prepare_page_read(raw: PageRead, language: str = languages.DEFAULT) -> PageRead:
    """Drop invented clinical prose. Keep a dose only as a field copied from the page."""
    lang = languages.normalize(language)
    local = "" if lang == "English" else lang
    if raw.source == "unreadable":
        return PageRead(
            reportTitle=raw.reportTitle.strip()[:120] or "Uploaded page",
            source="unreadable",
            plainSummary="This page could not be read. Nothing was added.",
            localSummary=_UNREADABLE.get(lang, ""),
            localLanguage=local if lang in _UNREADABLE else "",
            disclaimer="Nothing was added.",
        )
    routines = [kept for item in raw.prescribedRoutines[:6] if (kept := _routine(item))]
    notes = [kept for line in raw.clinicalObservations[:6] if (kept := _keep_line(line))]
    title = raw.reportTitle.strip()[:120] or "Uploaded page"
    if not routines and not notes and not raw.plainSummary.strip():
        return prepare_page_read(PageRead(reportTitle=title, source="unreadable"), lang)
    return PageRead(
        reportTitle=title,
        doctorName=raw.doctorName.strip()[:120],
        plainSummary=_family_line(raw.plainSummary),
        localSummary=_family_line(raw.localSummary) if local and raw.localSummary.strip() else "",
        localLanguage=local if raw.localSummary.strip() else "",
        prescribedRoutines=routines,
        clinicalObservations=notes,
        disclaimer="Copied from this page. Confirm before adding it to the desk.",
        source="page",
    )


def read_page(data: bytes, content_type: str, language: str = languages.DEFAULT) -> PageRead:
    """Send one stored file to Gemini Flash and return the family-facing copy in English and the parent's language."""
    settings = load_settings()
    client = get_genai_client()
    response = client.models.generate_content(
        model=settings.extract_model or "gemini-2.5-flash",
        contents=[
            f"{_INSTRUCTION} {_language_line(language)}",
            types.Part.from_bytes(data=data, mime_type=content_type),
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=PageRead,
            temperature=0.0,
        ),
    )
    if not response or not response.text:
        return prepare_page_read(PageRead(source="unreadable"), language)
    return prepare_page_read(PageRead(**json.loads(response.text)), language)
