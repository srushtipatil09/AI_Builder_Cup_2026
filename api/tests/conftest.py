"""Tests run against the in-memory store and without BigQuery unless SAATHI_LIVE_TESTS=1."""

import os

import pytest


@pytest.fixture(autouse=True)
def isolated_services(monkeypatch):
    # The dev .env turns strict household access on; most tests exercise the open path.
    monkeypatch.setenv("REQUIRE_HOUSEHOLD_AUTH", "false")
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
