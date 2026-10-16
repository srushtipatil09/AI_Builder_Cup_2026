"""Daily spend counters (master plan section 3: stop at 120 Live minutes and 500 extraction calls a day)."""

from datetime import datetime, timezone

from saathi.config import load_settings
from saathi.providers.firestore import get_repository


def _day_path() -> str:
    return f"_usage/{datetime.now(timezone.utc).strftime('%Y-%m-%d')}"


def used(field: str) -> float:
    row = get_repository().doc_get(_day_path()) or {}
    return float(row.get(field, 0))


def extraction_allowed() -> bool:
    return used("extract_calls") < load_settings().max_daily_extract_calls


def live_allowed() -> bool:
    return used("live_minutes") < load_settings().max_daily_live_minutes


def record_extraction() -> None:
    get_repository().increment(_day_path(), "extract_calls", 1)


def record_live_minutes(seconds: float) -> None:
    get_repository().increment(_day_path(), "live_minutes", seconds / 60.0)
