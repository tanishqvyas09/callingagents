"""
NGO Agent — Making the Difference / Team Lajja
Menstrual Hygiene Awareness & Feedback Survey

Features:
  • Sarvam saaras:v3 STT with auto language detection (hi/en/te/…)
  • Groq LLM (openai/gpt-oss-120b) via OpenAI-compatible API
  • Sarvam bulbul:v3-beta TTS speaker=shubh, language switches per turn dynamically
  • Outbound SIP calls via Vobiz trunk
  • Real-time analytics events emitted over LiveKit data channel
    (transcript, detected language, LLM response, TTS params, latencies)

Run:
    python ngo_agent.py start
"""

import os
import time
import json
import asyncio
import logging
import certifi
from typing import Any, AsyncIterable

os.environ["SSL_CERT_FILE"] = certifi.where()

from dotenv import load_dotenv
load_dotenv(".env")

from livekit import agents, api, rtc
from livekit.agents import AgentSession, Agent, RoomInputOptions
from livekit.agents.voice.events import UserInputTranscribedEvent
from livekit.plugins import sarvam, openai, silero, noise_cancellation
from livekit.plugins.sarvam.stt import SpeechStream as _SarvamSpeechStream
from livekit.agents import llm
from livekit.agents.voice.room_io import RoomOptions, AudioInputOptions

import ngo_config as cfg

# ─── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ngo-agent")


# ─── Analytics Event Schema ───────────────────────────────────────────────────
def _analytics_event(event_type: str, **payload) -> bytes:
    """Serialize an analytics event to bytes for the LiveKit data channel."""
    return json.dumps({
        "type": event_type,
        "ts_ms": int(time.time() * 1000),
        **payload,
    }).encode()


# ─── TTS Factory ─────────────────────────────────────────────────────────────
def _build_tts(language_code: str = None) -> sarvam.TTS:
    lang = language_code or cfg.TTS_DEFAULT_LANGUAGE
    logger.info(f"[TTS] building bulbul:v3-beta speaker={cfg.TTS_SPEAKER} lang={lang}")
    return sarvam.TTS(
        model=cfg.TTS_MODEL,
        speaker=cfg.TTS_SPEAKER,
        target_language_code=lang,
        api_key=os.getenv("SARVAM_API_KEY"),
    )


# ─── Sarvam STT plugin bug-fix ────────────────────────────────────────────────
# The plugin sets _audio_encoding = input_audio_codec (e.g. "pcm_s16le"), but
# the Sarvam API requires encoding="audio/wav" in the JSON audio message body.
# input_audio_codec=pcm_s16le must appear only in the WebSocket URL, not the body.
# Fix: subclass SpeechStream so _audio_encoding is always "audio/wav" after init,
# and override STT.stream() to return our fixed stream class.
class _FixedSpeechStream(_SarvamSpeechStream):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._audio_encoding = "audio/wav"   # Sarvam API body always requires "audio/wav"


class _FixedSTT(sarvam.STT):
    """sarvam.STT with audio message encoding bug fixed.

    Bug: plugin sets _audio_encoding = input_audio_codec which breaks the Sarvam
    API — the JSON audio body must have encoding='audio/wav' while the URL carries
    input_audio_codec=pcm_s16le to indicate the binary format to the server.
    """
    def stream(self, **kwargs):
        base_stream = super().stream(**kwargs)
        # Replace with our fixed class that enforces correct encoding in the body
        base_stream.__class__ = _FixedSpeechStream
        base_stream._audio_encoding = "audio/wav"
        return base_stream


# ─── STT Factory ─────────────────────────────────────────────────────────────
def _build_stt() -> sarvam.STT:
    logger.info("[STT] building saaras:v3 language=unknown (auto-detect)")
    return _FixedSTT(
        model=cfg.STT_MODEL,
        language=cfg.STT_LANGUAGE,        # "unknown" → auto-detect
        sample_rate=16000,                # must match audio_sample_rate in RoomInputOptions
        input_audio_codec="pcm_s16le",   # URL param only — tells server the binary codec
        high_vad_sensitivity=True,        # better VAD sensitivity for telephony audio
        api_key=os.getenv("SARVAM_API_KEY"),
    )


# ─── LLM Factory ─────────────────────────────────────────────────────────────
def _build_llm() -> openai.LLM:
    logger.info(f"[LLM] building Groq {cfg.LLM_MODEL}")
    return openai.LLM(
        base_url=cfg.LLM_BASE_URL,
        api_key=os.getenv("GROQ_API_KEY"),
        model=cfg.LLM_MODEL,
        temperature=cfg.LLM_TEMPERATURE,
    )


# ─── NGO Agent ───────────────────────────────────────────────────────────────
class NGOAssistant(Agent):
    """
    Team Lajja feedback survey agent.

    Language switching is done via session's 'user_input_transcribed' event —
    no stt_node/tts_node override needed (those broke the audio pipeline).
    Analytics are emitted via LiveKit data channel to the dashboard.
    """

    def __init__(self, session: AgentSession, room: rtc.Room) -> None:
        super().__init__(
            instructions=cfg.SYSTEM_PROMPT,
            stt=_build_stt(),
            llm=_build_llm(),
            tts=_build_tts(cfg.TTS_DEFAULT_LANGUAGE),
        )
        self._session     = session
        self._room        = room
        self._current_lang: str = cfg.TTS_DEFAULT_LANGUAGE
        self._turn_start_ms: int = 0
        self._last_transcript: str = ""

        # Hook into session transcript event for language detection
        session.on("user_input_transcribed", self._on_transcribed)

    # ── Data channel helper ──────────────────────────────────────────────────
    async def _emit(self, event_type: str, **payload):
        try:
            data = _analytics_event(event_type, **payload)
            await self._room.local_participant.publish_data(
                data, reliable=True, topic="ngo-analytics"
            )
        except Exception as e:
            logger.warning(f"[Analytics] publish failed: {e}")

    # ── Language resolution ──────────────────────────────────────────────────
    def _resolve_tts_lang(self, stt_lang_code: str) -> str:
        if not stt_lang_code or stt_lang_code in ("unknown", ""):
            return self._current_lang
        prefix = stt_lang_code.split("-")[0].lower()
        return cfg.LANGUAGE_MAP.get(prefix, self._current_lang)

    # ── Transcript event handler (runs sync, schedules async work) ───────────
    def _on_transcribed(self, ev: UserInputTranscribedEvent) -> None:
        if not ev.is_final:
            return

        detected_lang_raw = ev.language or ""
        transcript        = ev.transcript or ""
        self._last_transcript = transcript
        self._turn_start_ms   = int(time.time() * 1000)

        new_lang     = self._resolve_tts_lang(detected_lang_raw)
        lang_switched = new_lang != self._current_lang

        logger.info(
            f"[STT] transcript='{transcript}' lang_raw='{detected_lang_raw}' → {new_lang}"
            + (" [SWITCH]" if lang_switched else "")
        )

        if lang_switched:
            logger.info(f"[Lang] switching TTS {self._current_lang} → {new_lang}")
            self._current_lang = new_lang
            asyncio.ensure_future(self._switch_tts_language(new_lang))

        asyncio.ensure_future(self._emit(
            "stt",
            transcript=transcript,
            language_raw=detected_lang_raw,
            language_resolved=new_lang,
            lang_switched=lang_switched,
            confidence=0.0,
        ))

    async def _switch_tts_language(self, lang: str) -> None:
        try:
            new_tts = _build_tts(lang)
            # AgentActivity.tts returns self._agent.tts when is_given(), else session._tts.
            # Updating both ensures the active pipeline and future activities see the new TTS.
            self._tts = new_tts          # Agent._tts — used by the running AgentActivity
            self._session._tts = new_tts  # AgentSession._tts — fallback for new activities
            logger.info(f"[TTS] switched to {lang}")
        except Exception as e:
            logger.warning(f"[TTS-update] {e}")

    # ── tts_node: guard against script/language mismatch ────────────────────
    async def tts_node(self, text: AsyncIterable[str], model_settings: Any):
        """
        Intercept TTS text stream to detect output language and ensure the
        TTS target_language_code matches the script being synthesized.

        Sarvam TTS throws "Text must contain at least one character from the
        allowed languages" when target_language_code (e.g. 'kn-IN') doesn't
        match the script of the text (e.g. English).  We buffer the first
        ~80 characters, detect if it's Latin-script (English), and if so
        hot-swap the TTS to en-IN for this turn only.
        """
        import unicodedata

        buffer: list[str] = []
        buf_done = False

        # Accumulate enough text to detect script, then yield everything
        async def _detected_stream() -> AsyncIterable[str]:
            nonlocal buf_done

            accumulated = ""
            SAMPLE_LEN = 80

            async for chunk in text:
                if len(accumulated) < SAMPLE_LEN:
                    accumulated += chunk
                    buffer.append(chunk)
                    if len(accumulated) >= SAMPLE_LEN:
                        # Enough text — detect script now
                        latin = sum(1 for c in accumulated if unicodedata.category(c).startswith('L') and ord(c) < 128)
                        total_letters = sum(1 for c in accumulated if unicodedata.category(c).startswith('L'))
                        is_english = total_letters == 0 or (latin / max(total_letters, 1)) > 0.8

                        if is_english and self._current_lang not in ("en-IN", "en-US"):
                            logger.info(f"[TTS] LLM replied in English but lang={self._current_lang}; overriding TTS→en-IN for this turn")
                            new_tts = _build_tts("en-IN")
                            self._tts = new_tts
                            self._session._tts = new_tts

                        buf_done = True
                        for c in buffer:
                            yield c
                else:
                    yield chunk

            if not buf_done:
                # Text ended before we hit SAMPLE_LEN — still yield buffered
                for c in buffer:
                    yield c

        return Agent.default.tts_node(self, _detected_stream(), model_settings)

    # ── on_user_turn_completed ───────────────────────────────────────────────
    async def on_user_turn_completed(
        self,
        turn_ctx: llm.ChatContext,
        new_message: llm.ChatMessage,
    ) -> None:
        llm_start_ms   = int(time.time() * 1000)
        llm_latency_ms = llm_start_ms - self._turn_start_ms if self._turn_start_ms else 0

        asyncio.ensure_future(self._emit(
            "user_turn",
            transcript=new_message.text_content or self._last_transcript,
            language=self._current_lang,
            llm_latency_ms=llm_latency_ms,
        ))


# ─── Entrypoint ───────────────────────────────────────────────────────────────
async def entrypoint(ctx: agents.JobContext):
    logger.info(f"[NGO] Connecting to room: {ctx.room.name}")

    # ── Parse metadata ──────────────────────────────────────────────────────
    phone_number: str | None = None
    meta: dict = {}

    for source in [ctx.job.metadata, ctx.room.metadata]:
        try:
            if source:
                data = json.loads(source)
                meta.update(data)
                if data.get("phone_number"):
                    phone_number = data["phone_number"]
        except Exception:
            pass

    logger.info(f"[NGO] phone_number={phone_number}  meta={meta}")

    # ── Pre-determine SIP identity so RoomIO links to it before participant connects ─
    sip_identity: str | None = (
        f"sip_{phone_number}" if phone_number else None
    )

    # ── Build session ────────────────────────────────────────────────────────
    session = AgentSession(
        vad=silero.VAD.load(),
    )

    assistant = NGOAssistant(session=session, room=ctx.room)

    # Use RoomOptions (non-deprecated) for explicit AudioInputOptions control.
    # Do NOT pre-set participant_identity here — it causes a livekit 1.4.3 bug where
    # set_participant() is called before room connects. We set it after dial instead.
    audio_input_opts = AudioInputOptions(
        sample_rate=16000,                              # match Sarvam STT
        noise_cancellation=noise_cancellation.BVCTelephony(),
        pre_connect_audio=True,
    )
    room_opts = RoomOptions(
        audio_input=audio_input_opts,
        close_on_disconnect=True,
    )

    await session.start(
        room=ctx.room,
        agent=assistant,
        room_options=room_opts,
    )

    # ── Emit session-start analytics ─────────────────────────────────────────
    await assistant._emit(
        "session_start",
        phone_number=phone_number or "voip",
        ngo=cfg.NGO_NAME,
        team=cfg.TEAM_NAME,
        stt_model=cfg.STT_MODEL,
        llm_model=cfg.LLM_MODEL,
        tts_model=cfg.TTS_MODEL,
        tts_speaker=cfg.TTS_SPEAKER,
        default_language=cfg.TTS_DEFAULT_LANGUAGE,
    )

    # ── Determine dial mode ──────────────────────────────────────────────────
    if phone_number:
        # Check if SIP user already in room (dashboard pre-dispatched)
        already_in_room = any(
            "sip_" in p.identity
            for p in ctx.room.remote_participants.values()
        )

        if not already_in_room:
            logger.info(f"[NGO] Dialling {phone_number} via SIP trunk {cfg.SIP_TRUNK_ID}")
            try:
                await ctx.api.sip.create_sip_participant(
                    api.CreateSIPParticipantRequest(
                        room_name=ctx.room.name,
                        sip_trunk_id=cfg.SIP_TRUNK_ID,
                        sip_call_to=phone_number,
                        participant_identity=sip_identity,
                        wait_until_answered=True,
                    )
                )
                logger.info("[NGO] Call answered — generating greeting")
                await assistant._emit("call_answered", phone_number=phone_number)

                # Explicitly bind audio input to the SIP participant now that it's in
                # the room. This avoids the race between track_subscribed and the
                # _participant_available_fut being resolved in _init_task.
                if session._room_io and sip_identity:
                    logger.info(f"[NGO] Binding audio input to {sip_identity}")
                    session._room_io.set_participant(sip_identity)

            except Exception as e:
                logger.error(f"[NGO] Dial failed: {e}")
                await assistant._emit("call_failed", error=str(e))
                ctx.shutdown()
                return
        else:
            # Already in room — still bind to the existing SIP participant
            existing_sip = next(
                (p.identity for p in ctx.room.remote_participants.values() if "sip_" in p.identity),
                None,
            )
            if session._room_io and existing_sip:
                logger.info(f"[NGO] Binding to existing SIP participant {existing_sip}")
                session._room_io.set_participant(existing_sip)

        # Speak the opening line (Hindi by default)
        await session.generate_reply(instructions=cfg.INITIAL_GREETING)

    else:
        # VoIP / inbound mode — greet immediately
        logger.info("[NGO] VoIP / inbound mode — greeting")
        await session.generate_reply(instructions=cfg.FALLBACK_GREETING)


# ─── Entry point ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=cfg.AGENT_NAME,   # "ngo-caller"
        )
    )
