# 🎙️ VoIP Browser Call — Quick Start

Talk directly to the AI agent from your browser. No phone number, no SIP trunk needed.

---

## ⚡ Run in 2 Steps

**Terminal 1 — Start the AI Agent**
```bash
cd f:\callingagents
.venv\Scripts\python.exe agent.py start
```

**Terminal 2 — Start the Dashboard**
```bash
cd f:\callingagents\dashboard
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** → click **Start VoIP Call** → allow mic → talk.

---

## 🔧 Requirements

| File | Must Have |
|---|---|
| `.env` | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `SARVAM_API_KEY` |
| `dashboard/.env.local` | Same `LIVEKIT_*` vars (Next.js reads its own folder only) |

**`dashboard/.env.local` minimum:**
```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret
VOBIZ_SIP_TRUNK_ID=your_trunk_id
```

---

## 🏗️ How It Works

```
Browser Mic  →  WebRTC  →  LiveKit Room  →  agent.py Worker
                                              ↓
                                   Deepgram STT (nova-2)
                                              ↓
                                   Groq / OpenAI LLM
                                              ↓
                                   Sarvam / OpenAI TTS
                                              ↓
Browser Speaker  ←  WebRTC  ←  LiveKit Room
```

- **No SIP trunk** — direct browser WebRTC, ~100–200ms latency
- **Live transcript** shown in the dashboard UI
- **Mute/unmute** mic mid-call
- **Voice options** — Alloy, Echo, Shimmer (US) · Anushka, Aravind (Indian)
- **LLM options** — GPT-4o-mini or Groq Llama 3.3

---

## 🐛 Common Errors

| Error | Fix |
|---|---|
| `Missing LiveKit Credentials` | Create `dashboard/.env.local` with `LIVEKIT_*` vars |
| `403` Sarvam TTS | Update `SARVAM_API_KEY` in `.env` |
| `ImportError: RoomOptions` | Use `RoomInputOptions` — livekit-agents 1.4.3 |
| `next is not recognized` | Run `npm install` inside `dashboard/` first |
| Mic not working | Allow microphone permission in browser |
