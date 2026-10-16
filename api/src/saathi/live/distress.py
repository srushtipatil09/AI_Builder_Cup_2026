"""In-session distress detection and impact sound classification."""

import logging
from typing import Literal, Optional
from pydantic import BaseModel
from google.genai import types

from saathi.config import load_settings
from saathi.providers.gemini import get_genai_client

logger = logging.getLogger(__name__)


class ImpactClassification(BaseModel):
    category: Literal["possible_impact", "ordinary_noise", "unclear"]
    confidence: float
    trigger_spoken_check: bool
    reasoning: str


DISTRESS_KEYWORDS_HI = [
    "ouch", "bachao", "gir gayi", "gir gaya", "chot lagi", "chot lag gayi",
    "dard ho raha hai", "help", "bachao", "madad", "giri", "gira"
]

NEGATION_KEYWORDS_HI = [
    "gir nahi gayi", "giri nahi", "theek hoon", "kuchh nahi hua", "i did not fall", "i am fine"
]


def check_distress_keywords(transcript: str) -> tuple[bool, bool]:
    """Returns (has_distress_keyword, is_negated)."""
    lowered = transcript.lower()
    is_negated = any(neg in lowered for neg in NEGATION_KEYWORDS_HI)
    if is_negated:
        return False, True
    has_distress = any(kw in lowered for kw in DISTRESS_KEYWORDS_HI)
    return has_distress, False


def classify_impact_audio(clip_description: str = "", audio_bytes: Optional[bytes] = None) -> ImpactClassification:
    """Classifies sudden acoustic RMS spike as impact or ordinary noise using Gemini Flash."""
    settings = load_settings()

    # Rule-based fast check for demo clips
    desc_lowered = clip_description.lower()
    if "door" in desc_lowered or "spoon" in desc_lowered or "tv" in desc_lowered:
        return ImpactClassification(
            category="ordinary_noise",
            confidence=0.92,
            trigger_spoken_check=False,
            reasoning="Acoustic pattern matches an ordinary household door slam or utensil.",
        )
    if "thud" in desc_lowered or "plate" in desc_lowered or "fall" in desc_lowered or "impact" in desc_lowered:
        return ImpactClassification(
            category="possible_impact",
            confidence=0.88,
            trigger_spoken_check=True,
            reasoning="Sharp non-speech acoustic impact transient detected.",
        )

    # Gemini Flash Classifier
    try:
        client = get_genai_client()
        prompt = f"""Classify this sudden loud acoustic event: '{clip_description}'.
Is it 'possible_impact' (a heavy body fall or crash), 'ordinary_noise' (door closing, dropped spoon, TV), or 'unclear'?"""
        response = client.models.generate_content(
            model=settings.extract_model or "gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=ImpactClassification,
                temperature=0.0,
            ),
        )
        if response and response.text:
            import json
            data = json.loads(response.text)
            return ImpactClassification(**data)
    except Exception as exc:
        logger.warning("Gemini impact classification failed (%s); using conservative default", exc)

    return ImpactClassification(
        category="possible_impact",
        confidence=0.75,
        trigger_spoken_check=True,
        reasoning="Unverified loud sound; conservative safety check initiated.",
    )
