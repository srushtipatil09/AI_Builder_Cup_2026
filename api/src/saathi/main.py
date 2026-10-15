"""Public API. Voice, auth, and data routes are later milestones."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from saathi import __version__
from saathi.config import load_settings
from saathi.cost import MIN_INSTANCES, SESSION_CAP_SECONDS

settings = load_settings()
app = FastAPI(title="Saathi API", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_origin, "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "service": "saathi-api",
        "status": "ok",
        "version": __version__,
        "stage": "scaffold",
        "billing": "cloud-run-request-cpu",
        "min_instances": str(MIN_INSTANCES),
        "session_cap_seconds": str(SESSION_CAP_SECONDS),
    }
