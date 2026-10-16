"""In-session distress detection and impact sound classification (master plan section 3.2)."""

import io
import json
import logging
import re
import wave
from typing import Literal, Optional
from pydantic import BaseModel
from google.genai import types

from saathi.config import load_settings
from saathi.providers.gemini import get_genai_client

logger = logging.getLogger(__name__)


class ImpactClassification(BaseModel):
    category: Literal["possible_impact", "ordinary_noise", "unclear"]
    confidence: float
    trigger_spoken_check: bool = False
    reasoning: str = ""


# A single keyword is a reason to ask, not a reason to declare a fall.
DISTRESS_KEYWORDS_HI = [
    "ouch", "oh god", "bachao", "gir gayi", "gir gaya", "gir gaye", "chot lagi", "chot lag gayi",
    "dard ho raha hai", "help", "madad", "giri", "gira", "i fell", "fell down", "i am hurt",
]

# Words that mean "I need help now" when the parent says them. These go straight to Level 3.
EXPLICIT_HELP = [
    "bachao", "madad", "help me", "help", "gir gayi", "gir gaya", "gir gaye", "i fell", "fell down",
    "chot lagi", "chot lag gayi", "i am hurt",
]

NEGATION_KEYWORDS_HI = [
    "gir nahi gayi", "gir nahi gaya", "giri nahi", "gira nahi", "theek hoon", "theek hun", "kuchh nahi hua",
    "kuch nahi hua", "i did not fall", "i didn't fall", "i am fine", "i'm fine", "main theek",
]


def _has(text: str, phrases: list[str]) -> bool:
    return any(re.search(r"(?<!\w)" + re.escape(p) + r"(?!\w)", text) for p in phrases)


def check_distress_keywords(transcript: str) -> tuple[bool, bool]:
    """Returns (has_distress_keyword, is_negated). Negation wins."""
    lowered = transcript.lower()
    if _has(lowered, NEGATION_KEYWORDS_HI):
        return False, True
    return _has(lowered, DISTRESS_KEYWORDS_HI), False


def has_explicit_help(transcript: str) -> bool:
    """The parent asked for help or said they fell, in the present tense."""
    lowered = transcript.lower()
    if _has(lowered, NEGATION_KEYWORDS_HI):
        return False
    return _has(lowered, EXPLICIT_HELP)


def pcm16_to_wav(pcm: bytes, rate: int = 16000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm)
    return buffer.getvalue()


def _finish(result: ImpactClassification) -> ImpactClassification:
    """The spoken check is decided here, never by the model's own field."""
    result.trigger_spoken_check = result.category == "possible_impact" and result.confidence >= 0.5
    return result


def classify_impact_audio(clip_description: str = "", audio_bytes: Optional[bytes] = None) -> ImpactClassification:
    """Label a sudden loud sound as possible_impact, ordinary_noise, or unclear with Gemini Flash."""
    settings = load_settings()

    if audio_bytes is None:
        # Labeled demo clips carry their kind in the description.
        desc = clip_description.lower()
        if "door" in desc or "spoon" in desc or "tv" in desc:
            return _finish(ImpactClassification(
                category="ordinary_noise", confidence=0.92,
                reasoning="Labeled recording of an ordinary household sound.",
            ))
        if "thud" in desc or "plate" in desc or "fall" in desc or "impact" in desc:
            return _finish(ImpactClassification(
                category="possible_impact", confidence=0.88,
                reasoning="Labeled recording of a sharp impact.",
            ))

    try:
        client = get_genai_client()
        instruction = (
            "Label this short audio clip from a home. possible_impact: a heavy thud, a person or object falling, a crash. "
            "ordinary_noise: a door, a dropped spoon, a TV, speech, clapping. unclear: anything else. "
            "Be conservative about possible_impact. Give a confidence between 0 and 1."
        )
        contents: list = [instruction]
        if audio_bytes is not None:
            contents.append(types.Part.from_bytes(data=pcm16_to_wav(audio_bytes), mime_type="audio/wav"))
        else:
            contents.append(f"Description of the sound: {clip_description}")
        response = client.models.generate_content(
            model=settings.extract_model or "gemini-2.5-flash",
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=ImpactClassification,
                temperature=0.0,
            ),
        )
        if response and response.text:
            return _finish(ImpactClassification(**json.loads(response.text)))
    except Exception as exc:
        logger.warning("Gemini impact classification failed (%s); using conservative default", exc)

    # The check is only a question. An alert still needs silence afterward.
    return _finish(ImpactClassification(
        category="possible_impact", confidence=0.75,
        reasoning="Unverified loud sound; a spoken check is asked.",
    ))
