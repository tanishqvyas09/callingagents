"""
One-time script: generates assets/hello_hi.wav using Google Gemini Live
gemini-3.1-flash-live-preview via WebSocket (same model + same Aoede voice
as the live agent).

Run once:  .venv/Scripts/python.exe generate_hello_audio.py
"""

import asyncio
import os
import wave

import certifi
os.environ["SSL_CERT_FILE"] = certifi.where()

from dotenv import load_dotenv
load_dotenv(".env")

from google import genai
from google.genai import types

OUTPUT_PATH   = "assets/hello_hi.wav"
TTS_MODEL     = "gemini-3.1-flash-live-preview"
TTS_VOICE     = "Aoede"
SAMPLE_RATE   = 24000   # Gemini Live audio output is always 24 kHz PCM mono 16-bit

TEXT = "Hello, kya meri awaaz aa rahi hai?"

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not GOOGLE_API_KEY:
    raise SystemExit("ERROR: GOOGLE_API_KEY not set in .env")


async def generate():
    os.makedirs("assets", exist_ok=True)

    client = genai.Client(
        api_key=GOOGLE_API_KEY,
        http_options={"api_version": "v1alpha"},
    )

    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=types.Content(
            parts=[types.Part(text=(
                "You are a text-to-speech engine. "
                "Speak EXACTLY the text given to you — word for word, nothing added, nothing removed. "
                "Do not greet, do not respond, do not improvise. Just read the text aloud."
            ))]
        ),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=TTS_VOICE,
                )
            )
        ),
    )

    print(f"Connecting to Gemini Live (model={TTS_MODEL}, voice={TTS_VOICE}) ...")
    audio_chunks: list[bytes] = []

    async with client.aio.live.connect(model=TTS_MODEL, config=config) as session:
        # send_realtime_input with text triggers an immediate audio response
        # without needing to stream microphone audio first.
        await session.send_realtime_input(text=TEXT)

        # Collect raw PCM audio chunks until the model signals turn_complete
        async def _collect():
            async for response in session.receive():
                if response.data:
                    audio_chunks.append(response.data)
                sc = getattr(response, "server_content", None)
                if sc and getattr(sc, "turn_complete", False):
                    return

        await asyncio.wait_for(_collect(), timeout=15.0)

    audio_data = b"".join(audio_chunks)
    if not audio_data:
        raise RuntimeError("No audio data received from Gemini Live — check API key / quota")

    num_channels = 1
    sample_width = 2        # 16-bit PCM
    num_frames   = len(audio_data) // (num_channels * sample_width)
    duration_ms  = num_frames / SAMPLE_RATE * 1000

    with wave.open(OUTPUT_PATH, "wb") as wf:
        wf.setnchannels(num_channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio_data)

    print(f"Saved  -> {OUTPUT_PATH}")
    print(f"  model={TTS_MODEL}  voice={TTS_VOICE}  sample_rate={SAMPLE_RATE}Hz")
    print(f"  frames={num_frames}  duration={duration_ms:.0f}ms  size={len(audio_data)} bytes")


if __name__ == "__main__":
    asyncio.run(generate())