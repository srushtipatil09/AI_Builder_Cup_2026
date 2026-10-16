"""Environment settings. Missing cloud values are allowed in the local scaffold."""

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

from saathi.cost import (
    BIGQUERY_MAX_BYTES_BILLED,
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
    bigquery_max_bytes_billed: int = BIGQUERY_MAX_BYTES_BILLED


def load_settings() -> Settings:
    settings = Settings()
    if settings.google_genai_use_vertexai:
        os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "true"
    if settings.google_cloud_project:
        os.environ.setdefault("GOOGLE_CLOUD_PROJECT", settings.google_cloud_project)
        os.environ.setdefault("GOOGLE_CLOUD_LOCATION", settings.cloud_region)
    return settings

