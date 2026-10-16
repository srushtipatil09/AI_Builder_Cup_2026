"""Tests for in-session distress and loud impact classification."""

from fastapi.testclient import TestClient

from saathi.live.distress import check_distress_keywords, classify_impact_audio
from saathi.main import app

client = TestClient(app)


def test_distress_keywords_and_negation() -> None:
    # 1. Obvious distress
    has_distress, negated = check_distress_keywords("Ouch! Chot lag gayi")
    assert has_distress is True
    assert negated is False

    # 2. Negation: "I did not fall"
    has_distress, negated = check_distress_keywords("Kuchh nahi hua, main gir nahi gayi")
    assert has_distress is False
    assert negated is True

    # 3. English negation
    has_distress, negated = check_distress_keywords("Don't worry, I am fine, I did not fall")
    assert has_distress is False
    assert negated is True


def test_impact_classification_rules() -> None:
    # Door slam should be ordinary noise and NOT trigger check
    door = classify_impact_audio("Heavy door closed firmly in corridor")
    assert door.category == "ordinary_noise"
    assert door.trigger_spoken_check is False

    # Heavy thud / plate smash should be possible impact and trigger check
    thud = classify_impact_audio("Sudden loud metallic thud and plate dropping on floor")
    assert thud.category == "possible_impact"
    assert thud.trigger_spoken_check is True


def test_classify_impact_endpoint() -> None:
    res = client.post(
        "/api/v1/sessions/test-distress-sess/classify-impact",
        json={"description": "loud thud on floor"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["category"] == "possible_impact"
    assert body["trigger_spoken_check"] is True
