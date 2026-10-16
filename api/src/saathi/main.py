"""Public API. Voice, auth, and data routes are later milestones."""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from saathi import __version__
from saathi.config import load_settings
from saathi.cost import MIN_INSTANCES, SESSION_CAP_SECONDS
from saathi.households.routes import router as households_router
from saathi.households.updates import router as updates_router
from saathi.live.routes import router as sessions_router
from saathi.demo.routes import router as demo_router

settings = load_settings()
logger = logging.getLogger(__name__)


def _warm() -> None:
    """Open the Firestore and Vertex clients and their credentials before the first call needs them."""
    try:
        from saathi.live.bridge import get_shared_genai_client
        from saathi.providers.firestore import get_repository

        get_shared_genai_client()
        client = get_repository().client
        if client:
            client.collection("_warm").document("ping").get()
    except Exception as exc:
        logger.warning("Warm-up skipped (%s)", exc)


@asynccontextmanager
async def lifespan(_: FastAPI):
    asyncio.get_running_loop().run_in_executor(None, _warm)
    yield


app = FastAPI(title="Saathi API", version=__version__, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_origin, "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"https://.*|http://localhost:\d+",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

from saathi.accounts.routes import router as accounts_router
from saathi.files.routes import link_router as file_links_router, router as files_router

app.include_router(accounts_router)
app.include_router(files_router)
app.include_router(file_links_router)
app.include_router(households_router)
app.include_router(updates_router)
app.include_router(sessions_router)
app.include_router(demo_router)





@app.get("/health")
def health() -> dict[str, str]:
    return {
        "service": "saathi-api",
        "status": "ok",
        "version": __version__,
        "stage": "connected",
        "billing": "cloud-run-request-cpu",
        "min_instances": str(MIN_INSTANCES),
        "session_cap_seconds": str(SESSION_CAP_SECONDS),
        "live_model": settings.live_model,
    }
