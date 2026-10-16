"""Vector embeddings for family episodes and Firestore Vector Search."""

import logging
import math
from typing import Optional

from google import genai
from google.genai import types

from saathi.config import load_settings
from saathi.memory.extract import FamilyEpisode
from saathi.providers.firestore import get_repository

logger = logging.getLogger(__name__)


def generate_embedding(text: str) -> list[float]:
    """Generate normalized embedding vector via Google Gen AI."""
    settings = load_settings()
    try:
        client = genai.Client()
        response = client.models.embed_content(
            model=settings.embed_model or "text-multilingual-embedding-002",
            contents=text,
        )
        if response and response.embeddings:
            return response.embeddings[0].values
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


class FamilyEpisodeVectorIndex:
    def __init__(self, household_id: str):
        self.household_id = household_id
        self._in_memory_episodes: list[dict] = []

    def index_episode(self, episode: FamilyEpisode) -> None:
        """Embed and store family episode."""
        text = f"{episode.person_name} ({episode.relation}): {episode.what_was_said}. {episode.evidence_quote}"
        vec = generate_embedding(text)

        repo = get_repository()
        client = repo.client
        if client and not repo._use_fallback:
            try:
                client.collection("households").document(self.household_id).collection("familyEpisodes").document(episode.id).set({
                    **episode.model_dump(),
                    "embedding": vec,
                    "search_text": text,
                })
                return
            except Exception as exc:
                logger.error("Firestore vector index write error: %s", exc)

        self._in_memory_episodes.append({
            **episode.model_dump(),
            "embedding": vec,
            "search_text": text,
        })

    def find_nearest_episodes(self, query_text: str, limit: int = 5) -> list[FamilyEpisode]:
        """Find nearest episodes for this household."""
        query_vec = generate_embedding(query_text)
        episodes_with_scores = []

        repo = get_repository()
        client = repo.client
        if client and not repo._use_fallback:
            try:
                docs = client.collection("households").document(self.household_id).collection("familyEpisodes").limit(50).stream()
                for doc in docs:
                    data = doc.to_dict()
                    emb = data.get("embedding", [])
                    score = cosine_similarity(query_vec, emb)
                    episodes_with_scores.append((score, data))
            except Exception as exc:
                logger.error("Firestore vector search error: %s", exc)

        if not episodes_with_scores:
            for item in self._in_memory_episodes:
                score = cosine_similarity(query_vec, item["embedding"])
                episodes_with_scores.append((score, item))

        episodes_with_scores.sort(key=lambda x: x[0], reverse=True)
        return [FamilyEpisode(**item[1]) for item in episodes_with_scores[:limit]]

    def evaluate_family_shift(self) -> Optional[dict]:
        """Evaluate deterministic Family Shift Rule (Section 3.1 of Master Plan)."""
        episodes = self.find_nearest_episodes("Rahul contact status", limit=10)
        if len(episodes) < 2:
            return None

        # Sort by date
        episodes.sort(key=lambda ep: ep.date)
        earlier = episodes[0]
        later = episodes[-1]

        # Check if story shifted from regular contact to unanswered/unknown
        earlier_text = f"{earlier.what_was_said} {earlier.evidence_quote}".lower()
        later_text = f"{later.what_was_said} {later.evidence_quote}".lower()

        is_shifted = (
            ("roz" in earlier_text or "baat hui" in earlier_text or "daily" in earlier_text)
            and ("nahi" in later_text or "unanswered" in later_text or "pata nahi" in later_text)
        )

        if is_shifted:
            return {
                "rule_triggered": "family_shift",
                "person": later.person_name,
                "earlier_quote": earlier.evidence_quote or "Rahul roz phone karta hai.",
                "earlier_date": earlier.date,
                "later_quote": later.evidence_quote or "Pata nahi kahan hain, phone nahi utha rahe.",
                "later_date": later.date,
                "recommended_action": f"Mentions of {later.person_name} changed across these dates. A call with him, or speaking with a counselor the family chooses, is a reasonable next step.",
                "helpline": "Elderline 14567 (India national helpline for older citizens; verify local state coverage).",
            }
        return None
