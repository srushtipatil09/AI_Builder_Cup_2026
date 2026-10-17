"""Private worker: post-call pipeline and the minute tick. Cloud Tasks and Cloud Scheduler call it with an OIDC token."""

import logging
import os
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse
from google.api_core import exceptions as gexc
from pydantic import BaseModel

from saathi import __version__
from saathi.config import load_settings
from saathi.pipeline import run_post_call
from saathi.retention import run_retention
from saathi.scheduling.service import run_scheduler_tick

logger = logging.getLogger(__name__)

app = FastAPI(title="Saathi Worker", version=__version__)


@app.exception_handler(gexc.ResourceExhausted)
@app.exception_handler(gexc.TooManyRequests)
async def database_quota_exhausted(_: Request, exc: Exception) -> JSONResponse:
    """The database quota is used up: answer 503 so Cloud Tasks retries later and the scheduler's next tick tries again."""
    logger.error("Firestore quota exceeded: %s", exc)
    return JSONResponse(status_code=503, headers={"Retry-After": "300"}, content={"detail": "database quota paused"})


def require_invoker(authorization: Optional[str] = Header(None)) -> None:
    """Only the configured invoker service account may call /internal routes.

    With TASK_INVOKER_EMAIL set the bearer must be a Google-signed ID token for that account and this worker's
    URL. Without it (local development) calls are accepted only when the worker is not running on Cloud Run.
    """
    settings = load_settings()
    if not settings.task_invoker_email:
        if os.environ.get("K_SERVICE"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Worker invoker is not configured")
        return
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing invoker token")
    token = authorization.split(" ", 1)[1]
    try:
        from google.auth.transport import requests as g_requests
        from google.oauth2 import id_token

        claims = id_token.verify_oauth2_token(token, g_requests.Request(), audience=settings.worker_url.rstrip("/") or None)
    except Exception as exc:
        logger.warning("Invoker token rejected: %s", exc)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid invoker token")
    if claims.get("email") != settings.task_invoker_email or not claims.get("email_verified", False):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not the configured invoker")


class ProcessSessionRequest(BaseModel):
    sessionId: str
    householdId: str
    utterances: Optional[list[dict]] = None


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "service": "saathi-worker",
        "status": "ok",
        "version": __version__,
        "stage": "active",
    }


@app.post("/internal/process-session", dependencies=[Depends(require_invoker)])
def process_session(body: ProcessSessionRequest):
    """Processes a completed session. Idempotent: a second call for the same session id is a no-op."""
    return run_post_call(body.householdId, body.sessionId, body.utterances)


class TickRequest(BaseModel):
    current_time_hhmm: Optional[str] = None


@app.post("/internal/tick", dependencies=[Depends(require_invoker)])
def scheduler_tick(body: TickRequest):
    """Minute tick invoked by Cloud Scheduler."""
    events = run_scheduler_tick(body.current_time_hhmm)
    return {"status": "tick_processed", "currentTime": body.current_time_hhmm, "dueEvents": events}


@app.post("/internal/retention", dependencies=[Depends(require_invoker)])
def retention():
    """Daily job from Cloud Scheduler: transcripts after 7 days, summaries and daily numbers after 30."""
    return {"status": "retention_processed", **run_retention()}
