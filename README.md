# Team Lajja — Menstrual Hygiene Survey Agent 📞

> **Making the Difference NGO** · Outbound AI voice calling system  
> Multilingual (Hindi · English · Telugu) · Real-time dashboard · Call recording · Automated analysis

---

## What It Does

This system automatically calls school-age girls who attended Making the Difference NGO's menstrual hygiene awareness sessions, conducts an 8-question feedback survey in their preferred language, records the call, and generates an AI analysis — all displayed in a real-time dashboard.

```
Dashboard (/ngo)  →  Dispatch call  →  ngo_agent.py worker
                                              │
                               Sarvam STT (saaras:v3) — auto language detect
                               Groq LLM  (gpt-oss-120b) — survey conversation
                               Sarvam TTS (bulbul:v3-beta) — dynamic language switch
                                              │
                               Vobiz SIP Trunk → +91 phone number
                                              │
                               LiveKit Egress → Supabase S3 (MP3 recording)
                                              │
                               call_ended event → /api/ngo-analyze → Supabase DB
```

---

## Features

| Feature | Detail |
|---------|--------|
| **Outbound SIP calls** | Vobiz trunk → any +91 Indian mobile |
| **Auto language detection** | Sarvam STT detects Hindi / English / Telugu per utterance |
| **Dynamic TTS language switching** | Replies in student's detected language (debounced, 2-turn threshold) |
| **Call recording** | LiveKit Room Composite Egress → MP3 → Supabase `voice_recording` bucket |
| **AI call analysis** | Groq analyzes full transcript → structured JSON (sentiment, answers, recommendation) |
| **Real-time dashboard** | Live transcript, language badges, latency metrics via LiveKit data channel |
| **Call result modal** | Overview, transcript, AI analysis, audio player — all in one modal |
| **Student search** | Autocomplete search over Supabase `ngo_students` table |
| **Bulk dialler** | Queue multiple students for sequential calls |
| **Mid-call hangup handling** | call_ended fires on participant disconnect too — no data loss |

---

## Project Structure

```
callingagents/
│
├── ngo_agent.py           # Main Python voice agent worker
├── ngo_config.py          # Models, system prompt, language map, SIP config
├── ngo_call_results.sql   # Supabase table schema + indexes + RLS policies
├── requirements.txt       # Python dependencies
├── .env                   # Python agent secrets (not committed)
│
└── dashboard/             # Next.js 16 frontend
    ├── app/
    │   ├── ngo/
    │   │   └── page.tsx             # Main /ngo page (search, call, analytics)
    │   └── api/
    │       ├── ngo-dispatch/        # POST → create room + dispatch agent + SIP dial
    │       ├── ngo-analyze/         # POST → Groq analysis → insert to Supabase DB
    │       ├── ngo-students/        # GET  → student search (name / phone / school)
    │       ├── voip-dispatch/       # POST → VoIP (browser) call dispatch
    │       ├── dispatch/            # Generic dispatch
    │       ├── queue/               # Call queue endpoint
    │       └── token/               # LiveKit room token
    └── components/
        ├── NGOAnalytics.tsx         # Real-time analytics feed + call controls
        ├── CallResultModal.tsx      # Post-call modal: transcript, analysis, audio
        ├── BulkDialer.tsx           # Bulk student dialling UI
        ├── CallDispatcher.tsx       # Single call dispatcher
        └── VoiceRoom.tsx            # Browser VoIP voice room
```

---

## Stack

| Layer | Technology |
|-------|-----------|
| Voice agent framework | [LiveKit Agents](https://docs.livekit.io/agents/) 1.4.3 |
| STT | Sarvam `saaras:v3` (auto language detect) |
| LLM | Groq `openai/gpt-oss-120b` (temperature 0.3, max 300 tokens/reply) |
| TTS | Sarvam `bulbul:v3-beta` speaker `shubh` |
| VAD | Silero |
| Noise cancellation | LiveKit `BVCTelephony` |
| SIP / PSTN | Vobiz SIP trunk |
| Call recording | LiveKit Room Composite Egress → MP3 |
| Storage | Supabase `voice_recording` S3 bucket (public) |
| Database | Supabase PostgreSQL (`ngo_call_results` table) |
| Frontend | Next.js 16.1.6 · React 19 · TypeScript · Tailwind CSS 4 |
| Realtime | LiveKit data channel (topic: `ngo-analytics`) |

---

## Setup

### Prerequisites

- Python 3.11+ with `.venv`
- Node.js 18+
- [LiveKit Cloud](https://cloud.livekit.io/) project
- [Sarvam AI](https://sarvam.ai/) API key
- [Groq](https://console.groq.com/) API key
- Vobiz SIP trunk registered in LiveKit
- Supabase project with `voice_recording` bucket (public) + `ngo_call_results` table

### 1 — Python environment

```powershell
cd f:\callingagents
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### 2 — Environment variables

**`.env`** (Python agent — never commit this):

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxx
LIVEKIT_API_SECRET=your-secret

SARVAM_API_KEY=sk_xxxxxxxx
GROQ_API_KEY=gsk_xxxxxxxx

VOBIZ_SIP_TRUNK_ID=ST_xxxxxxxx
VOBIZ_SIP_DOMAIN=xxxxxxxx.sip.vobiz.ai

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_S3_ACCESS_KEY=your-s3-access-key
SUPABASE_S3_SECRET=your-s3-secret
SUPABASE_S3_ENDPOINT=https://your-project.supabase.co/storage/v1/s3
SUPABASE_S3_REGION=us-east-1
SUPABASE_STORAGE_BUCKET=voice_recording
```

**`dashboard/.env.local`** (Next.js):

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxx
LIVEKIT_API_SECRET=your-secret

NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GROQ_API_KEY=gsk_xxxxxxxx
```

### 3 — Supabase database

Run `ngo_call_results.sql` in the Supabase SQL editor to create the results table, indexes, and RLS policies.

### 4 — Start the agent worker

```powershell
cd f:\callingagents
.venv\Scripts\python.exe ngo_agent.py start
```

The worker registers as `ngo-caller` with LiveKit Cloud and waits for dispatch jobs.

### 5 — Start the dashboard

```powershell
cd f:\callingagents\dashboard
npm install
npm run dev
```

Open **http://localhost:3000/ngo**

---

## Making a Call

1. Search for a student by name, phone, or school using the search box
2. Select a student to auto-fill their details
3. Confirm the phone number and click **Start Call**
4. Watch the live transcript and language badges in the analytics panel
5. After the call ends, the **Call Result Modal** opens automatically with:
   - **Overview** — summary, audio player (MP3 recording), call metadata
   - **Transcript** — full turn-by-turn conversation
   - **AI Analysis** — structured Groq analysis of responses

---

## Survey Questions

The agent follows this sequence (one question per reply, mandatory):

| Step | Question |
|------|----------|
| Q1 | What did you use during your period before the session? (cloth / pad / nothing) |
| Q2 | Did you receive and read the awareness book? |
| Q3 | Have you shared what you learned with family or friends? |
| Q4 | Are you currently using the sanitary pad kit we distributed? |
| Q5 *(if cloth pad)* | Are you comfortable with the cloth pad? Any challenges? |
| Q6 | Will you continue using hygienic menstrual products after this session? |
| Q7 *(if Q6=NO)* | What is stopping you? |
| Q8 *(required)* | On a scale of 1–5, how helpful was this session? |

Target call duration: **under 5 minutes**.

---

## How the Recording Works

1. After `session.start()`, `start_recording()` fires a LiveKit **Room Composite Egress** (audio-only, MP3)
2. The egress uploads to Supabase Storage: `voice_recording/{room_name}.mp3`
3. The public URL is deterministic: `{SUPABASE_URL}/storage/v1/object/public/voice_recording/{room_name}.mp3`
4. On call end (normal or mid-call hangup), `stop_recording()` is called and the URL is included in the `call_ended` event
5. `/api/ngo-analyze` receives the URL and saves it to the DB — the modal shows an inline audio player

> ⚠️ Supabase S3 requires `region=us-east-1` regardless of your project region. Using any other region causes `SignatureDoesNotMatch`.

---

## Real-time Analytics Events

Published over LiveKit data channel, topic `ngo-analytics`:

| Event | Key Fields |
|-------|-----------|
| `session_start` | `phone_number`, `stt_model`, `llm_model`, `tts_model` |
| `call_answered` | `phone_number` |
| `call_failed` | `error` |
| `stt` | `transcript`, `language_raw`, `language_resolved`, `lang_switched` |
| `user_turn` | `transcript`, `language`, `llm_latency_ms` |
| `call_ended` | `conversation`, `recording_url`, `end_reason`, `student_name`, `school_name` |

---

## Known Fixes Baked In

| Issue | Fix |
|-------|-----|
| Sarvam STT `encoding` bug | `_FixedSpeechStream` resets `_audio_encoding = "audio/wav"` after init |
| SIP audio track race condition | `session._room_io.set_participant(sip_identity)` called after `wait_until_answered` |
| TTS language mismatch | `tts_node` detects Latin-script LLM output and overrides TTS to `en-IN` |
| LLM dumping multiple questions | `max_completion_tokens=300` hard cap + step-based system prompt |
| React 18 Strict Mode double insert | `useRef` guard in `CallResultModal` prevents duplicate DB rows |
| PostgREST upsert with partial index | Switched to `.insert()` + catch `23505` (unique_violation) |
| Mid-call hangup losing data | `session.on("close")` fires `_emit_call_ended` for any disconnect reason |
| Supabase S3 `SignatureDoesNotMatch` | `SUPABASE_S3_REGION=us-east-1` (required even for non-US projects) |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Agent exits immediately | Missing `.env` vars | Check `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| No audio transcribed | SIP participant not bound | Ensure `session._room_io.set_participant()` is reached in logs |
| Recording not in bucket | Wrong S3 region or credentials | Set `SUPABASE_S3_REGION=us-east-1`, verify access key |
| "⚠ Not saved to DB" in modal | Supabase insert error | Check `SUPABASE_SERVICE_ROLE_KEY` in `dashboard/.env.local` |
| Agent asks multiple questions at once | LLM ignoring prompt | Ensure paid Groq key is set; `max_completion_tokens=300` is set |
| `RecordingsPanel` build error | Stale `.next` cache | `Remove-Item -Recurse dashboard\.next` then restart dev server |

---

## Branch

```
git checkout ngo
```

All NGO-specific code lives on the **`ngo`** branch of `tanishqvyas09/callingagents`.
