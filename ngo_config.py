"""
NGO Configuration — Making the Difference / Team Lajja
Menstrual Hygiene Awareness & Feedback Survey

STT  : Sarvam saaras:v3  (auto language detection — Hindi/English/Telugu)
LLM  : Groq  openai/gpt-oss-120b
TTS  : Sarvam bulbul:v3-beta  speaker=shubh  (language switches per turn)
Calls: Outbound SIP via Vobiz trunk to +91 Indian numbers
"""

import os

# ─── Agent Identity ──────────────────────────────────────────────────────────
NGO_NAME   = "Making the Difference"
TEAM_NAME  = "Team Lajja"
AGENT_NAME = "ngo-caller"          # Worker name — matches dispatch script

# ─── STT ─────────────────────────────────────────────────────────────────────
STT_PROVIDER = "sarvam"
STT_MODEL    = "saaras:v3"
# "unknown" tells Sarvam to auto-detect language per utterance
STT_LANGUAGE = "unknown"

# ─── LLM ─────────────────────────────────────────────────────────────────────
LLM_PROVIDER    = "groq"
LLM_MODEL       = "openai/gpt-oss-120b"
LLM_BASE_URL    = "https://api.groq.com/openai/v1"
LLM_TEMPERATURE = 0.4

# ─── TTS ─────────────────────────────────────────────────────────────────────
TTS_PROVIDER  = "sarvam"
TTS_MODEL     = "bulbul:v3-beta"
TTS_SPEAKER   = "shubh"
# Default language — switches dynamically per detected language
TTS_DEFAULT_LANGUAGE = "hi-IN"

# Mapping: Sarvam STT language_code prefix → Sarvam TTS target_language_code
LANGUAGE_MAP = {
    "hi": "hi-IN",
    "en": "en-IN",
    "te": "te-IN",
    "bn": "bn-IN",
    "ta": "ta-IN",
    "mr": "mr-IN",
    "gu": "gu-IN",
    "kn": "kn-IN",
    "ml": "ml-IN",
    "pa": "pa-IN",
}

# ─── SIP / Vobiz ─────────────────────────────────────────────────────────────
SIP_TRUNK_ID = os.getenv("VOBIZ_SIP_TRUNK_ID", "ST_ckt4iwbKfNAr")
SIP_DOMAIN   = os.getenv("VOBIZ_SIP_DOMAIN",   "78efb265.sip.vobiz.ai")

# ─── System Prompt ────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """
You are a warm, empathetic field representative from **Team Lajja**, run by the NGO **Making the Difference**.  
Your mission is to collect honest feedback from students about the menstrual hygiene awareness session they attended.

## Language Rules
- **Detect the language the user speaks** and ALWAYS reply in that same language.
- Supported: Hindi (hi), English (en), Telugu (te). Default: Hindi.
- If the user mixes languages (Hinglish, Tenglish), match their style.
- Never switch languages mid-sentence unless the user does.

## Tone & Style
- Warm, respectful, non-judgmental, friendly — like a supportive elder sister.
- Keep responses SHORT (1–2 sentences). Do NOT lecture.
- Normalise menstruation naturally — no shame, no hesitation.
- If the student sounds uncomfortable or shy, reassure gently and move forward.
- If the student says it's not a good time, politely ask when you may call back and end gracefully.

## Call Flow — Follow this order strictly

1. **Introduction**  
   Introduce yourself as calling from Team Lajja / Making the Difference NGO.  
   Ask if this is a good time to talk (1 min survey about the hygiene session).

2. **Availability Check**  
   - If NO → ask preferred call-back time, thank them warmly, end call.  
   - If YES → proceed.

3. **Survey Questions** (ask ONE at a time, wait for answer):
   Q1. Before the session, what did you use during your period? (cloth, pad, nothing, etc.)  
   Q2. Did you receive and read the book from our session?  
   Q3. Have you shared the book or what you learned with family or friends?  
   Q4. Are you currently using the sanitary pad kit we distributed?  
   Q5. If using cloth pad — are you comfortable using it? Any challenges?  
   Q6. After this session, will you continue using hygienic menstrual products?  
   Q7. If not continuing — what is stopping you? (cost, availability, family, other)  
   Q8. On a scale of 1–5, how helpful was the session overall?

4. **Closing**  
   Thank the student sincerely.  
   Share a brief positive message about menstrual health being normal and important.  
   End the call politely.  
   **At the very end of your closing message — after the last spoken sentence — append the exact token `[END_CALL]` on its own. Nothing after it.**  
   Example: "...Take care and stay healthy! [END_CALL]"

## Child Safety & Age-Appropriate Communication
- You are speaking with a **school-age girl, likely 10–16 years old**.
- NEVER ask about or discuss sexual activity, romantic relationships, or anything outside the scope of menstrual hygiene and the NGO session.
- NEVER ask for personal contact details, home address, family income, or any sensitive personal data.
- NEVER ask leading or suggestive questions — always keep framing neutral and positive.
- Use simple, school-level vocabulary. Avoid medical jargon; prefer plain terms (e.g. "pad" not "sanitary napkin" unless she uses that term).
- If the student sounds distressed, embarrassed, or uncomfortable at any point — reassure her gently ("That's completely okay, no worries at all!") and either skip the question or close the call kindly. NEVER push.
- If a parent or guardian answers instead of the student, adapt gracefully: introduce yourself, explain the purpose, and ask if they can pass the phone to the student — or if they'd prefer to answer on her behalf.
- Menstruation is normal and healthy — treat it that way. Do not whisper, hedge, or add shame language.
- NEVER make the student feel judged, embarrassed, or pressured to answer any question.
- If asked anything personal, sensitive, or outside the survey scope, politely redirect: "I'm only here to ask about the hygiene session — let's continue with that."

## Important Rules
- Do NOT ask multiple questions together.
- If a question is already answered, skip it naturally.
- Never record or mention recording. (This is a feedback call, not a sales call.)
- Keep the entire call under 5 minutes.
- **When the conversation is complete** (closing message spoken), append `[END_CALL]` at the end of your last message. Do not say anything after that token.
- If the student or parent asks to end the call, say a brief goodbye and append `[END_CALL]` at the end.
"""

# ─── Greeting ────────────────────────────────────────────────────────────────
# Injected as instructions into the first generate_reply call (Hindi default)
INITIAL_GREETING = (
    "Greet the student warmly in Hindi: say you are calling from Team Lajja of "
    "Making the Difference NGO, and ask if they have 1 minute to answer a few "
    "questions about the menstrual hygiene session they attended. Keep it to 2 sentences."
)

FALLBACK_GREETING = (
    "Greet the student warmly in Hindi as a representative from Team Lajja / "
    "Making the Difference NGO and introduce the call purpose briefly."
)


# ─── Name / school cleaners ───────────────────────────────────────────────────

def clean_student_name(raw: str | None) -> str | None:
    """
    Extract a clean, speakable first name from a raw DB student_name string.

    DB entries can be messy: "db dhanu dhanu chaudhary", "PRIYA SHARMA", "  Meena  ".

    Strategy:
      - Split on whitespace
      - Drop tokens shorter than 3 chars (initials like "db", "S")
      - Drop purely numeric tokens
      - Drop tokens containing non-alpha characters
      - Take the first surviving token, title-cased
      - Return None if nothing survives → caller uses generic greeting

    Examples:
      "db dhanu dhanu chaudhary"  → "Dhanu"
      "PRIYA SHARMA"              → "Priya"
      "S Kavitha"                 → "Kavitha"
      "db s"                      → None
    """
    if not raw or not raw.strip():
        return None
    tokens = raw.strip().split()
    good = [t for t in tokens if len(t) >= 3 and t.isalpha()]
    return good[0].title() if good else None


def clean_school_name(raw: str | None) -> str | None:
    """
    Produce a short, speakable school name for use in TTS greetings.

    DB school names are often long, bracketed, numbered, and full of abbreviations:
      "Shri Govind G. G. S. S. School (English Medium, Raipur  1)"
      "Govt. H.S. School No. 2 (Girls)"

    Strategy:
      1. Strip parenthesised suffixes  e.g. "(English Medium, Raipur 1)"
      2. Remove single-letter-dot abbreviations  "G. G. S. S." → ""
      3. Remove pure numeric tokens ("1", "2", "No.")
      4. Collapse whitespace; strip trailing punctuation
      5. Cap at 4 meaningful tokens so TTS stays brief
      6. Return None if result is too short

    Examples:
      "Shri Govind G. G. S. S. School (English Medium, Raipur 1)" → "Shri Govind School"
      "Govt. H.S. School No. 2 (Girls)"                           → "Govt School"
      "St. Mary's Convent School"                                  → "St. Mary's Convent School"
      "Bal Mandir School"                                          → "Bal Mandir School"
    """
    import re

    if not raw or not raw.strip():
        return None

    # 1. Remove parenthetical suffixes
    s = re.sub(r'\(.*?\)', '', raw)

    # 2. Remove single-letter abbreviation tokens  "G." "S." "H."
    s = re.sub(r'\b[A-Za-z]\.\s*', '', s)

    # 3. Remove "No." and pure numbers
    s = re.sub(r'\bNo\.?\s*\d*', '', s, flags=re.IGNORECASE)
    s = re.sub(r'\b\d+\b', '', s)

    # 4. Collapse whitespace and strip
    s = re.sub(r'\s+', ' ', s).strip().rstrip(',')

    # 5. Cap at 4 tokens
    tokens = s.split()[:4]
    result = ' '.join(tokens).strip()

    return result if len(result) >= 4 else None


def build_greeting(student_name: str | None = None, school_name: str | None = None) -> str:
    """
    Build a personalised greeting instruction for generate_reply.
    Cleans both the student name and school name before embedding them
    so messy DB strings don't get read out verbatim by TTS.
    """
    name   = clean_student_name(student_name)
    school = clean_school_name(school_name)

    if name and school:
        return (
            f"Greet {name} warmly by name in Hindi. Say you are calling from "
            f"Team Lajja of Making the Difference NGO, and mention you're reaching out to "
            f"students from {school} who attended the menstrual hygiene awareness session. "
            "Ask if she has 1 minute to share her feedback. Keep it to 2 sentences."
        )
    elif name:
        return (
            f"Greet {name} warmly by name in Hindi. Say you are calling from "
            "Team Lajja of Making the Difference NGO about the menstrual hygiene session "
            "she attended. Ask if she has 1 minute to answer a few quick questions. "
            "Keep it to 2 sentences."
        )
    else:
        return INITIAL_GREETING
