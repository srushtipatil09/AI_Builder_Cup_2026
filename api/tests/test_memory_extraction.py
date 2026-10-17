"""Tests for extraction, vector indexing, and family shift detection."""

from fastapi.testclient import TestClient
from saathi.memory.extract import extract_session
from saathi.memory.vectors import FamilyEpisode, FamilyEpisodeVectorIndex
from saathi.worker import app as worker_app

worker_client = TestClient(worker_app)


def test_extraction_meals_and_negation() -> None:
    utterances = [
        {"speaker": "assistant", "text": "Aapne dopahar ka khana khaya?"},
        {"speaker": "parent", "text": "Haan, roti aur daal kha li thi."},
        {"speaker": "assistant", "text": "Aur subah ghoomne gayi thin?"},
        {"speaker": "parent", "text": "Nahi, main aaj nahi gayi, thodi thakan thi."},
    ]
    result = extract_session(utterances)
    assert len(result.meals) >= 1
    assert result.meals[0].reported_eaten is True
    assert "roti" in result.meals[0].evidence_quote.lower()


def test_extraction_correction_and_family() -> None:
    utterances = [
        {"speaker": "parent", "text": "Meena meri behen hain, beti nahi."},
        {"speaker": "parent", "text": "Rahul se aaj phone par baat hui thi."},
    ]
    result = extract_session(utterances)
    facts = " ".join(c.corrected_fact.lower() for c in result.memory_corrections)
    assert any(w in facts for w in ["behen", "sister"])
    contacts = [*result.family_episodes, *result.social_contacts]
    assert any("rahul" in c.person_name.lower() for c in contacts)


def test_family_shift_rule() -> None:
    indexer = FamilyEpisodeVectorIndex("test-shift-household")
    ep1 = FamilyEpisode(
        id="ep-day2",
        person_name="Rahul",
        relation="Son",
        what_was_said="Rahul roz phone karta hai.",
        evidence_quote="Rahul roz phone karta hai.",
        date="2026-10-02",
    )
    ep2 = FamilyEpisode(
        id="ep-day12",
        person_name="Rahul",
        relation="Son",
        what_was_said="Pata nahi kahan hain, phone nahi utha rahe.",
        evidence_quote="Pata nahi kahan hain, phone nahi utha rahe.",
        date="2026-10-12",
    )
    indexer.index_episode(ep1)
    indexer.index_episode(ep2)

    shift = indexer.evaluate_family_shift()
    assert shift is not None
    assert shift["rule_triggered"] == "family_shift"
    assert shift["person"] == "Rahul"
    assert "14567" in shift["helpline"]
    assert "Rahul roz phone karta hai." in shift["earlier_quote"]
    assert "phone nahi utha rahe" in shift["later_quote"]


def test_worker_process_session() -> None:
    res = worker_client.post(
        "/internal/process-session",
        json={
            "sessionId": "sess-worker-1",
            "householdId": "hh-worker-1",
            "utterances": [
                {"speaker": "parent", "text": "Rahul se baat nahi hui, pata nahi kahan hai."},
            ],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "processed"
    assert body["sessionId"] == "sess-worker-1"
