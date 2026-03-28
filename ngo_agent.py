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

    def __init__(
        self,
        session: AgentSession,
        room: rtc.Room,
        livekit_api: api.LiveKitAPI,
        ctx: agents.JobContext,
        student_name: str | None = None,
        student_age: int | None = None,
        school_name: str | None = None,
        school_city: str | None = None,
    ) -> None:
        # Build a personalised context block to inject into the system prompt
        # Use cleaned names so the LLM doesn't see/repeat garbled DB values
        clean_name   = cfg.clean_student_name(student_name)
        clean_school = cfg.clean_school_name(school_name)

        context_lines = []
        if clean_name:
            context_lines.append(f"- Student's name: {clean_name}")
        if student_age:
            context_lines.append(f"- Student's age: {student_age} years old")
        if clean_school:
            context_lines.append(f"- School: {clean_school}" + (f", {school_city}" if school_city else ""))

        if context_lines:
            student_context = (
                "\n\n## This Call — Student Context\n"
                + "\n".join(context_lines)
                + "\n\nUse the student's name naturally once or twice during the call to make it feel personal. "
                "Reference their school when it helps build rapport."
            )
            effective_prompt = cfg.SYSTEM_PROMPT + student_context
        else:
            effective_prompt = cfg.SYSTEM_PROMPT

        super().__init__(
            instructions=effective_prompt,
            stt=_build_stt(),
            llm=_build_llm(),
            tts=_build_tts(cfg.TTS_DEFAULT_LANGUAGE),
        )
        self._session      = session
        self._room         = room
        self._livekit_api  = livekit_api
        self._ctx          = ctx
        self._student_name = student_name
        self._student_age  = student_age
        self._school_name  = school_name
        self._school_city  = school_city
        self._current_lang: str = cfg.TTS_DEFAULT_LANGUAGE
        self._turn_start_ms: int = 0
        self._last_transcript: str = ""

        # ── Language debounce: require 2 consecutive turns in same language ──
        # before committing a permanent TTS switch.  This prevents single-word
        # noise detections (e.g. "gu-IN" from one ambiguous utterance) from
        # derailing the conversation language permanently.
        self._pending_lang: str = cfg.TTS_DEFAULT_LANGUAGE  # candidate to switch to
        self._lang_streak: int = 0                          # consecutive turns in pending_lang

        # ── End-call flag ────────────────────────────────────────────────────
        # Set to True when [END_CALL] marker is detected in tts_node.
        # on_agent_state_changed watches for speaking → listening transition
        # and deletes the room only after TTS audio has fully played out.
        self._end_call_pending: bool = False

        # Hook into session events
        session.on("user_input_transcribed", self._on_transcribed)
        session.on("agent_state_changed", self._on_agent_state_changed)

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
        """
        Map a raw Sarvam STT language code to one of the three supported TTS
        languages: hi-IN, en-IN, te-IN.

        Students are school girls from central/south India — they will only
        ever speak Hindi, English, or Telugu.  Any other detected language is
        noise / misdetection and must be remapped:
          • North/central Indian scripts (gu, mr, bn, pa, ur, mai, …) → hi-IN
            (these overlap with Hindi phonetically and are nearby dialects)
          • South Indian scripts outside Telugu (ta, kn, ml, …) → en-IN
            (these students are more likely bilingual Hindi/English or English)
          • Unrecognised / 'unknown' → keep current language (no flip)
        """
        if not stt_lang_code or stt_lang_code in ("unknown", ""):
            return self._current_lang

        prefix = stt_lang_code.split("-")[0].lower()

        # Primary supported languages — pass through directly
        PRIMARY = {"hi": "hi-IN", "en": "en-IN", "te": "te-IN"}
        if prefix in PRIMARY:
            return PRIMARY[prefix]

        # Non-Telugu south Indian scripts → fallback to English
        SOUTH_INDIAN_NON_TELUGU = {"ta", "kn", "ml"}
        if prefix in SOUTH_INDIAN_NON_TELUGU:
            logger.info(f"[Lang] remapping {stt_lang_code} (south non-Telugu) → en-IN")
            return "en-IN"

        # All other Indian languages (gu, mr, bn, pa, ur, or, as, mai, kok, …) → Hindi
        # These are either close to Hindi or are noise misdetections
        logger.info(f"[Lang] remapping {stt_lang_code} (non-primary) → hi-IN")
        return "hi-IN"

    # ── Transcript event handler (runs sync, schedules async work) ───────────
    def _on_transcribed(self, ev: UserInputTranscribedEvent) -> None:
        if not ev.is_final:
            return

        detected_lang_raw = ev.language or ""
        transcript        = ev.transcript or ""
        self._last_transcript = transcript
        self._turn_start_ms   = int(time.time() * 1000)

        resolved = self._resolve_tts_lang(detected_lang_raw)

        # ── Language debounce ────────────────────────────────────────────────
        # We require LANG_SWITCH_THRESHOLD consecutive turns in the same new
        # language before committing a TTS switch.  This prevents a single
        # ambiguous utterance (e.g. one Gujarati-looking word) from derailing
        # the active language for all subsequent replies.
        LANG_SWITCH_THRESHOLD = 2

        if resolved == self._current_lang:
            # Continuing in the same language — reset the streak counter
            self._pending_lang = resolved
            self._lang_streak  = 0
            lang_switched = False
        elif resolved == self._pending_lang:
            # Another turn in the same candidate language — increment streak
            self._lang_streak += 1
            if self._lang_streak >= LANG_SWITCH_THRESHOLD:
                # Threshold met — commit the switch
                lang_switched = True
                logger.info(
                    f"[Lang] debounce threshold met ({self._lang_streak}/{LANG_SWITCH_THRESHOLD}), "
                    f"switching TTS {self._current_lang} → {resolved}"
                )
                self._current_lang = resolved
                self._lang_streak  = 0
                new_tts = _build_tts(resolved)
                self._tts = new_tts
                self._session._tts = new_tts
                logger.info(f"[TTS] switched to {resolved} (sync, debounced)")
            else:
                # Not enough consecutive turns yet — use current TTS for this reply
                lang_switched = False
                logger.info(
                    f"[Lang] debounce pending {resolved} streak={self._lang_streak}/{LANG_SWITCH_THRESHOLD}"
                    f" — keeping TTS {self._current_lang} for now"
                )
        else:
            # Different candidate language — reset streak and record new candidate
            self._pending_lang = resolved
            self._lang_streak  = 1
            lang_switched = False
            logger.info(
                f"[Lang] debounce: new candidate {resolved} (streak reset) "
                f"— keeping TTS {self._current_lang}"
            )

        new_lang = self._current_lang  # actual TTS language used for this turn

        logger.info(
            f"[STT] transcript='{transcript}' lang_raw='{detected_lang_raw}' → {resolved}"
            + (" [SWITCH]" if lang_switched else "")
        )

        asyncio.ensure_future(self._emit(
            "stt",
            transcript=transcript,
            language_raw=detected_lang_raw,
            language_resolved=new_lang,
            lang_switched=lang_switched,
            confidence=0.0,
        ))

    async def _switch_tts_language(self, lang: str) -> None:
        # Kept for compatibility — direct sync swap is used in _on_transcribed now
        try:
            new_tts = _build_tts(lang)
            self._tts = new_tts
            self._session._tts = new_tts
            logger.info(f"[TTS] switched to {lang}")
        except Exception as e:
            logger.warning(f"[TTS-update] {e}")

    # ── Agent state change: delete room after speaking ends ──────────────────
    def _on_agent_state_changed(self, ev) -> None:
        """
        Watch for the speaking → listening/idle transition.
        When _end_call_pending is True (set by tts_node after stripping [END_CALL]),
        this means the closing TTS has fully finished playing — safe to delete the room.
        """
        new_state = ev.new_state if hasattr(ev, "new_state") else str(ev)
        if self._end_call_pending and new_state in ("listening", "idle"):
            self._end_call_pending = False
            logger.info(
                f"[NGO] Agent finished speaking (state={new_state}) — "
                f"deleting room {self._room.name} to send SIP BYE"
            )
            self._ctx.delete_room()

    # ── tts_node: guard against script/language mismatch + [END_CALL] detection ──
    async def tts_node(self, text: AsyncIterable[str], model_settings: Any):
        """
        Intercept TTS text stream to:
        1. Detect output script and override TTS language if needed.
        2. Strip [END_CALL] marker and schedule room deletion after audio finishes.

        The LLM is instructed to append [END_CALL] at the end of its closing
        message.  We strip it here before TTS synthesizes it (so it's never
        spoken aloud) and schedule ctx.delete_room() which sends SIP BYE.
        """
        import re
        import unicodedata

        # Buffer the entire LLM output text
        chunks: list[str] = []
        async for chunk in text:
            chunks.append(chunk)

        accumulated = "".join(chunks)

        # ── [END_CALL] detection ─────────────────────────────────────────────
        end_call_triggered = bool(re.search(r'\[END_CALL\]', accumulated, re.IGNORECASE))
        if end_call_triggered:
            # Strip the marker (and any surrounding whitespace) from spoken text
            accumulated = re.sub(r'\s*\[END_CALL\]\s*', '', accumulated, flags=re.IGNORECASE).strip()
            logger.info("[NGO] [END_CALL] marker detected — will delete room after TTS finishes")
            # Set flag: _on_agent_state_changed will fire delete_room() once the
            # agent transitions from 'speaking' back to 'listening'/'idle' — meaning
            # the full closing audio has played out on the phone before BYE is sent.
            self._end_call_pending = True
            # Rebuild chunks from cleaned text (marker stripped)
            chunks = [accumulated] if accumulated else []

        # ── Script / language detection ──────────────────────────────────────
        if accumulated:
            latin = sum(
                1 for c in accumulated
                if unicodedata.category(c).startswith('L') and ord(c) < 128
            )
            total_letters = sum(
                1 for c in accumulated
                if unicodedata.category(c).startswith('L')
            )
            ratio = latin / max(total_letters, 1)
            is_english = total_letters > 0 and ratio > 0.7

            if is_english and self._current_lang not in ("en-IN", "en-US"):
                logger.info(
                    f"[TTS] LLM replied in English (ratio={ratio:.2f}) "
                    f"but TTS lang={self._current_lang}; overriding → en-IN for this turn"
                )
                new_tts = _build_tts("en-IN")
                self._tts = new_tts
                self._session._tts = new_tts
                self._current_lang = "en-IN"
                self._pending_lang = "en-IN"
                self._lang_streak  = 0

        # Yield the buffered chunks as an async generator
        async def _replay() -> AsyncIterable[str]:
            for c in chunks:
                yield c

        return Agent.default.tts_node(self, _replay(), model_settings)

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

    # Extract student personalisation fields from metadata
    student_name: str | None = meta.get("student_name") or meta.get("participant_name") or None
    student_age_raw = meta.get("student_age")
    student_age: int | None = int(student_age_raw) if student_age_raw is not None else None
    school_name: str | None = meta.get("school_name") or None
    school_city: str | None = meta.get("school_city") or None

    # Sanitise "student" placeholder to None so it's not used as a real name
    if student_name and student_name.strip().lower() == "student":
        student_name = None

    logger.info(
        f"[NGO] phone={phone_number} student={student_name} age={student_age} "
        f"school={school_name} city={school_city}"
    )

    # ── Pre-determine SIP identity so RoomIO links to it before participant connects ─
    sip_identity: str | None = (
        f"sip_{phone_number}" if phone_number else None
    )

    # ── Build session ────────────────────────────────────────────────────────
    session = AgentSession(
        vad=silero.VAD.load(),
    )

    assistant = NGOAssistant(
        session=session,
        room=ctx.room,
        livekit_api=ctx.api,
        ctx=ctx,
        student_name=student_name,
        student_age=student_age,
        school_name=school_name,
        school_city=school_city,
    )

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

        # Speak the opening line (Hindi by default), personalised if we have student info
        greeting = cfg.build_greeting(student_name, school_name)
        await session.generate_reply(instructions=greeting)

    else:
        # VoIP / inbound mode — greet immediately
        logger.info("[NGO] VoIP / inbound mode — greeting")
        greeting = cfg.build_greeting(student_name, school_name)
        await session.generate_reply(instructions=greeting)


# ─── Entry point ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=cfg.AGENT_NAME,   # "ngo-caller"
        )
    )
