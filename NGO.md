# NGO Agent — Making the Difference / Team Lajja

> Outbound SIP voice agent for Menstrual Hygiene Awareness & Feedback Survey  
> Multilingual · Hindi · English · Telugu · Gujarati · Kannada · and more

---

## Overview

`ngo_agent.py` is a LiveKit voice agent that:

- **Dials outbound** to Indian (+91) mobile numbers via a Vobiz SIP trunk
- **Transcribes speech** using Sarvam `saaras:v3` STT with **automatic language detection** per turn
- **Generates responses** using Groq `openai/gpt-oss-120b` LLM
- **Synthesizes audio** using Sarvam `bulbul:v3-beta` TTS, **dynamically switching** language to match each response
- **Streams real-time analytics** to the Next.js dashboard over a LiveKit data channel

---

## Architecture

```
+--------------------+    POST /api/ngo-dispatch    +-------------------+
|  Next.js Dashboard |  ─────────────────────────▶  |  LiveKit Cloud    |
|  /ngo              |                              |  (room dispatch)  |
|                    |  ◀──  WebSocket  ──────────  |                   |
+--------------------+   (livekit-client)           +-------------------+
         │                                                   │
         │  ngo-analytics data channel                       │ JobContext
         ▼                                                   ▼
  NGOAnalytics.tsx                              +-------------------+
  (live transcript /                            |   ngo_agent.py    |
   language events /                            |   (Python worker) |
   latency metrics)                             +-------------------+
                                                 │        │       │
                                          Sarvam STT  Groq LLM  Sarvam TTS
                                          saaras:v3   gpt-oss    bulbul:v3
                                                           │
                                                   Vobiz SIP Trunk
                                                   → +91 phone numbers
```

---

## Repository Structure

```
callingagents/
├── ngo_agent.py          # Main voice agent worker
├── ngo_config.py         # All config: models, prompts, language map, SIP trunk
├── NGO.md                # This file
├── NGO_SETUP.md          # Legacy setup notes
└── dashboard/
    ├── app/
    │   ├── ngo/
    │   │   └── page.tsx              # /ngo dashboard page
    │   └── api/
    │       ├── ngo-dispatch/
    │       │   └── route.ts          # POST → dispatch outbound call
    │       └── ngo-token/
    │           └── route.ts          # GET  → LiveKit room token
    └── components/
        ├── NGOAnalytics.tsx          # Real-time analytics feed
        ├── NgoLiveMonitor.tsx        # Live call monitor panel
        └── NgoVoiceRoom.tsx          # Voice room component
```

---

## Quick Start

### Prerequisites

- Python 3.11+ with `.venv` virtualenv
- Node.js 18+
- A LiveKit Cloud project
- Sarvam API key (`SARVAM_API_KEY`)
- Groq API key (`GROQ_API_KEY`)
- Vobiz SIP trunk configured in LiveKit (`VOBIZ_SIP_TRUNK_ID`)

### 1 — Environment Variables

**`f:\callingagents\.env`** (Python agent):
```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxx
LIVEKIT_API_SECRET=your-secret
SARVAM_API_KEY=sk_xxxxxxxx
GROQ_API_KEY=gsk_xxxxxxxx
VOBIZ_SIP_TRUNK_ID=ST_xxxxxxxx
VOBIZ_SIP_DOMAIN=xxxxxxxx.sip.vobiz.ai
```

**`dashboard\.env.local`** (Next.js):
```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxx
LIVEKIT_API_SECRET=your-secret
```

### 2 — Start the Python Agent Worker

```powershell
cd f:\callingagents
.venv\Scripts\python.exe ngo_agent.py start
```

The worker registers as `ngo-caller` with LiveKit Cloud and waits for dispatch.

### 3 — Start the Next.js Dashboard

```powershell
cd f:\callingagents\dashboard
npm run dev
```

Open **http://localhost:3000/ngo**

### 4 — Place a Call

1. Enter a **+91 phone number** (e.g. `+919876543210`)
2. Optionally add student name / notes
3. Click **Start Call**

The agent will:
- Create a LiveKit room
- Dispatch the `ngo-caller` worker
- Dial the number via Vobiz SIP trunk
- Wait for answer (`wait_until_answered=True`)
- Bind audio input to the SIP participant
- Speak the Hindi opening greeting

---

## How It Works

### STT — Auto Language Detection

Every utterance is streamed to Sarvam `saaras:v3` with `language="unknown"`.  
The API returns a `language_code` per transcript (e.g. `"hi-IN"`, `"en-IN"`, `"kn-IN"`, `"gu-IN"`).

**Known plugin bug (fixed in `_FixedSTT` / `_FixedSpeechStream`):**  
The Sarvam plugin copies `input_audio_codec` into the WebSocket message body as `encoding`, but the API always requires `encoding="audio/wav"` in the body regardless of the binary codec. The fix subclasses `SpeechStream` to reset `_audio_encoding = "audio/wav"` after `__init__`.

### Language Switching — TTS

When the detected language changes between turns:

1. `_on_transcribed` fires → `_resolve_tts_lang(lang_code)` maps the prefix to a Sarvam language code
2. `_switch_tts_language(lang)` builds a new `sarvam.TTS` instance and assigns it to both `self._tts` (the `Agent`) and `session._tts` (the `AgentSession`) so the running activity picks it up immediately
3. `tts_node` buffers the first ~80 chars of the LLM reply and checks if it's Latin-script (English). If the LLM responded in English but TTS is set to a non-Latin language (e.g. `kn-IN`), it overrides TTS to `en-IN` for that turn — preventing the *"Text must contain at least one character from the allowed languages"* error

### SIP Participant Binding

After `create_sip_participant(wait_until_answered=True)` returns, the code explicitly calls:
```python
session._room_io.set_participant(sip_identity)
```
This fixes a race condition where the SIP track arrives before `_ParticipantAudioInputStream` has the participant identity set, causing all audio tracks to be silently rejected.

---

## Supported Languages

| STT code | TTS target | Language |
|----------|------------|----------|
| `hi` | `hi-IN` | Hindi |
| `en` | `en-IN` | English |
| `te` | `te-IN` | Telugu |
| `bn` | `bn-IN` | Bengali |
| `ta` | `ta-IN` | Tamil |
| `mr` | `mr-IN` | Marathi |
| `gu` | `gu-IN` | Gujarati |
| `kn` | `kn-IN` | Kannada |
| `ml` | `ml-IN` | Malayalam |
| `pa` | `pa-IN` | Punjabi |

---

## Models & Configuration

| Component | Value |
|-----------|-------|
| STT | Sarvam `saaras:v3` |
| STT language | `unknown` (auto-detect) |
| STT codec | `pcm_s16le` @ 16 kHz |
| LLM | `openai/gpt-oss-120b` via Groq |
| LLM base URL | `https://api.groq.com/openai/v1` |
| LLM temperature | `0.4` |
| TTS | Sarvam `bulbul:v3-beta` |
| TTS speaker | `shubh` |
| TTS default lang | `hi-IN` |
| VAD | Silero |
| Noise cancel | `BVCTelephony` (livekit noise-cancellation) |
| SIP trunk | Vobiz (`ST_ckt4iwbKfNAr`) |

All values are in `ngo_config.py` and can be overridden via env vars.

---

## Analytics Events

Events are published over the LiveKit data channel on topic **`ngo-analytics`** as JSON.

| Event | Key Fields |
|-------|------------|
| `session_start` | `phone_number`, `ngo`, `team`, `stt_model`, `llm_model`, `tts_model`, `tts_speaker`, `default_language` |
| `call_answered` | `phone_number` |
| `call_failed` | `error` |
| `stt` | `transcript`, `language_raw`, `language_resolved`, `lang_switched` |
| `user_turn` | `transcript`, `language`, `llm_latency_ms` |

The **NGOAnalytics** dashboard component subscribes to this topic and renders:
- Live transcript per turn
- Detected language badge (highlighted amber on switch)
- LLM latency (ms)
- Language switch events

---

## Survey Flow

The agent follows this sequence (managed via the system prompt):

1. **Introduction** — Team Lajja / Making the Difference NGO, ask for 1 min
2. **Availability check** — reschedule if busy
3. **Q1** — Product used before session (cloth / pad / nothing)
4. **Q2** — Received & read the awareness book?
5. **Q3** — Shared knowledge with family/friends?
6. **Q4** — Using the distributed sanitary kit?
7. **Q5** — Comfortable with cloth pad? Any challenges?
8. **Q6** — Will continue using hygienic products?
9. **Q7** — If not — what is stopping you?
10. **Q8** — Rate session 1–5
11. **Closing** — encouragement + end call gracefully

Target call duration: **under 5 minutes**.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Agent starts but no audio transcribed | SIP participant race condition | Ensure `session._room_io.set_participant(sip_identity)` is called after `wait_until_answered` |
| `AttributeError: update_tts` | livekit-agents 1.4.3 has no `update_tts()` | Fixed — now uses direct `self._tts` / `session._tts` assignment |
| `Text must contain at least one character from the allowed languages` | TTS `target_language_code` mismatches LLM output script | Fixed — `tts_node` detects Latin-script output and overrides to `en-IN` |
| Sarvam STT returns empty transcripts | Plugin bug: `encoding` set to `pcm_s16le` in body | Fixed — `_FixedSpeechStream` resets `_audio_encoding = "audio/wav"` |
| Call not connecting | Wrong SIP trunk ID | Check `VOBIZ_SIP_TRUNK_ID` env var |

---

## Branch

This feature lives on the **`ngo`** branch of `tanishqvyas09/callingagents`.

```
git checkout ngo
```
