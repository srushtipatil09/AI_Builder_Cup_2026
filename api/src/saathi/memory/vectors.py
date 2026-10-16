"""Vector embeddings for family episodes, Firestore vector search, and the family shift rule."""

import logging
import math
from typing import Optional

from saathi.config import load_settings
from saathi.cost import VECTOR_NEIGHBORS
from saathi.providers.gemini import get_genai_client
from saathi.memory.extract import FamilyEpisode
from saathi.providers.firestore import get_repository

logger = logging.getLogger(__name__)


def generate_embedding(text: str) -> list[float]:
    """Generate normalized embedding vector via Google Gen AI."""
    settings = load_settings()
    try:
        client = get_genai_client()
        response = client.models.embed_content(
            model=settings.embed_model or "text-multilingual-embedding-002",
            contents=text,
        )
        if response and response.embeddings:
            return list(response.embeddings[0].values)
    except Exception as exc:
        logger.warning("Google embedding call failed (%s); using deterministic pseudo-embedding", exc)

    # Deterministic 64-dim pseudo-embedding fallback for offline/test environments
    vec = [0.0] * 64
    for i, ch in enumerate(text.encode("utf-8")):
        vec[i % 64] += float(ch)
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    if not v1 or not v2 or len(v1) != len(v2):
        return 0.0
    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = math.sqrt(sum(a * a for a in v1)) or 1.0
    norm2 = math.sqrt(sum(b * b for b in v2)) or 1.0
    return dot / (norm1 * norm2)


# Words that mark the parent's own report of contact. Matched on the stored quote and summary only.
LOST_MARKERS = [
    "pata nahi", "nahi utha", "nahi uthate", "phone nahi", "baat nahi", "call nahi", "koi khabar nahi",
    "not picking", "no answer", "unanswered", "don't know where", "do not know where", "haven't spoken",
]
TALKING_MARKERS = [
    "roz", "daily", "every day", "baat hui", "baat karta", "baat karte", "phone karta", "phone karte",
    "baat karti", "spoke", "called",
]
LONELINESS_PHRASES = ["akela lagta", "akeli lagti", "koi nahi aata", "koi nahi aati", "feel lonely", "i feel alone"]


def _episode_text(ep: FamilyEpisode) -> str:
    return f"{ep.what_was_said} {ep.evidence_quote}".lower()


def contact_state(ep: FamilyEpisode) -> str:
    """"lost", "talking", or "unknown", from the parent's reported words. Tone is never inferred."""
    text = _episode_text(ep)
    if any(m in text for m in LOST_MARKERS):
        return "lost"
    if any(m in text for m in TALKING_MARKERS):
        return "talking"
    return "unknown"


def _doc_to_episode(data: dict) -> Optional[FamilyEpisode]:
    try:
        fields = {k: v for k, v in data.items() if k in FamilyEpisode.model_fields}
        return FamilyEpisode(**fields)
    except Exception:
        return None


def _as_list(value) -> list[float]:
    try:
        return [float(x) for x in value]
    except Exception:
        return []


class FamilyEpisodeVectorIndex:
    def __init__(self, household_id: str):
        self.household_id = household_id

    def _path(self) -> str:
        return f"households/{self.household_id}/familyEpisodes"

    def index_episode(self, episode: FamilyEpisode) -> None:
        """Embed and store one family episode. The same id rewrites the same document."""
        text = f"{episode.person_name} ({episode.relation}): {episode.what_was_said}. {episode.evidence_quote}"
        vec = generate_embedding(text)

        repo = get_repository()
        client = repo.client
        if client and not repo._use_fallback:
            try:
                from google.cloud.firestore_v1.vector import Vector

                client.document(f"{self._path()}/{episode.id}").set({
                    **episode.model_dump(),
                    "embedding": Vector(vec),
                    "search_text": text,
                })
                return
            except Exception as exc:
                logger.error("Firestore vector index write error: %s", exc)

        repo.doc_set(f"{self._path()}/{episode.id}", {**episode.model_dump(), "embedding": vec, "search_text": text}, merge=False)

    def all_episodes(self, limit: int = 200) -> list[FamilyEpisode]:
        """Every stored episode for this household (no ranking)."""
        repo = get_repository()
        rows = repo.col_list(self._path(), limit=limit)
        episodes = [_doc_to_episode(r) for r in rows]
        return [e for e in episodes if e is not None]

    def find_nearest_episodes(self, query_text: str, limit: int = VECTOR_NEIGHBORS) -> list[FamilyEpisode]:
        """Nearest episodes for this household: Firestore find_nearest first, cosine over the household's rows second."""
        query_vec = generate_embedding(query_text)
        repo = get_repository()
        client = repo.client

        if client and not repo._use_fallback:
            try:
                from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
                from google.cloud.firestore_v1.vector import Vector

                query = client.collection(self._path()).find_nearest(
                    vector_field="embedding",
                    query_vector=Vector(query_vec),
                    distance_measure=DistanceMeasure.COSINE,
                    limit=limit,
                )
                found = [_doc_to_episode(d.to_dict() or {}) for d in query.stream()]
                found = [e for e in found if e is not None]
                if found:
                    return found
            except Exception as exc:
                logger.info("Firestore find_nearest not available (%s); ranking in the service", exc)

        scored: list[tuple[float, dict]] = []
        for row in repo.col_list(self._path(), limit=200):
            scored.append((cosine_similarity(query_vec, _as_list(row.get("embedding", []))), row))
        scored.sort(key=lambda x: x[0], reverse=True)
        result = [_doc_to_episode(item) for _, item in scored[:limit]]
        return [e for e in result if e is not None]

    def evaluate_family_shift(self, person: Optional[str] = None) -> Optional[dict]:
        """Deterministic family shift rule (master plan section 3.1), run on the structured episodes.

        The earlier episode must say they talk; a later episode on a different date must say the
        parent does not know where the person is or that calls go unanswered. Quotes come from the
        stored episodes only. Nothing is filled in when a quote is missing.
        """
        episodes = self.all_episodes()
        by_person: dict[str, list[FamilyEpisode]] = {}
        for ep in episodes:
            if person and ep.person_name.lower() != person.lower():
                continue
            by_person.setdefault(ep.person_name, []).append(ep)

        for name, eps in by_person.items():
            eps.sort(key=lambda e: e.date)
            later = next((e for e in reversed(eps) if contact_state(e) == "lost" and e.evidence_quote), None)
            if later is None:
                continue
            earlier = next(
                (e for e in eps if e.date < later.date and contact_state(e) == "talking" and e.evidence_quote), None
            )
            if earlier is None:
                continue
            return {
                "rule_triggered": "family_shift",
                "person": name,
                "earlier_quote": earlier.evidence_quote,
                "earlier_date": earlier.date,
                "earlier_episode_id": earlier.id,
                "later_quote": later.evidence_quote,
                "later_date": later.date,
                "later_episode_id": later.id,
                "recommended_action": (
                    f"Mentions of {name} changed across these dates. A call with them, or time with a "
                    "counsellor the family chooses, is a reasonable next step."
                ),
                "helpline": "Elderline 14567 (India national helpline for older citizens; verify local state coverage).",
            }
        return None

    def follow_up_context(self, person: str, limit: int = 3) -> list[FamilyEpisode]:
        """The most recent episodes about one person, for the next greeting. Labeled data, not instructions."""
        eps = [e for e in self.all_episodes() if e.person_name.lower() == person.lower()]
        eps.sort(key=lambda e: e.date, reverse=True)
        return eps[:limit]
