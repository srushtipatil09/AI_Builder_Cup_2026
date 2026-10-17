"""Tests run against the in-memory store and without BigQuery unless SAATHI_LIVE_TESTS=1."""

import os

import pytest


@pytest.fixture(autouse=True)
def isolated_services(monkeypatch):
    # The dev .env turns strict household access on; most tests exercise the open path.
    monkeypatch.setenv("REQUIRE_HOUSEHOLD_AUTH", "false")
    # Caches and call throttles are for the deployed service; each test starts from a clean slate.
    from saathi import cache
    from saathi.scheduling import service as scheduling

    monkeypatch.setattr(cache, "ENABLED", False)
    from saathi.auth import firebase as auth_firebase

    monkeypatch.setattr(auth_firebase, "_access_cache", {})
    monkeypatch.setattr(scheduling, "_watch", {})
    monkeypatch.setattr(scheduling, "_index_checked_at", -1e9)
    monkeypatch.setattr(scheduling, "_none_until", {})
    monkeypatch.setattr(scheduling, "_last_beat", {})
    if os.environ.get("SAATHI_LIVE_TESTS") == "1":
        yield
        return
    from saathi.analytics import bq
    from saathi.providers import firestore as fs

    repo = fs.FirestoreRepository()
    repo._use_fallback = True
    monkeypatch.setattr(fs, "_repo", repo)
    monkeypatch.setattr(bq, "_unavailable", True)
    monkeypatch.setattr(bq, "_client", None)
    yield
