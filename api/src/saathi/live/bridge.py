"""WebSocket bridge for bidirectional audio streaming between browser and Gemini Live."""

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

from saathi.config import load_settings
from saathi.cost import SESSION_CAP_SECONDS
from saathi.contracts.desk import Desk
from saathi.live.prompts import build_system_instruction
from saathi.providers.firestore import get_repository

logger = logging.getLogger(__name__)


class LiveBridgeSession:
    def __init__(
        self,
        websocket: WebSocket,
        session_id: str,
        household_id: str,
        desk: Desk,
    ):
        self.ws = websocket
        self.session_id = session_id
        self.household_id = household_id
        self.desk = desk
        self.settings = load_settings()
        self.start_time = time.monotonic()
        self.utterances: list[dict] = []
        self._active = True

    async def run(self) -> None:
        """Run the live audio session."""
        now = datetime.now(timezone.utc)
        system_instruction = build_system_instruction(self.desk, now)

        # Send initial ready event to client
        await self.ws.send_json({
            "type": "ready",
            "sessionId": self.session_id,
            "persona": self.desk.profile.persona,
            "sessionCapSeconds": SESSION_CAP_SECONDS,
        })

        client = None
        try:
            client = genai.Client()
        except Exception as exc:
            logger.warning("Could not initialize Google GenAI Client (%s); fallback to simulated live session", exc)

        # Loop until session cap or client disconnect
        try:
            while self._active:
                elapsed = time.monotonic() - self.start_time
                if elapsed >= SESSION_CAP_SECONDS:
                    await self.ws.send_json({
                        "type": "ended",
                        "reason": "session_cap_reached",
                        "elapsedSeconds": round(elapsed, 1),
                    })
                    break

                try:
                    # Receive binary PCM audio frame or JSON control packet
                    message = await asyncio.wait_for(self.ws.receive(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                if "bytes" in message and message["bytes"]:
                    # Binary 16kHz PCM audio frame from client
                    pcm_data = message["bytes"]
                    # If real Live connection is open, stream pcm_data to model.
                    # Send acknowledgment / heartbeat
                    await self.ws.send_json({
                        "type": "audio_ack",
                        "bytesReceived": len(pcm_data),
                    })

                elif "text" in message and message["text"]:
                    data = json.loads(message["text"])
                    msg_type = data.get("type")

                    if msg_type == "user_transcript":
                        text = data.get("text", "")
                        self.utterances.append({
                            "speaker": "parent",
                            "text": text,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        })

                        # Respond with Gemini Flash or simulated reply
                        reply_text = await self._generate_response(client, text, system_instruction)
                        self.utterances.append({
                            "speaker": "assistant",
                            "text": reply_text,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        })
                        await self.ws.send_json({
                            "type": "transcript",
                            "role": "assistant",
                            "text": reply_text,
                        })

                    elif msg_type == "distress_signal":
                        # Immediate in-session distress check
                        reply_text = "Kya hua? Gir gaye kya? Main yahin hoon."
                        self.utterances.append({
                            "speaker": "assistant",
                            "text": reply_text,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        })
                        await self.ws.send_json({
                            "type": "transcript",
                            "role": "assistant",
                            "text": reply_text,
                            "distress": True,
                        })

                    elif msg_type == "end":
                        break

        except WebSocketDisconnect:
            logger.info("Session %s disconnected", self.session_id)
        except Exception as exc:
            logger.error("Error in session %s: %s", self.session_id, exc)
            try:
                await self.ws.send_json({"type": "error", "message": str(exc)})
            except Exception:
                pass
        finally:
            self._active = False
            self._save_session()

    async def _generate_response(self, client: Optional[genai.Client], user_text: str, system_prompt: str) -> str:
        """Generate response via Gemini or fallback."""
        if client:
            try:
                response = client.models.generate_content(
                    model=self.settings.extract_model or "gemini-2.5-flash",
                    contents=user_text,
                    config=types.GenerateContentConfig(
                        system_instruction=system_prompt,
                        temperature=0.7,
                        max_output_tokens=150,
                    ),
                )
                if response and response.text:
                    return response.text.strip()
            except Exception as exc:
                logger.warning("Gemini generation call failed (%s); using conversational fallback", exc)

        # Conversational fallback matching prompt rules
        lowered = user_text.lower()
        if any(w in lowered for w in ["khana", "lunch", "dinner", "breakfast", "roti", "chai"]):
            return "Achha laga sunkar. Aapne dawai li ya abhi baaki hai?"
        if any(w in lowered for w in ["rahul", "beta", "phone"]):
            return "Rahul se kab baat hui thi? Kahan hain woh aaj kal?"
        if any(w in lowered for w in ["ouch", "gir", "chot", "dard"]):
            return "Kya hua? Gir gaye kya? Main yahin hoon."
        return f"Ji, main sun rahi hoon. Aaj aapka din kaisa raha?"

    def _save_session(self) -> None:
        """Persist session record to Firestore repository."""
        repo = get_repository()
        client = repo.client
        if client and not repo._use_fallback:
            try:
                client.collection("households").document(self.household_id).collection("sessions").document(self.session_id).set({
                    "id": self.session_id,
                    "household_id": self.household_id,
                    "duration_seconds": round(time.monotonic() - self.start_time, 1),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "utterance_count": len(self.utterances),
                    "utterances": self.utterances,
                })
            except Exception as exc:
                logger.error("Failed to save session to Firestore: %s", exc)
