"""Daily spend counters (master plan section 3: stop at 120 Live minutes and 500 extraction calls a day)."""

import hashlib
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


def visitor_key(client_ip: str) -> str:
    """A daily, salted hash of the caller's address. The address itself is not stored."""
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return hashlib.sha256(f"saathi-demo:{day}:{client_ip}".encode("utf-8")).hexdigest()[:20]


def demo_session_allowed(key: str) -> bool:
    """Three demo voice sessions per visitor a day, on top of the project-wide Live cap. 0 turns the limit off."""
    limit = load_settings().demo_sessions_per_visitor
    if limit <= 0:
        return True
    row = get_repository().doc_get(f"{_day_path()}/demo_visitors/{key}") or {}
    return float(row.get("sessions", 0)) < limit


def record_demo_session(key: str) -> None:
    get_repository().increment(f"{_day_path()}/demo_visitors/{key}", "sessions", 1)
