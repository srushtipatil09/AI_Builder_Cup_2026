from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from saathi import __version__
from saathi.contracts.desk import Memory
from saathi.memory.extract import extract_session
from saathi.memory.vectors import FamilyEpisodeVectorIndex
from saathi.providers.firestore import get_repository

app = FastAPI(title="Saathi Worker", version=__version__)


class ProcessSessionRequest(BaseModel):
    sessionId: str
    householdId: str
    utterances: list[dict] = []


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "service": "saathi-worker",
        "status": "ok",
        "version": __version__,
        "stage": "active",
    }


@app.post("/internal/process-session")
def process_session(body: ProcessSessionRequest):
    """Processes a completed session: extraction, vector memory, family shift evaluation."""
    repo = get_repository()
    household_id = body.householdId
    session_id = body.sessionId

    # 1. Run structured extraction
    result = extract_session(body.utterances)

    # 2. Vector index family episodes
    indexer = FamilyEpisodeVectorIndex(household_id)
    for ep in result.family_episodes:
        indexer.index_episode(ep)

    # 3. Evaluate family shift rule
    shift = indexer.evaluate_family_shift()

    # 4. Update Desk memories with corrections and summary
    desk = repo.get_desk(household_id)
    if desk:
        # Apply corrections
        for corr in result.memory_corrections:
            desk.memories.insert(0, Memory(
                id=f"mem-corr-{session_id[:6]}",
                text=f"Correction: {corr.corrected_fact}",
                author="conversation",
                addedAt=corr.evidence_quote,
            ))
        repo.save_desk(household_id, desk)
    return {
        "status": "processed",
        "sessionId": session_id,
        "observationsExtracted": len(result.meals) + len(result.discomfort) + len(result.family_episodes),
        "familyShiftDetected": shift is not None,
        "shiftCard": shift,
    }


from saathi.scheduling.service import run_scheduler_tick


class TickRequest(BaseModel):
    current_time_hhmm: str = "08:30"


@app.post("/internal/tick")
def scheduler_tick(body: TickRequest):
    """Minute tick invoked by Cloud Scheduler."""
    events = run_scheduler_tick(body.current_time_hhmm)
    return {
        "status": "tick_processed",
        "currentTime": body.current_time_hhmm,
        "dueEvents": events,
    }


