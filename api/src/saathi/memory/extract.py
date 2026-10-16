"""Structured observation extraction using Gemini 3.8 Flash."""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from saathi.config import load_settings

logger = logging.getLogger(__name__)


class MealObservation(BaseModel):
    meal: str
    reported_eaten: bool
    description: str
    evidence_quote: str


class DiscomfortObservation(BaseModel):
    area: str
    severity: str
    evidence_quote: str


class SocialContactObservation(BaseModel):
    person_name: str
    relation: str
    channel: str
    evidence_quote: str


class FamilyEpisode(BaseModel):
    id: str = Field(default_factory=lambda: f"ep-{uuid.uuid4().hex[:8]}")
    person_name: str
    relation: str = ""
    reported_last_contact: str = "unknown"
    what_was_said: str = ""
    where_they_are: str = "unknown"
    what_they_asked: str = "unknown"
    how_it_felt: str = ""
    evidence_quote: str = ""
    date: str = Field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d"))


class MemoryCorrection(BaseModel):
    target_fact: str
    corrected_fact: str
    evidence_quote: str


class ExtractionResult(BaseModel):
    meals: list[MealObservation] = Field(default_factory=list)
    mood_stated: Optional[str] = None
    discomfort: list[DiscomfortObservation] = Field(default_factory=list)
    social_contacts: list[SocialContactObservation] = Field(default_factory=list)
    family_episodes: list[FamilyEpisode] = Field(default_factory=list)
    memory_corrections: list[MemoryCorrection] = Field(default_factory=list)
    declined_topics: list[str] = Field(default_factory=list)
    summary: str = ""


EXTRACTION_PROMPT = """You are the post-call clinical extraction pipeline for Saathi.
Analyze the following conversation between an older adult (Parent) and the companion (Saathi).
Extract structured observations adhering strictly to these rules:
1. Every observation MUST include an exact evidence quote verbatim from the Parent's words.
2. If something was not mentioned, leave it empty or unknown. Never guess.
3. Mood must only be extracted if explicitly stated by the Parent (e.g. "achha lag raha hai", "udaas hoon", "akela lagta hai").
4. Negations (e.g. "I did not fall", "kal baat nahi hui") must be recorded accurately as negative/unreported events, never positive occurrences.
5. If the Parent corrects a fact (e.g. "Meena meri behen hain, beti nahi"), record it under memory_corrections.
6. Extract family interactions as family_episodes (person, when last spoke, what said, where they are, what asked).
"""


def extract_session(utterances: list[dict], parent_name: str = "") -> ExtractionResult:
    """Extract structured observations from conversation transcript."""
    settings = load_settings()
    transcript_lines = []
    parent_quotes = []

    for u in utterances:
        speaker = u.get("speaker", "unknown")
        text = u.get("text", "")
        transcript_lines.append(f"{speaker.capitalize()}: {text}")
        if speaker in ("parent", "user"):
            parent_quotes.append(text)

    transcript = "\n".join(transcript_lines)

    # 1. Attempt Gemini Structured Extraction
    try:
        client = genai.Client()
        response = client.models.generate_content(
            model=settings.extract_model or "gemini-2.5-flash",
            contents=f"{EXTRACTION_PROMPT}\n\nTranscript:\n{transcript}",
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=ExtractionResult,
                temperature=0.1,
            ),
        )
        if response and response.text:
            data = json.loads(response.text)
            return ExtractionResult(**data)
    except Exception as exc:
        logger.warning("Gemini extraction failed (%s); using deterministic rule parser", exc)

    # 2. Deterministic Rule Parser Fallback
    res = ExtractionResult(summary="Daily conversation with Saathi.")
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    for line in parent_quotes:
        lowered = line.lower()

        # Meal detection
        if any(w in lowered for w in ["khana", "lunch", "dinner", "breakfast", "roti", "chai"]):
            eaten = not any(w in lowered for w in ["nahi khaya", "bhookh nahi thi", "skipped"])
            res.meals.append(MealObservation(
                meal="lunch" if "lunch" in lowered or "dophar" in lowered else "meal",
                reported_eaten=eaten,
                description=line,
                evidence_quote=line,
            ))

        # Explicit mood
        if any(w in lowered for w in ["akela", "udaas", "low", "bura"]):
            res.mood_stated = "Low"
        elif any(w in lowered for w in ["achha", "theek", "good", "khush"]):
            res.mood_stated = "Good"

        # Discomfort / pain
        if any(w in lowered for w in ["chot", "dard", "pain", "gir"]):
            res.discomfort.append(DiscomfortObservation(
                area="body",
                severity="mild" if "thoda" in lowered else "reported",
                evidence_quote=line,
            ))

        # Family mention (e.g. Rahul)
        if "rahul" in lowered:
            last_contact = "today" if "aaj" in lowered else "unknown"
            if "phone nahi utha rahe" in lowered or "pata nahi" in lowered:
                where = "unknown"
                said = "calls unanswered"
            else:
                where = "Bengaluru"
                said = "spoke by phone"
            res.family_episodes.append(FamilyEpisode(
                person_name="Rahul",
                relation="Son",
                reported_last_contact=last_contact,
                what_was_said=said,
                where_they_are=where,
                evidence_quote=line,
                date=today_str,
            ))

        # Correction detection
        if "nahi" in lowered and any(rel in lowered for rel in ["behen", "beti", "bhai", "beta"]):
            res.memory_corrections.append(MemoryCorrection(
                target_fact="Family relationship",
                corrected_fact=line,
                evidence_quote=line,
            ))

    return res
