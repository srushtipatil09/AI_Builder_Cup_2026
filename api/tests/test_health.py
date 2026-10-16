from fastapi.testclient import TestClient

from saathi.main import app as api_app
from saathi.worker import app as worker_app


def test_api_health() -> None:
    response = TestClient(api_app).get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "saathi-api"
    assert body["status"] == "ok"
    assert body["billing"] == "cloud-run-request-cpu"
    assert body["min_instances"] == "0"
    assert body["session_cap_seconds"] == "240"


def test_worker_health() -> None:
    response = TestClient(worker_app).get("/health")
    assert response.status_code == 200
    assert response.json()["service"] == "saathi-worker"
