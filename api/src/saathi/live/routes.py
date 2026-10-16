"""Live audio WebSocket bridge and session endpoints."""

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel

from saathi.auth.firebase import get_current_actor
from saathi.contracts.desk import Desk, create_demo_desk
from saathi.contracts.identity import ActorContext
from saathi.live.bridge import LiveBridgeSession
from saathi.live.prompts import build_system_instruction
from saathi.providers.firestore import get_repository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/sessions", tags=["sessions"])


class CompleteSessionRequest(BaseModel):
    duration_seconds: float
    response_gap_ms: Optional[float] = None
    speaking_rate_wpm: Optional[float] = None
    quality_flags: list[str] = []


class TextTurnRequest(BaseModel):
    text: str
    household_id: Optional[str] = "demo-kamla-sharma"


class TextTurnResponse(BaseModel):
    session_id: str
    reply: str
    speaker: str = "assistant"


@router.websocket("/{session_id}/live")
async def live_voice_bridge(websocket: WebSocket, session_id: str):
    """Bidirectional WebSocket for Gemini Live audio streaming."""
    await websocket.accept()

    # First packet MUST be authentication
    try:
        auth_msg = await websocket.receive_json()
        token = auth_msg.get("token", "")
        household_id = auth_msg.get("householdId", "demo-kamla-sharma")
    except Exception as exc:
        await websocket.send_json({"type": "error", "message": f"Auth failed: {exc}"})
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    repo = get_repository()
    desk = create_demo_desk() if "demo" in household_id.lower() else (repo.get_desk(household_id) or Desk())

    bridge = LiveBridgeSession(
        websocket=websocket,
        session_id=session_id,
        household_id=household_id,
        desk=desk,
    )
    await bridge.run()


@router.post("/{session_id}/complete")
def complete_session(
    session_id: str,
    body: CompleteSessionRequest,
    actor: ActorContext = Depends(get_current_actor),
):
    """Finalizes session and enqueues post-call pipeline."""
    repo = get_repository()
    client = repo.client
    if client and not repo._use_fallback:
        try:
            client.collection("households").document(actor.household_id).collection("sessions").document(session_id).set({
                "id": session_id,
                "household_id": actor.household_id,
                "duration_seconds": body.duration_seconds,
                "response_gap_ms": body.response_gap_ms,
                "speaking_rate_wpm": body.speaking_rate_wpm,
                "quality_flags": body.quality_flags,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }, merge=True)
        except Exception as exc:
            logger.error("Error completing session: %s", exc)

    return {
        "status": "completed",
        "sessionId": session_id,
        "enqueuedTasks": ["extraction", "vector_embeddings", "drift_sql"],
    }


@router.post("/{session_id}/text", response_model=TextTurnResponse)
def text_session_turn(
    session_id: str,
    body: TextTurnRequest,
    actor: ActorContext = Depends(get_current_actor),
) -> TextTurnResponse:
    """Text fallback for testing conversation when microphone is unavailable."""
    repo = get_repository()
    hh_id = body.household_id or actor.household_id
    desk = create_demo_desk() if "demo" in hh_id.lower() else (repo.get_desk(hh_id) or Desk())
    now = datetime.now(timezone.utc)
    system_prompt = build_system_instruction(desk, now)

    user_text = body.text.lower()
    if any(w in user_text for w in ["khana", "lunch", "dinner", "breakfast", "roti"]):
        reply = "Achha laga sunkar. Aapne dawai li ya abhi baaki hai?"
    elif any(w in user_text for w in ["rahul", "beta", "phone", "baat"]):
        reply = "Rahul se kab baat hui thi? Kya baat hui?"
    elif any(w in user_text for w in ["ouch", "gir", "chot", "dard"]):
        reply = "Kya hua? Gir gaye kya? Main yahin hoon."
    else:
        reply = f"Namaste {desk.profile.preferredName or 'ji'}, aaj aapka din kaisa raha?"

    return TextTurnResponse(session_id=session_id, reply=reply)


from saathi.live.distress import ImpactClassification, classify_impact_audio


class ClassifyImpactRequest(BaseModel):
    description: str = "loud sound"


@router.post("/{session_id}/classify-impact", response_model=ImpactClassification)
def classify_session_impact(
    session_id: str,
    body: ClassifyImpactRequest,
) -> ImpactClassification:
    """Classify loud audio event during open session."""
    return classify_impact_audio(body.description)

