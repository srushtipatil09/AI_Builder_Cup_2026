"""A Firestore error on Cloud Run must not turn the process into a memory store; a missing household id is refused."""

import pytest
from fastapi.testclient import TestClient
from google.api_core.exceptions import InvalidArgument

from saathi.main import app
from saathi.providers.firestore import FirestoreRepository

client = TestClient(app)


class _BrokenDoc:
    def get(self):
        raise InvalidArgument("bad document name")


class _BrokenClient:
    def document(self, path):
        return _BrokenDoc()


def test_empty_path_segment_is_refused() -> None:
    repo = FirestoreRepository()
    repo._use_fallback = True
    with pytest.raises(ValueError):
        repo.doc_set("households//sessions/s1", {"x": 1})


def test_cloud_run_error_does_not_switch_to_memory(monkeypatch) -> None:
    repo = FirestoreRepository(client=_BrokenClient())
    monkeypatch.setenv("K_SERVICE", "saathi-api")
    with pytest.raises(InvalidArgument):
        repo.doc_get("households/h1/sessions/s1")
    assert repo._use_fallback is False

    monkeypatch.delenv("K_SERVICE")
    assert repo.doc_get("households/h1/sessions/s1") is None
    assert repo._use_fallback is True


def test_parent_phone_registers_push_with_family_code(monkeypatch) -> None:
    hh_id = client.post("/api/v1/households", json={"caretaker_name": "Rahul", "parent_name": "Kamla"}).json()["id"]
    code = client.post(f"/api/v1/households/{hh_id}/pairing").json()["code"]
    assert client.post("/api/v1/pair", json={"code": code, "parent_name": "Kamla"}).status_code == 200
    monkeypatch.setenv("REQUIRE_HOUSEHOLD_AUTH", "true")
    phone = {"X-Family-Code": code, "X-Household-Id": hh_id, "X-Role": "parent"}
    url = f"/api/v1/households/{hh_id}/devices"
    assert client.post(url, json={"token": "t-parent", "role": "parent"}, headers=phone).status_code == 200
    assert client.post(url, json={"token": "t-care", "role": "caretaker"}, headers=phone).status_code in (401, 403)
