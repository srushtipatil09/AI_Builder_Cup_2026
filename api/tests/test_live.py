"""Tests for Gemini Live bridge and session endpoints."""

from datetime import datetime, timezone
from fastapi.testclient import TestClient

from saathi.contracts.desk import Desk, Memory, Medicine, Person, Profile
from saathi.live.prompts import build_system_instruction
from saathi.main import app

client = TestClient(app)


def test_build_system_instruction_contains_core_rules() -> None:
    desk = Desk(
        profile=Profile(preferredName="Kamla", persona="Saathi", language="Hindi", city="Varanasi"),
        people=[Person(id="p1", name="Rahul", relation="Son", city="Bengaluru")],
        memories=[Memory(id="m1", text="Morning walk in temple garden", author="Rahul", addedAt="2026-10-15")],
        medicines=[Medicine(id="med1", name="BP tablet", dose="5mg", schedule="Daily", time="08:30", note="after breakfast")],
    )
    now = datetime(2026, 10, 16, 10, 0, tzinfo=timezone.utc)
    instruction = build_system_instruction(desk, now)

    assert "Kamla" in instruction
    assert "Saathi" in instruction
    assert "Rahul" in instruction
    assert "Morning walk in temple garden" in instruction
    assert "BP tablet" in instruction
    assert "Ask only ONE question at a time" in instruction
    assert "NEVER diagnose any medical condition" in instruction


def test_text_session_turn() -> None:
    res = client.post(
        "/api/v1/sessions/test-sess-1/text",
        json={"text": "Maine subah khana kha liya", "household_id": "demo-kamla-sharma"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["session_id"] == "test-sess-1"
    assert "dawai" in body["reply"].lower() or "achha" in body["reply"].lower()


def test_complete_session() -> None:
    res = client.post(
        "/api/v1/sessions/test-sess-2/complete",
        json={
            "duration_seconds": 125.5,
            "response_gap_ms": 780.0,
            "speaking_rate_wpm": 115.0,
            "quality_flags": ["good_audio"],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "completed"
    assert body["sessionId"] == "test-sess-2"


def test_websocket_live_voice_bridge() -> None:
    with client.websocket_connect("/api/v1/sessions/test-ws-session/live") as ws:
        # Send auth packet
        ws.send_json({"token": "demo", "householdId": "demo-kamla-sharma"})
        ready = ws.receive_json()
        assert ready["type"] == "ready"
        assert ready["sessionId"] == "test-ws-session"
        assert ready["sessionCapSeconds"] == 240

        # Send user transcript turn
        ws.send_json({"type": "user_transcript", "text": "Namaste Saathi"})
        reply = ws.receive_json()
        assert reply["type"] == "transcript"
        assert reply["role"] == "assistant"
        assert len(reply["text"]) > 0

        # Send distress turn
        ws.send_json({"type": "distress_signal"})
        distress_reply = ws.receive_json()
        assert distress_reply["type"] == "transcript"
        assert "Kya hua? Gir gaye kya?" in distress_reply["text"]

        # Close cleanly
        ws.send_json({"type": "end"})
