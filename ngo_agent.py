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

import aiohttp

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
        max_completion_tokens=cfg.LLM_MAX_COMPLETION_TOKENS,
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
            stt=_build_stt(),
            llm=_build_llm(),
            tts=_build_tts(cfg.TTS_DEFAULT_LANGUAGE),
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
        # Accumulated as the call progresses — emitted in call_ended event.
        # Each entry: {"role": "user"|"agent", "text": "...", "lang": "...", "ts_ms": int}
        self._conversation_log: list[dict] = []

        # ── Language debounce: require 2 consecutive turns in same language ──
        # before committing a permanent TTS switch.  This prevents single-word
        # noise detections (e.g. "gu-IN" from one ambiguous utterance) from
        # derailing the conversation language permanently.
        self._pending_lang: str = cfg.TTS_DEFAULT_LANGUAGE  # candidate to switch to
        self._lang_streak: int = 0                          # consecutive turns in pending_lang

        # ── End-call flag ────────────────────────────────────────────────────
        # Set to True ONLY when [END_CALL] marker is detected in tts_node.
        # _on_agent_state_changed watches for speaking → listening/idle
        # and deletes the room only after TTS audio has fully played out.
        #
        # Safety: reset to False if a new user utterance arrives AFTER the flag
        # was set — this means the LLM hallucinated [END_CALL] mid-call and the
        # student is still talking.  We must NOT delete the room in that case.
        self._end_call_pending: bool = False
        # Track whether the agent was in 'speaking' state so we only fire the
        # delete on a genuine speaking→listening transition, not any listening event.
        self._agent_was_speaking: bool = False

        # ── Egress (call recording) ─────────────────────────────────────────
        self._egress_id: str | None = None
        self._recording_url: str | None = None

        # ── Guard: ensure call_ended is emitted exactly once ─────────────────
        self._call_ended_emitted: bool = False

        # Hook into session events
        session.on("user_input_transcribed", self._on_transcribed)
        session.on("agent_state_changed", self._on_agent_state_changed)
        session.on("close", self._on_session_close)

    # ── Instant "hello" audio burst on connect ───────────────────────────────
    async def play_hello_audio(self) -> None:
        """Play pre-recorded assets/hello_hi.wav immediately after call connects.

        This fills the ~3-4 second silence that normally occurs while the LLM
        generates the first greeting, preventing the student from hanging up.
        The WAV is read once, published as raw PCM via a temporary AudioSource,
        then the track is unpublished so the agent's normal TTS takes over.
        """
        import wave as _wave
        wav_path = os.path.join(os.path.dirname(__file__), "assets", "hello_hi.wav")
        if not os.path.exists(wav_path):
            logger.warning("[Hello] assets/hello_hi.wav not found — skipping instant hello")
            return

        try:
            with _wave.open(wav_path, "rb") as wf:
                sample_rate  = wf.getframerate()
                num_channels = wf.getnchannels()
                raw_pcm      = wf.readframes(wf.getnframes())

            # Create a temporary AudioSource + track, publish it to the room
            source = rtc.AudioSource(sample_rate, num_channels)
            track  = rtc.LocalAudioTrack.create_audio_track("hello-burst", source)
            pub    = await self._room.local_participant.publish_track(
                track,
                rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
            )
            logger.info("[Hello] Playing hello_hi.wav to caller ...")

            # Stream PCM in 10ms chunks (sample_rate / 100 samples per chunk)
            samples_per_chunk = sample_rate // 100          # 10ms worth
            bytes_per_sample  = 2 * num_channels            # 16-bit
            chunk_bytes       = samples_per_chunk * bytes_per_sample

            pos = 0
            while pos < len(raw_pcm):
                chunk = raw_pcm[pos : pos + chunk_bytes]
                if not chunk:
                    break
                # Pad last chunk if needed
                if len(chunk) < chunk_bytes:
                    chunk = chunk + b"\x00" * (chunk_bytes - len(chunk))

                import array as _array
                samples = _array.array("h", chunk)
                frame   = rtc.AudioFrame(
                    data=bytes(samples),
                    sample_rate=sample_rate,
                    num_channels=num_channels,
                    samples_per_channel=samples_per_chunk,
                )
                await source.capture_frame(frame)
                await asyncio.sleep(0.01)   # 10ms real-time pacing
                pos += chunk_bytes

            # Small tail silence so the last chunk plays out before we unpublish
            await asyncio.sleep(0.15)
            await self._room.local_participant.unpublish_track(pub.sid)
            logger.info("[Hello] hello_hi.wav playback complete — handing over to TTS")

        except Exception as e:
            logger.warning(f"[Hello] play_hello_audio failed: {e}")

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

        # ── Safety: cancel any pending end-call if student is still talking ──
        # The LLM occasionally hallucinates [END_CALL] mid-call (e.g. in a
        # transition sentence). If the student speaks after the flag was set,
        # the call is NOT over — clear the flag so we don't hang up.
        if self._end_call_pending:
            logger.warning(
                "[NGO] Student spoke after [END_CALL] was set — cancelling pending delete "
                f"(transcript='{transcript[:60]}'). LLM likely hallucinated the marker."
            )
            self._end_call_pending = False

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

        Guard: only fire on a genuine speaking→listening transition using
        _agent_was_speaking. This prevents the 'listening' events that fire
        between normal mid-call turns from accidentally triggering deletion.
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

        When the conversation is empty (dial failed, busy, no answer etc.)
        we still POST a minimal payload with call_outcome='unavailable' so
        that the campaign poller can move on instead of hanging forever.
        """
        url = f"{DASHBOARD_BASE_URL}/api/ngo-analyze"
        has_conversation = bool(self._conversation_log)

        payload = {
            "conversation":      self._conversation_log,
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

        # ── Log agent turn to conversation log ───────────────────────────────
        if accumulated:
            self._conversation_log.append({
                "role": "agent",
                "text": accumulated,
                "lang": self._current_lang,
                "ts_ms": int(time.time() * 1000),
            })

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
        # ── Keep chat history bounded so we never exceed Groq's context window ─
        # truncate() preserves the system prompt and keeps the last N items.
        # 60 items ≈ 30 user+agent turns — well within the 30-turn minimum the
        # user requested and within gpt-oss-120b's ~32k context window.
        self._session.history.truncate(max_items=cfg.CHAT_HISTORY_MAX_ITEMS)

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
        phone_number=phone_number,
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

    # ── Start call recording (egress → Supabase S3) ─────────────────────────
    # Fire-and-forget: don't delay the greeting
    asyncio.ensure_future(assistant.start_recording())

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

                # ── Instant hello burst ──────────────────────────────────────
                # Play pre-recorded "हैलो" immediately so the caller hears
                # something right away while the LLM builds the real greeting.
                await assistant.play_hello_audio()

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
