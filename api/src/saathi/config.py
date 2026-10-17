"""Environment settings. Missing cloud values are allowed in the local scaffold."""

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

from saathi.cost import (
    BIGQUERY_MAX_BYTES_BILLED,
    DEMO_SESSIONS_PER_VISITOR,
    MAX_DAILY_EXTRACT_CALLS,
    MAX_DAILY_LIVE_MINUTES,
)

# Repo-root .env, whether the process was started in the repo or in api/.
_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")

    google_cloud_project: str = ""
    cloud_region: str = "us-central1"
    firebase_project_id: str | None = None
    api_base_url: str = "http://localhost:8080"
    web_origin: str = "http://localhost:5173"
    # More browser origins allowed by CORS, comma separated. The Firebase Hosting domains of the project
    # (<project>.web.app, <project>.firebaseapp.com) and localhost are always allowed.
    cors_extra_origins: str = ""
    demo_enabled: bool = True
    app_module: str = "main:app"
    extract_model: str = "gemini-2.5-flash"
    insight_model: str = "gemini-2.5-flash"
    live_model: str = "gemini-live-2.5-flash-native-audio"
    live_voice: str = "Aoede"
    live_silence_ms: int = 700
    embed_model: str = "text-multilingual-embedding-002"
    google_genai_use_vertexai: bool = True
    max_daily_live_minutes: int = MAX_DAILY_LIVE_MINUTES
    max_daily_extract_calls: int = MAX_DAILY_EXTRACT_CALLS
    # Demo voice sessions per visitor per day. 0 turns the limit off (for recording the video).
    demo_sessions_per_visitor: int = DEMO_SESSIONS_PER_VISITOR
    bigquery_max_bytes_billed: int = BIGQUERY_MAX_BYTES_BILLED
    bigquery_dataset: str = "saathi"
    # Bucket for photos and documents (caretaker|person/public|private/<user-id>/...). Empty means "<project>-media".
    uploads_bucket: str = ""
    # Signs the 30-minute links to private files. Set a long random value; keep it out of source and logs.
    link_signing_secret: str = ""
    bigquery_location: str = "US"
    # Cloud Tasks hand-off for post-call work. Empty worker_url keeps the work in this process.
    task_queue: str = "saathi-pipeline"
    worker_url: str = ""
    task_invoker_email: str = ""
    # Require a verified Firebase identity (or a joined family code) for every non-demo household.
    # Off by default so local runs without Firebase still work. Deployments set it true (see .env.example).
    require_household_auth: bool = False


def cors_origins(settings: Settings) -> list[str]:
    """Exact origins the browser may call the API from, with credentials."""
    origins = [settings.web_origin, "http://localhost:5173", "http://127.0.0.1:5173"]
    project = settings.firebase_project_id or settings.google_cloud_project
    if project:
        origins += [f"https://{project}.web.app", f"https://{project}.firebaseapp.com"]
    origins += [o.strip() for o in settings.cors_extra_origins.split(",") if o.strip()]
    return [o.rstrip("/") for o in dict.fromkeys(origins) if o]


def load_settings() -> Settings:
    settings = Settings()
    if settings.google_genai_use_vertexai:
        os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "true"
    if settings.google_cloud_project:
        os.environ.setdefault("GOOGLE_CLOUD_PROJECT", settings.google_cloud_project)
        os.environ.setdefault("GOOGLE_CLOUD_LOCATION", settings.cloud_region)
    return settings

