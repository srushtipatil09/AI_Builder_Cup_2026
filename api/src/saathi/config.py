"""Environment settings. Missing cloud values are allowed in the local scaffold."""

from pydantic_settings import BaseSettings, SettingsConfigDict

from saathi.cost import (
    BIGQUERY_MAX_BYTES_BILLED,
    MAX_DAILY_EXTRACT_CALLS,
    MAX_DAILY_LIVE_MINUTES,
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    google_cloud_project: str = ""
    cloud_region: str = "us-central1"
    api_base_url: str = "http://localhost:8080"
    web_origin: str = "http://localhost:5173"
    demo_enabled: bool = True
    app_module: str = "main:app"
    max_daily_live_minutes: int = MAX_DAILY_LIVE_MINUTES
    max_daily_extract_calls: int = MAX_DAILY_EXTRACT_CALLS
    bigquery_max_bytes_billed: int = BIGQUERY_MAX_BYTES_BILLED


def load_settings() -> Settings:
    return Settings()
