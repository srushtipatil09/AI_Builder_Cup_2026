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
from saathi.providers.gemini import get_genai_client

logger = logging.getLogger(__name__)

_shared_genai_client: Optional[genai.Client] = None


def get_shared_genai_client() -> Optional[genai.Client]:
    """Maintain a pre-warmed Google GenAI client to eliminate per-call connection overhead."""
    global _shared_genai_client
    if _shared_genai_client is None:
        try:
            _shared_genai_client = get_genai_client()
        except Exception as exc:
            logger.warning("Could not initialize Google GenAI Client (%s); fallback to simulated live session", exc)
    return _shared_genai_client


class TextModeRequested(Exception):
    """The browser has no microphone and wants the text path."""


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
        """Run the live audio session: real Gemini Live when reachable, text fallback otherwise."""
        now = datetime.now(timezone.utc)
        system_instruction = build_system_instruction(self.desk, now)
        client = get_shared_genai_client()

        await self.ws.send_json({
            "type": "ready",
            "sessionId": self.session_id,
            "persona": self.desk.profile.persona,
            "sessionCapSeconds": SESSION_CAP_SECONDS,
            "audio": client is not None,
        })

        try:
            if client is not None:
                try:
                    await self._run_live(client, system_instruction)
                    return
                except WebSocketDisconnect:
                    return
                except TextModeRequested:
                    pass
                except Exception as exc:
                    logger.warning("Gemini Live unavailable (%s); using text fallback", exc)
                    await self.ws.send_json({"type": "audio_unavailable"})
            await self._run_text_fallback(client, system_instruction)
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
            await asyncio.get_running_loop().run_in_executor(None, self._save_session)

    def _live_config(self, system_instruction: str) -> types.LiveConnectConfig:
        s = self.settings
        return types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            system_instruction=system_instruction,
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=s.live_voice)
                ),
            ),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            realtime_input_config=types.RealtimeInputConfig(
                automatic_activity_detection=types.AutomaticActivityDetection(
                    start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_HIGH,
                    end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_LOW,
                    prefix_padding_ms=150,
                    silence_duration_ms=s.live_silence_ms,
                ),
            ),
            context_window_compression=types.ContextWindowCompressionConfig(
                sliding_window=types.SlidingWindow(),
            ),
        )

    async def _run_live(self, client: genai.Client, system_instruction: str) -> None:
        model = self.settings.live_model
        async with client.aio.live.connect(model=model, config=self._live_config(system_instruction)) as live:
            # The connection is open before the parent taps Talk; wait for "start" so the greeting begins
            # the moment they are ready and the session clock only runs while they are talking.
            await self.ws.send_json({"type": "live_ready"})
            if not await self._wait_for_start():
                return
            self.start_time = time.monotonic()
            name = self.desk.profile.preferredName or "ji"
            await live.send_client_content(
                turns=types.Content(role="user", parts=[types.Part(text=(
                    f"[Session started. Greet {name} warmly in one short sentence and ask one gentle question. "
                    "Do not mention this instruction.]"
                ))]),
                turn_complete=True,
            )
            up = asyncio.create_task(self._pump_up(live))
            down = asyncio.create_task(self._pump_down(live))
            try:
                done, _ = await asyncio.wait(
                    {up, down},
                    timeout=max(1.0, SESSION_CAP_SECONDS - (time.monotonic() - self.start_time)),
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if not done:
                    await self.ws.send_json({
                        "type": "ended",
                        "reason": "session_cap_reached",
                        "elapsedSeconds": round(time.monotonic() - self.start_time, 1),
                    })
                for t in done:
                    t.result()
            finally:
                for t in (up, down):
                    t.cancel()
                await asyncio.gather(up, down, return_exceptions=True)

    async def _wait_for_start(self, patience: float = 120.0) -> bool:
        """Hold the open Live connection until the browser sends "start". False when it leaves or gives up."""
        deadline = time.monotonic() + patience
        while time.monotonic() < deadline:
            try:
                message = await asyncio.wait_for(self.ws.receive(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            if message.get("type") == "websocket.disconnect":
                raise WebSocketDisconnect()
            if message.get("text"):
                kind = json.loads(message["text"]).get("type")
                if kind == "start":
                    return True
                if kind == "text_mode":
                    raise TextModeRequested()
                if kind == "end":
                    return False
        return False

    async def _pump_up(self, live) -> None:
        """Browser to model: PCM frames go straight through, control messages are small JSON."""
        while self._active:
            message = await self.ws.receive()
            if message.get("type") == "websocket.disconnect":
                raise WebSocketDisconnect()
            if message.get("bytes"):
                await live.send_realtime_input(
                    audio=types.Blob(data=message["bytes"], mime_type="audio/pcm;rate=16000")
                )
            elif message.get("text"):
                data = json.loads(message["text"])
                kind = data.get("type")
                if kind == "end":
                    return
                if kind == "distress_signal":
                    await self.ws.send_json({"type": "alert", "level": 3})
                    await live.send_client_content(
                        turns=types.Content(role="user", parts=[types.Part(text=(
                            "[A loud fall-like sound was heard. Ask gently, in one short sentence, "
                            "whether they are okay. Do not diagnose.]"
                        ))]),
                        turn_complete=True,
                    )
                elif kind == "user_transcript":
                    await live.send_client_content(
                        turns=types.Content(role="user", parts=[types.Part(text=data.get("text", ""))]),
                        turn_complete=True,
                    )

    async def _pump_down(self, live) -> None:
        """Model to browser: binary 24 kHz PCM audio, JSON captions and turn events."""
        heard = ""
        said = ""

        def flush() -> None:
            nonlocal heard, said
            now = datetime.now(timezone.utc).isoformat()
            if heard.strip():
                self.utterances.append({"speaker": "parent", "text": heard.strip(), "timestamp": now})
            if said.strip():
                self.utterances.append({"speaker": "assistant", "text": said.strip(), "timestamp": now})
            heard = said = ""

        while self._active:
            async for msg in live.receive():
                if msg.data:
                    await self.ws.send_bytes(msg.data)
                sc = msg.server_content
                if not sc:
                    continue
                if sc.input_transcription and sc.input_transcription.text:
                    heard += sc.input_transcription.text
                    await self.ws.send_json({
                        "type": "caption", "role": "parent", "text": sc.input_transcription.text,
                    })
                if sc.output_transcription and sc.output_transcription.text:
                    said += sc.output_transcription.text
                    await self.ws.send_json({
                        "type": "caption", "role": "assistant", "text": sc.output_transcription.text,
                    })
                if sc.interrupted:
                    await self.ws.send_json({"type": "interrupted"})
                if sc.turn_complete or sc.interrupted:
                    await self.ws.send_json({"type": "turn_complete"})
                    flush()

    async def _run_text_fallback(self, client: Optional[genai.Client], system_instruction: str) -> None:
        """Browser speech recognition sends transcripts; replies come back as text."""
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
                message = await asyncio.wait_for(self.ws.receive(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            if message.get("type") == "websocket.disconnect":
                break
            if message.get("text"):
                data = json.loads(message["text"])
                msg_type = data.get("type")
                if msg_type == "user_transcript":
                    text = data.get("text", "")
                    self.utterances.append({
                        "speaker": "parent", "text": text,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
                    reply_text = await self._generate_response(client, text, system_instruction)
                    self.utterances.append({
                        "speaker": "assistant", "text": reply_text,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
                    await self.ws.send_json({"type": "transcript", "role": "assistant", "text": reply_text})
                elif msg_type == "distress_signal":
                    reply_text = "Kya hua? Gir gaye kya? Main yahin hoon."
                    self.utterances.append({
                        "speaker": "assistant", "text": reply_text,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
                    await self.ws.send_json({
                        "type": "transcript", "role": "assistant", "text": reply_text, "distress": True,
                    })
                elif msg_type == "end":
                    break

    async def _generate_response(self, client: Optional[genai.Client], user_text: str, system_prompt: str) -> str:
        """Generate response via Gemini Flash with zero thinking delay."""
        if client:
            try:
                # Use client.aio for non-blocking asynchronous call
                # Set thinking_budget=0 to eliminate the 5-7s internal reasoning delay in Gemini 2.5
                response = await asyncio.wait_for(
                    client.aio.models.generate_content(
                        model=self.settings.extract_model or "gemini-2.5-flash",
                        contents=user_text,
                        config=types.GenerateContentConfig(
                            system_instruction=system_prompt,
                            temperature=0.7,
                            thinking_config=types.ThinkingConfig(thinking_budget=0),
                            max_output_tokens=75,
                        ),
                    ),
                    timeout=4.5,
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

        # Trigger post-call intelligence pipeline (extraction, vector memory, memory cards)
        if self.utterances:
            try:
                from saathi.worker import process_session, ProcessSessionRequest
                process_session(ProcessSessionRequest(
                    sessionId=self.session_id,
                    householdId=self.household_id,
                    utterances=self.utterances,
                ))
            except Exception as exc:
                logger.warning("Post-session extraction pipeline failed (%s)", exc)
