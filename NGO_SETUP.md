# NGO Agent — Making the Difference / Team Lajja

Menstrual Hygiene Awareness & Feedback Survey — outbound SIP voice agent with
multilingual support (Hindi · English · Telugu) and a real-time analytics dashboard.

---

## Architecture

```
+------------------+        SIP via Vobiz         +------------------+
|  Next.js         |  ──── POST /api/ngo-dispatch ─▶|  ngo_agent.py    |
|  Dashboard /ngo  |                               |  (LiveKit worker)|
|                  |  ◀── LiveKit data channel ─── |                  |
+------------------+   (ngo-analytics topic)       +------------------+
       │                                                   │
       │  WebSocket (livekit-client)                       │
       ▼                                                   ▼
  NGOAnalytics.tsx                            Sarvam saaras:v3 STT
  (real-time feed)                            Groq llama-4-maverick LLM  →  Groq openai/gpt-oss-120b LLM
                                              Sarvam bulbul:v3 TTS (shubh)
                                              Vobiz SIP trunk → +91 phones
```

---

## Quick Start

### 1. Start the Python NGO agent worker

```powershell
cd f:\callingagents
.venv\Scripts\python.exe ngo_agent.py start
```

The worker registers itself as `"ngo-caller"` with LiveKit Cloud.

### 2. Start the Next.js dashboard

```powershell
cd f:\callingagents\dashboard
npm run dev
```

Open **http://localhost:3000/ngo**

### 3. Place a call

1. Enter a **+91 phone number** (e.g. `+919876543210`)
2. Optionally add a student name and notes
3. Click **Start Call**
4. The agent will:
   - Create a LiveKit room
   - Dispatch the `ngo-caller` worker
   - Dial the phone number via Vobiz SIP trunk
   - Start the Hindi greeting automatically
5. Watch the **real-time analytics panel** on the right for:
   - Live transcript per turn
   - Auto-detected language (hi-IN / en-IN / te-IN)
   - LLM response text
   - STT · LLM · TTS TTFA · E2E latencies at millisecond resolution
   - Language-switch events highlighted in amber

---

## Configuration (`ngo_config.py`)

| Setting | Value |
|---------|-------|
| STT model | `saaras:v3` (Sarvam) |
| STT language | `unknown` (auto-detect per utterance) |
| LLM | `openai/gpt-oss-120b` via Groq |
| TTS model | `bulbul:v3-beta` (Sarvam) |
| TTS speaker | `shubh` |
| Default TTS language | `hi-IN` |
| Language map | hi→hi-IN · en→en-IN · te→te-IN · + 8 more |
| SIP Trunk | Vobiz `ST_ckt4iwbKfNAr` |

---

## Environment Variables Required

All in `f:\callingagents\.env` (Python agent) and `dashboard\.env.local` (Next.js):

```
LIVEKIT_URL=wss://callagent-testing-0rji3vhd.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
SARVAM_API_KEY=sk_dg7gtp9j_...
GROQ_API_KEY=gsk_...
VOBIZ_SIP_TRUNK_ID=ST_ckt4iwbKfNAr
VOBIZ_SIP_DOMAIN=78efb265.sip.vobiz.ai
```

---

## How Language Switching Works

1. **STT**: Every utterance is transcribed by Sarvam `saaras:v3` with `language=unknown`.
   The response includes a `language_code` field (e.g. `"hi-IN"`, `"en"`, `"te-IN"`).

2. **Detection**: `ngo_agent.py → stt_node()` reads `event.alternatives[0].language` for
   every `FINAL_TRANSCRIPT` event.

3. **TTS rebuild**: If the detected language differs from the current TTS language, the agent
   directly assigns `self._tts` and `session._tts` to a freshly-constructed `sarvam.TTS`
   pointing to the new `target_language_code`. This happens **every turn**.
   (Note: `AgentSession.update_tts()` does not exist in livekit-agents 1.4.3 — direct
   attribute assignment is used instead.)

4. **Dashboard**: A `stt` analytics event is emitted with `lang_switched: true/false` and
   `language_resolved` — visible in the NGOAnalytics panel highlighted in amber.

---

## Analytics Events (LiveKit data channel topic: `ngo-analytics`)

| Event | Fields |
|-------|--------|
| `session_start` | phone_number, ngo, team, stt_model, llm_model, tts_model, tts_speaker |
| `call_answered` | phone_number |
| `call_failed` | error |
| `stt_start` | ts_ms |
| `stt` | transcript, language_raw, language_resolved, lang_switched, stt_latency_ms, confidence |
| `user_turn` | transcript, language |
| `tts_start` | llm_response_text, tts_language, tts_speaker, tts_model, llm_latency_ms, tts_ttfa_ms, e2e_latency_ms |
| `tts_done` | llm_response_text, tts_language, tts_speaker |

---

## Survey Flow (auto-managed by agent)

1. Introduction — Team Lajja / Making the Difference NGO
2. Availability check — offer to reschedule if busy
3. Q1 — Product used before session (cloth/pad/nothing)
4. Q2 — Received & read the awareness book?
5. Q3 — Shared knowledge with family/friends?
6. Q4 — Using distributed sanitary kit?
7. Q5 — Comfortable with cloth pad?
8. Q6 — Will continue using hygienic products?
9. Q7 — If not — what is stopping you?
10. Q8 — Rate session 1–5
11. Closing — encouragement + end call
