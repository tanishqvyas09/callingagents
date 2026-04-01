# One-time script: generates assets/hello_hi.wav using Sarvam TTS REST API (shubh voice).
# Run once:  .venv\Scripts\python.exe generate_hello_audio.py
import os, wave, struct, requests, certifi
from dotenv import load_dotenv
load_dotenv(".env")

OUTPUT_PATH = "assets/hello_hi.wav"
os.makedirs("assets", exist_ok=True)

SARVAM_API_KEY = os.getenv("SARVAM_API_KEY")
if not SARVAM_API_KEY:
    raise SystemExit("ERROR: SARVAM_API_KEY not set in .env")

# Call the Sarvam TTS REST endpoint directly
payload = {
    "inputs":               ["हैलो"],
    "target_language_code": "hi-IN",
    "speaker":              "shubh",
    "model":                "bulbul:v3-beta",
    "pace":                 1.0,
    "speech_sample_rate":   16000,
    "enable_preprocessing": True,
}

print("Calling Sarvam TTS API ...")
resp = requests.post(
    "https://api.sarvam.ai/text-to-speech",
    json=payload,
    headers={
        "api-subscription-key": SARVAM_API_KEY,
        "Content-Type":         "application/json",
    },
    verify=certifi.where(),
    timeout=30,
)
if not resp.ok:
    print(f"ERROR {resp.status_code}: {resp.text}")
    raise SystemExit(1)
data = resp.json()

# Response: { "audios": ["<base64-wav>"] }
import base64
audio_b64 = data["audios"][0]
wav_bytes  = base64.b64decode(audio_b64)

# The API returns a complete WAV file — write it straight to disk
with open(OUTPUT_PATH, "wb") as f:
    f.write(wav_bytes)

# Read back to report stats
with wave.open(OUTPUT_PATH, "rb") as wf:
    sr    = wf.getframerate()
    ch    = wf.getnchannels()
    nf    = wf.getnframes()
    dur   = nf / sr * 1000

print(f"Saved  -> {OUTPUT_PATH}")
print(f"  sample_rate={sr}  channels={ch}  frames={nf}  duration={dur:.0f}ms  size={len(wav_bytes)} bytes")
