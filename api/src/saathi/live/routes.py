"""Live audio WebSocket bridge and session endpoints."""

import json
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from google.genai import types
from pydantic import BaseModel

from saathi.auth.firebase import (
    actor_from_token,
    ensure_household_access,
    get_current_actor,
    has_household_access,
    is_demo_household,
)
from saathi.config import load_settings
from saathi.contracts.desk import Desk, create_demo_desk
from saathi.contracts.identity import ActorContext
from saathi.live.bridge import LiveBridgeSession
from saathi.live.context import build_live_context
from saathi.live.prompts import build_system_instruction
from saathi.taskqueue import enqueue_post_call
from saathi.usage import extraction_allowed, live_allowed, record_extraction
from saathi.providers.firestore import get_repository
from saathi.providers.gemini import get_genai_client

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
        actor = actor_from_token(token, household_id, auth_msg.get("role"), auth_msg.get("familyCode"))
        allowed, reason = has_household_access(actor, household_id, allow_family_code=True) if household_id else (True, "blank")
    except Exception as exc:
        await websocket.send_json({"type": "error", "message": "Authentication failed."})
        logger.warning("Live auth failed: %s", exc)
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    if not allowed:
        await websocket.send_json({"type": "error", "message": "You do not have access to this household."})
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    if not live_allowed():
        await websocket.send_json({"type": "error", "message": "Saathi has reached today's voice limit. Please try again tomorrow."})
        await websocket.close(code=status.WS_1013_TRY_AGAIN_LATER)
        return

    repo = get_repository()
    loop = asyncio.get_running_loop()
    if not household_id:
        desk = Desk()
    elif is_demo_household(household_id):
        desk = await loop.run_in_executor(None, repo.get_desk, household_id) or create_demo_desk()
    else:
        desk = await loop.run_in_executor(None, repo.get_desk, household_id) or Desk()
    extra = await loop.run_in_executor(None, build_live_context, household_id, desk)

    bridge = LiveBridgeSession(
        websocket=websocket,
        session_id=session_id,
        household_id=household_id,
        desk=desk,
        context=extra,
    )
    await bridge.run()


@router.post("/{session_id}/complete")
def complete_session(
    session_id: str,
    body: CompleteSessionRequest,
    actor: ActorContext = Depends(get_current_actor),
):
    """Records the browser's measurements and hands the session to the post-call pipeline."""
    ensure_household_access(actor, actor.household_id, allow_family_code=True)
    repo = get_repository()
    repo.doc_set(f"households/{actor.household_id}/sessions/{session_id}", {
        "id": session_id,
        "household_id": actor.household_id,
        "duration_seconds": body.duration_seconds,
        "response_gap_ms": body.response_gap_ms,
        "speaking_rate_wpm": body.speaking_rate_wpm,
        "quality_flags": body.quality_flags,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }, merge=True)
    how = enqueue_post_call(actor.household_id, session_id)
    return {"status": "completed", "sessionId": session_id, "handoff": how}


@router.post("/{session_id}/text", response_model=TextTurnResponse)
def text_session_turn(
    session_id: str,
    body: TextTurnRequest,
    actor: ActorContext = Depends(get_current_actor),
) -> TextTurnResponse:
    """Text fallback for testing conversation when microphone is unavailable."""
    repo = get_repository()
    hh_id = body.household_id or actor.household_id
    ensure_household_access(actor, hh_id, allow_family_code=True)
    desk = (repo.get_desk(hh_id) or create_demo_desk()) if is_demo_household(hh_id) else (repo.get_desk(hh_id) or Desk())
    now = datetime.now(timezone.utc)
    system_prompt = build_system_instruction(desk, now)

    user_text = body.text.lower()
    if any(w in user_text for w in ["ouch", "gir", "chot", "dard"]):
        return TextTurnResponse(
            session_id=session_id,
            reply="Kya hua? Gir gaye kya? Main yahin hoon.",
        )

    settings = load_settings()
    try:
        response = get_genai_client().models.generate_content(
            model=settings.extract_model or "gemini-2.5-flash",
            contents=body.text,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.7,
                max_output_tokens=150,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        if response and response.text:
            return TextTurnResponse(session_id=session_id, reply=response.text.strip())
    except Exception as exc:
        logger.warning("Vertex reply failed (%s); using the local line", exc)

    if any(w in user_text for w in ["khana", "lunch", "dinner", "breakfast", "roti"]):
        reply = "Achha laga sunkar. Aapne dawai li ya abhi baaki hai?"
    elif any(w in user_text for w in ["rahul", "beta", "phone", "baat"]):
        reply = "Rahul se kab baat hui thi? Kya baat hui?"
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
    actor: ActorContext = Depends(get_current_actor),
) -> ImpactClassification:
    """Classify a described loud sound. The web app classifies over the WebSocket; this is for testing.

    It can call Gemini, so it needs household access and counts against the daily extraction limit.
    """
    ensure_household_access(actor, actor.household_id)
    if not extraction_allowed():
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Today's classification limit is reached.")
    record_extraction()
    return classify_impact_audio(body.description[:500])

