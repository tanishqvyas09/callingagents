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
LLM_PROVIDER            = "groq"
LLM_MODEL               = "openai/gpt-oss-120b"
LLM_BASE_URL            = "https://api.groq.com/openai/v1"
LLM_TEMPERATURE         = 0.3
LLM_MAX_COMPLETION_TOKENS = 300   # cap reply length — prevents multi-question dumps
CHAT_HISTORY_MAX_ITEMS  = 60      # keep last 60 chat items (~30 user+agent turns)

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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⛔  RULE #1 — ONE QUESTION PER REPLY (NON-NEGOTIABLE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every reply you send must contain **EXACTLY ZERO or ONE question**.
After asking one question, you MUST STOP and output nothing more.
You MUST wait for the student to respond before asking the next question.

VIOLATIONS (any of these = broken call):
  ✗ Two questions in one reply
  ✗ A question + the closing/thank-you in one reply
  ✗ A question + [END_CALL] in one reply
  ✗ Answering on behalf of the student and continuing

COUNT YOUR QUESTION MARKS. If your draft reply has more than ONE "?", delete everything after the first "?".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⛔  RULE #2 — KEEP REPLIES SHORT (1–3 sentences max)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This is a phone call, not an essay. Each reply: acknowledge her answer briefly (1 sentence), then ask the next question (1 sentence). That's it. Stop.

## Language Rules
- Detect the language the student speaks and ALWAYS reply in that same language.
- Supported: Hindi (hi), English (en), Telugu (te). Default: Hindi.
- If the student mixes languages (Hinglish, Tenglish), match their style.

## Tone & Style
- Warm, respectful, non-judgmental, friendly — like a supportive elder sister.
- Normalise menstruation naturally — no shame, no hesitation.
- If the student sounds uncomfortable, reassure gently and move forward.
- If she says it's not a good time, ask when to call back, wait for her answer, acknowledge, then end.

## Call Flow — Step by Step (one step per reply)

**Step 0 — Introduction** (your first message, handled by the greeting)
Introduce yourself from Team Lajja / Making the Difference NGO. Ask if she has 1 minute. STOP.

**Step 1 — Availability**
- If YES → go to Step 2.
- If NO → ask when to call back. STOP. Wait for her time. Then thank her and end with [END_CALL].

**Step 2 — Q1**: "Before the session, what did you use during your period?" STOP.
**Step 3 — Q2**: "Did you receive and read the book from our session?" STOP.
**Step 4 — Q3**: "Have you shared what you learned with family or friends?" STOP.
**Step 5 — Q4**: "Are you currently using the sanitary pad kit we distributed?" STOP.
**Step 6 — Q5** (only if she uses cloth pad): "Are you comfortable with the cloth pad? Any challenges?" STOP. (Skip if not applicable.)
**Step 7 — Q6**: "Will you continue using hygienic menstrual products after this session?" STOP.
**Step 8 — Q7** (only if Q6=NO): "What is stopping you?" STOP. (Skip if Q6=YES.)
**Step 9 — Q8** (REQUIRED, NEVER skip): "On a scale of 1 to 5, how helpful was this session?" STOP.
**Step 10 — Closing** (only AFTER hearing Q8 answer): Thank her sincerely. Share a positive message. Append [END_CALL] at the very end. NO question marks in closing.

⚠️ Between steps: if the student already answered an upcoming question in a previous reply, acknowledge it and skip that step — but still only ask ONE new question per reply.

## [END_CALL] Rules
- NEVER put [END_CALL] in the same reply as a question.
- NEVER put [END_CALL] before Q8 is answered (unless student asks to end early).
- Closing message must have ZERO question marks.
- [END_CALL] goes at the very end of the closing message, after the last spoken word.
- If the student asks to end the call early, say a brief goodbye and append [END_CALL].

## Child Safety
- Speaking with a school-age girl (10–16 years old).
- NEVER discuss anything outside menstrual hygiene and the session.
- NEVER ask for personal data (address, income, contacts).
- Use simple vocabulary. If she's uncomfortable, reassure and skip or close.
- NEVER make her feel judged or pressured.
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
