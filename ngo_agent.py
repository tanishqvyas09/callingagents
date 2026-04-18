"""
NGO Agent — Making the Difference / Team Lajja
Menstrual Hygiene Awareness & Feedback Survey

Features:
  • Google Gemini Live (gemini-3.1-flash-live-preview) — unified STT + LLM + TTS
    via RealtimeModel (audio in → audio out, no separate Sarvam/Groq pipeline)
  • Outbound SIP calls via Vobiz trunk
  • Real-time analytics events emitted over LiveKit data channel
    (transcript, detected language, LLM response, TTS params, latencies)

Run:
    python ngo_agent.py start
"""

import os
import time
import json
import wave
import asyncio
import logging
import certifi
from typing import Any  # noqa: used in on_user_turn_completed signature

os.environ["SSL_CERT_FILE"] = certifi.where()

from dotenv import load_dotenv
load_dotenv(".env")

import aiohttp

from livekit import agents, api, rtc
from livekit.agents import AgentSession, Agent
from livekit.agents.voice.events import UserInputTranscribedEvent, ConversationItemAddedEvent
from livekit.plugins import noise_cancellation
from livekit.plugins.google.realtime import RealtimeModel
from livekit.agents import llm
from livekit.agents.voice.room_io import RoomOptions, AudioInputOptions
from google.genai import types as genai_types

import ngo_config as cfg

# ─── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ngo-agent")

# ─── Supabase S3 config (for LiveKit Egress → voice_recording bucket) ────────
SUPABASE_S3_ACCESS_KEY  = os.getenv("SUPABASE_S3_ACCESS_KEY", "")
SUPABASE_S3_SECRET      = os.getenv("SUPABASE_S3_SECRET", "")
SUPABASE_S3_ENDPOINT    = os.getenv("SUPABASE_S3_ENDPOINT", "")
SUPABASE_S3_REGION      = os.getenv("SUPABASE_S3_REGION", "us-east-1")
SUPABASE_STORAGE_BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "voice_recording")
SUPABASE_URL            = os.getenv("SUPABASE_URL", "")

# ── Dashboard URL (for calling /api/ngo-analyze after each call) ─────────────
DASHBOARD_BASE_URL = os.getenv("DASHBOARD_BASE_URL", "http://localhost:3000")


# ─── Analytics Event Schema ───────────────────────────────────────────────────
def _analytics_event(event_type: str, **payload) -> bytes:
    """Serialize an analytics event to bytes for the LiveKit data channel."""
    return json.dumps({
        "type": event_type,
        "ts_ms": int(time.time() * 1000),
        **payload,
    }).encode()


# ─── Gemini Live RealtimeModel Factory ───────────────────────────────────────
# gemini-3.1-flash-live-preview: unified STT + LLM + TTS in one WebSocket session.
# • input_audio_transcription  → fires UserInputTranscribedEvent for language detection
# • output_audio_transcription → fires ConversationItemAddedEvent with agent text
#   (used for [END_CALL] detection and conversation logging)
def _build_realtime_model(instructions: str) -> RealtimeModel:
    logger.info(f"[Gemini] building RealtimeModel model={cfg.GEMINI_MODEL} voice={cfg.TTS_VOICE}")
    return RealtimeModel(
        model=cfg.GEMINI_MODEL,
        voice=cfg.TTS_VOICE,
        api_key=os.getenv("GOOGLE_API_KEY"),
        instructions=instructions,
        # No hardcoded language= hint — Gemini Live auto-detects the student's
        # language from audio and responds in kind (per the system prompt instruction).
        # Forcing a BCP-47 code here biases the model away from other languages.
        input_audio_transcription=genai_types.AudioTranscriptionConfig(),
        output_audio_transcription=genai_types.AudioTranscriptionConfig(),
        temperature=0.7,   # slightly higher than 0.3 → more natural, less robotic replies
    )


# ─── Hello-audio playback ─────────────────────────────────────────────────────
HELLO_WAV_PATH = os.path.join(os.path.dirname(__file__), "assets", "hello_hi.wav")
_HELLO_CHUNK_MS = 20   # 20ms frames — standard for WebRTC / LiveKit


async def play_hello_audio(room: rtc.Room) -> None:
    """
    Play assets/hello_hi.wav into the LiveKit room immediately after the call
    is answered — before Gemini Live's first generate_reply fires.

    The WAV must be 24 kHz, mono, 16-bit PCM (produced by generate_hello_audio.py).
    We publish a short-lived AudioSource track, push all frames, then unpublish.
    This gives the student an instant warm greeting (~300ms after answer) while
    the Gemini WebSocket session warms up in parallel.
    """
    if not os.path.exists(HELLO_WAV_PATH):
        logger.warning(f"[Hello] WAV not found at {HELLO_WAV_PATH} — skipping pre-recorded greeting")
        return

    try:
        with wave.open(HELLO_WAV_PATH, "rb") as wf:
            sample_rate   = wf.getframerate()   # 24000
            num_channels  = wf.getnchannels()   # 1
            sample_width  = wf.getsampwidth()   # 2  (16-bit)
            raw_pcm       = wf.readframes(wf.getnframes())

        frames_per_chunk = int(sample_rate * _HELLO_CHUNK_MS / 1000)
        bytes_per_chunk  = frames_per_chunk * num_channels * sample_width
        samples_per_chunk = frames_per_chunk * num_channels

        source = rtc.AudioSource(sample_rate=sample_rate, num_channels=num_channels)
        track  = rtc.LocalAudioTrack.create_audio_track("hello-greeting", source)
        pub_opts = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        publication = await room.local_participant.publish_track(track, pub_opts)

        logger.info(f"[Hello] Playing greeting WAV ({len(raw_pcm)} bytes, {sample_rate}Hz)")

        offset = 0
        while offset < len(raw_pcm):
            chunk = raw_pcm[offset: offset + bytes_per_chunk]
            if not chunk:
                break
            # Pad last chunk with silence if needed
            if len(chunk) < bytes_per_chunk:
                chunk = chunk + b'\x00' * (bytes_per_chunk - len(chunk))
            frame = rtc.AudioFrame(
                data=chunk,
                sample_rate=sample_rate,
                num_channels=num_channels,
                samples_per_channel=samples_per_chunk,
            )
            await source.capture_frame(frame)
            offset += bytes_per_chunk

        # Small tail-silence so the last syllable doesn't get clipped
        silence = b'\x00' * bytes_per_chunk * 5
        frame = rtc.AudioFrame(
            data=silence,
            sample_rate=sample_rate,
            num_channels=num_channels,
            samples_per_channel=samples_per_chunk,
        )
        await source.capture_frame(frame)

        await room.local_participant.unpublish_track(publication.sid)
        logger.info("[Hello] Greeting WAV playback complete")

    except Exception as e:
        logger.error(f"[Hello] WAV playback failed: {e}")
# Sarvam STT, Groq LLM, and GeminiTTS are no longer used.
# gemini-3.1-flash-live-preview handles STT + LLM + TTS natively.


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
        phone_number: str | None = None,
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
            llm=_build_realtime_model(effective_prompt),
        )
        self._session      = session
        self._room         = room
        self._livekit_api  = livekit_api
        self._ctx          = ctx
        self._phone_number = phone_number
        self._student_name = student_name
        self._student_age  = student_age
        self._school_name  = school_name
        self._school_city  = school_city
        self._current_lang: str = cfg.TTS_DEFAULT_LANGUAGE
        self._turn_start_ms: int = 0
        self._last_transcript: str = ""

        # ── Full conversation transcript ─────────────────────────────────────
        # Each entry: {"role": "user"|"agent", "text": "...", "lang": "...", "ts_ms": int}
        self._conversation_log: list[dict] = []

        # ── End-call flag ────────────────────────────────────────────────────
        # Set to True when farewell keyword ("alvida" etc.) is detected in
        # _on_conversation_item_added.  A delayed async task then calls
        # _emit_call_ended() after HANGUP_DELAY_S seconds.
        # Safety: reset to False if a new user utterance arrives after the flag
        # is set — means the student is still talking; do NOT hang up.
        self._end_call_pending: bool = False
        # Track whether the agent was in 'speaking' state so we only fire the
        # delete on a genuine speaking→listening transition, not any listening event.
        self._agent_was_speaking: bool = False

        # ── Q8 completion tracker ─────────────────────────────────────────────
        # Set to True when Gemini asks the "scale of 1 to 5" (Q8) question.
        # After the student replies, a 45-second auto-hangup timer fires unless
        # a farewell is detected sooner.  Prevents calls hanging forever if
        # Gemini forgets to say "alvida".
        self._q8_asked: bool = False
        self._q8_hangup_task: asyncio.Task | None = None

        # ── Max-call safety timer (8 minutes absolute ceiling) ───────────────
        # Fires regardless of survey state — prevents zombie calls if Gemini
        # gets stuck, student goes silent, or alvida is never spoken.
        async def _max_call_timer():
            await asyncio.sleep(8 * 60)
            if not self._call_ended_emitted:
                logger.warning("[NGO] Max call time (8 min) reached — forcing hangup")
                await self._emit_call_ended(reason="max_call_time")

        asyncio.ensure_future(_max_call_timer())

        # ── Egress (call recording) ─────────────────────────────────────────
        self._egress_id: str | None = None
        self._recording_url: str | None = None

        # ── Guard: ensure call_ended is emitted exactly once ─────────────────
        self._call_ended_emitted: bool = False

        # Hook into session events
        session.on("user_input_transcribed", self._on_transcribed)
        session.on("agent_state_changed", self._on_agent_state_changed)
        session.on("close", self._on_session_close)
        session.on("conversation_item_added", self._on_conversation_item_added)

    # ── Data channel helper ──────────────────────────────────────────────────
    async def _emit(self, event_type: str, **payload):
        try:
            data = _analytics_event(event_type, **payload)
            await self._room.local_participant.publish_data(
                data, reliable=True, topic="ngo-analytics"
            )
        except Exception as e:
            logger.warning(f"[Analytics] publish failed: {e}")

    # ── Call Recording (Egress) ──────────────────────────────────────────────
    async def start_recording(self) -> None:
        """Start a Room Composite Egress (audio-only MP3) → Supabase S3 bucket.

        The file is uploaded to: voice_recording/{room_name}.mp3
        The public URL is deterministic so we don't need to wait for completion.
        """
        if not all([SUPABASE_S3_ACCESS_KEY, SUPABASE_S3_SECRET, SUPABASE_S3_ENDPOINT]):
            logger.warning("[Egress] Supabase S3 credentials not configured — skipping recording")
            return

        room_name = self._room.name
        filename  = f"{room_name}.mp3"

        # Build deterministic public URL (bucket is public)
        self._recording_url = (
            f"{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_STORAGE_BUCKET}/{filename}"
        )

        try:
            s3_upload = api.S3Upload(
                access_key=SUPABASE_S3_ACCESS_KEY,
                secret=SUPABASE_S3_SECRET,
                endpoint=SUPABASE_S3_ENDPOINT,
                region=SUPABASE_S3_REGION,
                bucket=SUPABASE_STORAGE_BUCKET,
                force_path_style=True,
            )

            file_output = api.EncodedFileOutput(
                file_type=api.EncodedFileType.MP3,
                filepath=filename,
                s3=s3_upload,
            )

            egress_info = await self._livekit_api.egress.start_room_composite_egress(
                api.RoomCompositeEgressRequest(
                    room_name=room_name,
                    audio_only=True,
                    file_outputs=[file_output],
                )
            )

            self._egress_id = egress_info.egress_id
            logger.info(f"[Egress] Started room composite egress: {self._egress_id} → {filename}")

        except Exception as e:
            logger.error(f"[Egress] Failed to start recording: {e}")
            self._egress_id     = None
            self._recording_url = None

    async def stop_recording(self) -> None:
        """Stop the running egress. Fire-and-forget — don't block the call hangup."""
        if not self._egress_id:
            return
        try:
            await self._livekit_api.egress.stop_egress(
                api.StopEgressRequest(egress_id=self._egress_id)
            )
            logger.info(f"[Egress] Stop requested for {self._egress_id}")
        except Exception as e:
            logger.warning(f"[Egress] Stop failed (may already be stopped): {e}")

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
          • South Indian scripts outside Telugu (ta, kn, ml, …) → hi-IN
            (almost always STT misdetections of Hindi for these students;
             previously mapped to en-IN which caused ~29s silences due to the
             2-turn debounce needing 2× en-IN detections before switching)
          • Unrecognised / 'unknown' → keep current language (no flip)
        """
        if not stt_lang_code or stt_lang_code in ("unknown", ""):
            return self._current_lang

        prefix = stt_lang_code.split("-")[0].lower()

        # Primary supported languages — pass through directly
        PRIMARY = {"hi": "hi-IN", "en": "en-IN", "te": "te-IN"}
        if prefix in PRIMARY:
            return PRIMARY[prefix]

        # Non-Telugu south Indian scripts → fallback to Hindi
        # Rationale: these students are from Hindi-speaking central India.
        # Kannada/Tamil/Malayalam detections are almost always STT
        # misdetections of Hindi (e.g. Devanagari ambiguity).
        # Previously mapped to en-IN, which caused a 2-turn debounce delay
        # (streak needing 2× en-IN) before any reply, creating ~29s silences.
        SOUTH_INDIAN_NON_TELUGU = {"ta", "kn", "ml"}
        if prefix in SOUTH_INDIAN_NON_TELUGU:
            logger.info(f"[Lang] remapping {stt_lang_code} (south non-Telugu misdetection) → hi-IN")
            return "hi-IN"

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

        # ── Safety: cancel any pending end-call if student is still talking ──
        # The LLM occasionally hallucinates [END_CALL] mid-call (e.g. in a
        # transition sentence). If the student speaks after the flag was set,
        # the call is NOT over — clear the flag so we don't hang up.
        if self._end_call_pending:
            logger.warning(
                "[NGO] Student spoke after farewell was detected — cancelling pending delete "
                f"(transcript='{transcript[:60]}'). Call is NOT over yet."
            )
            self._end_call_pending = False

        resolved = self._resolve_tts_lang(detected_lang_raw)

        # ── Language tracking (analytics only) ──────────────────────────────
        # Gemini Live handles multilingual responses natively — no TTS rebuild
        # needed. We just track the detected language immediately for analytics.
        lang_switched = (resolved != self._current_lang)
        if lang_switched:
            logger.info(f"[Lang] {self._current_lang} → {resolved} (detected from transcript)")
            self._current_lang = resolved

        new_lang = self._current_lang

        logger.info(
            f"[STT] transcript='{transcript}' lang_raw='{detected_lang_raw}' → {resolved}"
            + (" [SWITCH]" if lang_switched else "")
        )

        # Log user turn to conversation log
        self._conversation_log.append({
            "role": "user",
            "text": transcript,
            "lang": new_lang,
            "ts_ms": int(time.time() * 1000),
        })

        asyncio.ensure_future(self._emit(
            "stt",
            transcript=transcript,
            language_raw=detected_lang_raw,
            language_resolved=new_lang,
            lang_switched=lang_switched,
            confidence=0.0,
        ))

    async def _switch_tts_language(self, lang: str) -> None:
        # GeminiTTS is natively multilingual — no rebuild needed.
        # Language is tracked in self._current_lang for analytics only.
        logger.info(f"[TTS] language tracking updated to {lang} (GeminiTTS handles multilingual natively)")

    # ── Agent state change: delete room after speaking ends ──────────────────
    def _on_agent_state_changed(self, ev) -> None:
        """
        Fallback: if _end_call_pending is True AND the agent just finished speaking,
        fire _emit_call_ended (covers edge cases where _delayed_hangup races with
        a very fast state transition).

        Primary path: _on_conversation_item_added detects farewell → schedules
        _emit_call_ended() after HANGUP_DELAY_S via asyncio.ensure_future.
        """
        new_state = ev.new_state if hasattr(ev, "new_state") else str(ev)

        if new_state == "speaking":
            self._agent_was_speaking = True

        elif new_state in ("listening", "idle"):
            if self._end_call_pending and self._agent_was_speaking:
                self._end_call_pending   = False
                self._agent_was_speaking = False
                logger.info(
                    f"[NGO] Agent finished speaking (state={new_state}) — "
                    f"deleting room {self._room.name} to send SIP BYE"
                )
                asyncio.ensure_future(self._emit_call_ended())
            else:
                # Regular turn end — reset speaking flag only
                self._agent_was_speaking = False

    async def _emit_call_ended(self, *, reason: str = "agent_end") -> None:
        """Emit call_ended analytics event, stop egress, then delete the room.

        Idempotent — safe to call from both [END_CALL] path and session-close path.
        Also calls /api/ngo-analyze directly so results are saved even when
        no browser client is in the room (e.g. auto-dialer mode).
        """
        if self._call_ended_emitted:
            logger.info("[NGO] _emit_call_ended already fired — skipping duplicate")
            return
        self._call_ended_emitted = True

        # Cancel Q8 safety timer if it's still pending
        if self._q8_hangup_task and not self._q8_hangup_task.done():
            self._q8_hangup_task.cancel()

        try:
            await self._emit(
                "call_ended",
                conversation=self._conversation_log,
                student_name=self._student_name,
                student_age=self._student_age,
                school_name=self._school_name,
                school_city=self._school_city,
                total_turns=len([t for t in self._conversation_log if t["role"] == "user"]),
                detected_language=self._current_lang,
                recording_url=self._recording_url,
                end_reason=reason,
            )
        except Exception as e:
            logger.warning(f"[NGO] call_ended emit error: {e}")

        # ── Call /api/ngo-analyze to save results to DB ──────────────────────
        # This runs regardless of whether a browser client received the event.
        asyncio.ensure_future(self._call_analyze_api(end_reason=reason))

        # Stop egress in background — don't block room deletion
        asyncio.ensure_future(self.stop_recording())
        try:
            self._ctx.delete_room()
        except Exception:
            pass  # room may already be gone if participant disconnected

    async def _call_analyze_api(self, *, end_reason: str = "agent_end") -> None:
        """POST the conversation to /api/ngo-analyze so Groq analyses and
        saves the result to ngo_call_results — works even without a browser.

        Conversation is truncated to the last 40 turns (≈20 exchanges) before
        sending to stay within the Groq TPM limit for openai/gpt-oss-120b.
        """
        url = f"{DASHBOARD_BASE_URL}/api/ngo-analyze"
        has_conversation = bool(self._conversation_log)

        # Truncate to last 40 turns to avoid Groq TPM (8000 token) limit.
        # A full 8-question survey is typically 20-30 turns; 40 is a safe cap
        # that still gives the analyser the complete meaningful conversation.
        MAX_TURNS = 40
        log_to_send = self._conversation_log[-MAX_TURNS:] if len(self._conversation_log) > MAX_TURNS else self._conversation_log
        if len(self._conversation_log) > MAX_TURNS:
            logger.info(f"[NGO] Truncating conversation from {len(self._conversation_log)} → {MAX_TURNS} turns for analyze API")

        payload = {
            "conversation":      log_to_send,
            "student_name":      self._student_name,
            "student_age":       self._student_age,
            "school_name":       self._school_name,
            "school_city":       self._school_city,
            "detected_language": self._current_lang,
            "phone_number":      self._phone_number,
            "room_name":         self._room.name,
            "recording_url":     self._recording_url,
        }

        # If there's no conversation (call failed / busy / unanswered),
        # tell the API to skip Groq analysis and just write an "unavailable" row.
        if not has_conversation:
            payload["call_outcome_override"] = "unavailable"
            payload["end_reason"] = end_reason
            logger.info(f"[NGO] No conversation — sending 'unavailable' to analyze API (reason={end_reason})")

        try:
            logger.info(f"[NGO] Calling {url} for {'analysis' if has_conversation else 'unavailable marker'}...")
            async with aiohttp.ClientSession() as http:
                async with http.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=60)) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        logger.info(f"[NGO] Result saved — outcome={data.get('call_outcome', '?')}, "
                                    f"sentiment={data.get('sentiment', {}).get('overall', '?')}")
                    else:
                        body = await resp.text()
                        logger.error(f"[NGO] Analyze API returned {resp.status}: {body[:300]}")
        except Exception as e:
            logger.error(f"[NGO] Failed to call analyze API: {e}")

    # ── Session close handler: catch mid-call hangups ────────────────────────
    def _on_session_close(self, ev) -> None:
        """
        Fired when the AgentSession closes for ANY reason:
          - PARTICIPANT_DISCONNECTED (student hung up mid-call)
          - JOB_SHUTDOWN, ERROR, USER_INITIATED, TASK_COMPLETED

        If _emit_call_ended hasn't fired yet (i.e. no [END_CALL] was spoken),
        we fire it now so the dashboard always gets:
          • conversation transcript  → analysis
          • recording_url            → audio player
          • DB entry                 → call log
        """
        reason_str = ev.reason.value if hasattr(ev, "reason") else "unknown"
        logger.info(f"[NGO] Session closed — reason={reason_str}")

        if not self._call_ended_emitted:
            logger.info(
                f"[NGO] call_ended not yet emitted — firing now (reason={reason_str})"
            )
            asyncio.ensure_future(self._emit_call_ended(reason=reason_str))

    # ── Conversation item added: agent text → [END_CALL] + logging ──────────
    def _on_conversation_item_added(self, ev: ConversationItemAddedEvent) -> None:
        """
        Fired by the RealtimeModel for every completed conversation turn.
        We only process assistant (agent) turns here.

        End-call detection strategy (robust to false positives):
          • Only the word "alvida" triggers hangup — it is reserved exclusively
            for the closing message in the system prompt.
          • Guard 1: text must NOT contain a "?" — closing has no questions.
          • Guard 2: "alvida" must appear in the LAST 60 chars of the text —
            mid-sentence uses like "alvida karna chahiye" are skipped.
          • Guard 3: if student speaks after flag is set, cancel (see _on_transcribed).

        Backup: Q8 safety timer fires 45s after Q8 is asked regardless.
        Backup: max-call timer fires after 8 minutes regardless.
        """
        import re, unicodedata

        HANGUP_DELAY_S = 3.5   # seconds to wait after farewell before SIP BYE

        # ONLY "alvida" triggers hangup — it is the one word the system prompt
        # reserves exclusively for the closing message.  All other farewell-ish
        # words (shukriya, dhanyawad, take care) appear constantly mid-call.
        ALVIDA_PATTERN = re.compile(r'\balvida\b', re.IGNORECASE)

        item = ev.item
        role = getattr(item, "role", None)
        if role != "assistant":
            return

        text = getattr(item, "text_content", None) or ""
        if not text:
            return

        # ── Farewell / end-call detection (strict guards) ────────────────────
        if (
            ALVIDA_PATTERN.search(text)                   # must contain "alvida"
            and "?" not in text                           # closing has NO question
            and ALVIDA_PATTERN.search(text[-80:])         # must be near the END
            and not self._end_call_pending
            and not self._call_ended_emitted
        ):
            logger.info(
                f"[NGO] Farewell 'alvida' detected at end of closing turn — "
                f"scheduling room delete in {HANGUP_DELAY_S}s"
            )
            self._end_call_pending = True

            async def _delayed_hangup():
                await asyncio.sleep(HANGUP_DELAY_S)
                await self._emit_call_ended()

            asyncio.ensure_future(_delayed_hangup())

        clean_text = text.strip()

        # ── Q8 detection: "scale of 1 to 5" ─────────────────────────────────
        Q8_PATTERN = re.compile(r'scale\s+of\s+1\s+(to|se)\s+5', re.IGNORECASE)
        if Q8_PATTERN.search(text) and not self._q8_asked:
            self._q8_asked = True
            logger.info("[NGO] Q8 detected — arming 45-second auto-hangup safety timer")

            async def _q8_hangup():
                await asyncio.sleep(45)
                if not self._call_ended_emitted:
                    logger.warning("[NGO] Q8 safety timer expired — forcing hangup")
                    await self._emit_call_ended(reason="q8_timeout")

            self._q8_hangup_task = asyncio.ensure_future(_q8_hangup())

        # ── Log to conversation log ──────────────────────────────────────────
        if clean_text:
            self._conversation_log.append({
                "role": "agent",
                "text": clean_text,
                "lang": self._current_lang,
                "ts_ms": int(time.time() * 1000),
            })
            logger.info(f"[Agent] logged turn: '{clean_text[:80]}'")

        # ── Language tracking from output script ────────────────────────────
        if clean_text:
            latin = sum(
                1 for c in clean_text
                if unicodedata.category(c).startswith('L') and ord(c) < 128
            )
            total_letters = sum(
                1 for c in clean_text
                if unicodedata.category(c).startswith('L')
            )
            ratio = latin / max(total_letters, 1)
            if total_letters > 0 and ratio > 0.7 and self._current_lang not in ("en-IN", "en-US"):
                logger.info(f"[Lang] Agent output is English (ratio={ratio:.2f}) — tracking as en-IN")
                self._current_lang = "en-IN"
                self._pending_lang = "en-IN"
                self._lang_streak  = 0

    # ── on_user_turn_completed ───────────────────────────────────────────────
    async def on_user_turn_completed(
        self,
        turn_ctx: llm.ChatContext,
        new_message: llm.ChatMessage,
    ) -> None:
        # History truncation is handled server-side by Gemini Live's
        # context_window_compression. Still emit analytics.
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
    # Gemini Live has server-side VAD/turn detection built in — no separate VAD needed.
    session = AgentSession()

    assistant = NGOAssistant(
        session=session,
        room=ctx.room,
        livekit_api=ctx.api,
        ctx=ctx,
        student_name=student_name,
        student_age=student_age,
        school_name=school_name,
        school_city=school_city,
        phone_number=phone_number,
    )

    # Gemini Live expects 16kHz PCM input (same as before).
    audio_input_opts = AudioInputOptions(
        sample_rate=16000,
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

    # ── Start call recording (egress → Supabase S3) ─────────────────────────
    # Fire-and-forget: don't delay the greeting
    asyncio.ensure_future(assistant.start_recording())

    # ── Emit session-start analytics ─────────────────────────────────────────
    await assistant._emit(
        "session_start",
        phone_number=phone_number or "voip",
        ngo=cfg.NGO_NAME,
        team=cfg.TEAM_NAME,
        gemini_model=cfg.GEMINI_MODEL,
        tts_voice=cfg.TTS_VOICE,
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

                # Gemini Live connects via persistent WebSocket — first reply
                # arrives in ~300ms so no silent gap; no pre-recorded hello needed.

                # Play pre-recorded greeting WAV immediately (Gemini Aoede voice,
                # generated by generate_hello_audio.py).  Runs concurrently with
                # Gemini's WebSocket warm-up so there is no silent gap.
                asyncio.ensure_future(play_hello_audio(ctx.room))

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

        # Wait for the WAV to finish playing (~1s) then let Gemini take over.
        # generate_reply continues the conversation after the pre-recorded intro.
        await asyncio.sleep(2.0)
        greeting = cfg.build_greeting(student_name, school_name)
        await session.generate_reply(instructions=greeting)

    else:
        # VoIP / inbound mode — greet immediately
        logger.info("[NGO] VoIP / inbound mode — greeting")
        asyncio.ensure_future(play_hello_audio(ctx.room))
        await asyncio.sleep(2.0)
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
