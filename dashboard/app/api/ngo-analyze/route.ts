import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ConversationTurn {
  role: "user" | "agent";
  text: string;
  lang: string;
  ts_ms: number;
}

interface AnalyzeRequest {
  conversation: ConversationTurn[];
  student_name?: string | null;
  student_age?: number | null;
  school_name?: string | null;
  school_city?: string | null;
  detected_language?: string;
  phone_number?: string | null;
  room_name?: string | null;
  recording_url?: string | null;
  /** When set (e.g. "unavailable"), skip Groq analysis and write a minimal row */
  call_outcome_override?: string | null;
  end_reason?: string | null;
}

export interface AnalysisResult {
  summary: string;
  sentiment: {
    overall: number; // 0-100
    factors: {
      engagement: number;       // 0-20: How engaged / responsive was the student?
      comfort: number;          // 0-20: Comfort discussing menstrual hygiene openly
      awareness_gain: number;   // 0-20: Evidence of awareness / knowledge gained
      product_adoption: number; // 0-20: Likelihood of continued product use
      positivity: number;       // 0-20: Overall positive tone & outcome of call
    };
    reasoning: {
      engagement: string;
      comfort: string;
      awareness_gain: string;
      product_adoption: string;
      positivity: string;
    };
  };
  questionnaire: {
    q1_previous_product: string | null;
    q2_received_book: string | null;
    q3_shared_knowledge: string | null;
    q4_using_kit: string | null;
    q5_cloth_pad_comfort: string | null;
    q6_will_continue: string | null;
    q7_barrier: string | null;
    q8_session_rating: string | null;
  };
  call_outcome: "completed" | "partial" | "unavailable" | "hung_up_early";
  language_used: string;
  key_insights: string[];
}

// ─── Build transcript string ──────────────────────────────────────────────────
function buildTranscriptText(turns: ConversationTurn[]): string {
  return turns
    .map((t) => `${t.role === "user" ? "STUDENT" : "AGENT"}: ${t.text}`)
    .join("\n");
}

// ─── Route handler ────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const body: AnalyzeRequest = await request.json();
    const { conversation, student_name, student_age, school_name, school_city, detected_language, phone_number, room_name, recording_url, call_outcome_override, end_reason } = body;

    // ── Fast path: call failed / busy / unanswered ─────────────────────────
    // The agent sends call_outcome_override="unavailable" when the call ended
    // without any conversation (dial failed, busy, no answer, etc.).
    // We skip Groq analysis and write a minimal "unavailable" row so the
    // campaign poller can move on.
    if (call_outcome_override && (!conversation || conversation.length === 0)) {
      const now = new Date().toISOString();
      const row = {
        room_name:              room_name     ?? null,
        phone_number:           phone_number  ?? null,
        call_started_at:        now,
        call_ended_at:          now,
        call_duration_seconds:  0,
        call_outcome:           call_outcome_override,
        total_turns:            0,
        detected_language:      detected_language ?? null,
        analyzed_at:            now,
        student_name:           student_name ?? null,
        student_age:            student_age  ?? null,
        school_name:            school_name  ?? null,
        school_city:            school_city  ?? null,
        transcript:             [],
        summary:                `Call ${call_outcome_override}: ${end_reason || "no answer"}`,
        sentiment_overall:      null,
        sentiment_engagement:   null,
        sentiment_comfort:      null,
        sentiment_awareness_gain: null,
        sentiment_product_adoption: null,
        sentiment_positivity:   null,
        sentiment_reasoning:    null,
        q1_previous_product:    null,
        q2_received_book:       null,
        q3_shared_knowledge:    null,
        q4_using_kit:           null,
        q5_cloth_pad_comfort:   null,
        q6_will_continue:       null,
        q7_barrier:             null,
        q8_session_rating:      null,
        key_insights:           [end_reason || "Call was not answered"],
        recording_url:          recording_url ?? null,
      };

      const { data: inserted, error: dbError } = await supabaseServer
        .from("ngo_call_results")
        .insert(row)
        .select("id")
        .single();

      if (dbError && dbError.code !== "23505") {
        console.error("[ngo-analyze] Supabase insert error (unavailable):", dbError.message);
      } else {
        console.log(`[ngo-analyze] Saved ${call_outcome_override} result: ${inserted?.id ?? "dedup"}`);
      }

      return NextResponse.json({
        call_outcome: call_outcome_override,
        saved_id: inserted?.id ?? null,
        skipped_analysis: true,
      });
    }

    if (!conversation || conversation.length === 0) {
      return NextResponse.json({ error: "No conversation provided" }, { status: 400 });
    }

    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
    }

    const transcriptText = buildTranscriptText(conversation);
    const studentContext = [
      student_name ? `Name: ${student_name}` : null,
      student_age ? `Age: ${student_age}` : null,
      school_name ? `School: ${school_name}` : null,
      school_city ? `City: ${school_city}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    const systemPrompt = `You are an expert analyst for Team Lajja, an NGO running menstrual hygiene awareness programs for school girls in India.

Your task is to analyze a call transcript from a feedback survey and produce a structured JSON analysis.

The survey questions were:
Q1. Before the session, what did you use during your period? (cloth, pad, nothing, etc.)
Q2. Did you receive and read the book from our session?
Q3. Have you shared the book or what you learned with family or friends?
Q4. Are you currently using the sanitary pad kit we distributed?
Q5. If using cloth pad — are you comfortable using it? Any challenges?
Q6. After this session, will you continue using hygienic menstrual products?
Q7. If not continuing — what is stopping you? (cost, availability, family, other)
Q8. On a scale of 1–5, how helpful was the session overall?

IMPORTANT: Return ONLY valid JSON, no markdown, no explanation. Return exactly this schema:
{
  "summary": "2-line plain-English summary of the call",
  "sentiment": {
    "overall": <0-100 integer>,
    "factors": {
      "engagement": <0-20 integer>,
      "comfort": <0-20 integer>,
      "awareness_gain": <0-20 integer>,
      "product_adoption": <0-20 integer>,
      "positivity": <0-20 integer>
    },
    "reasoning": {
      "engagement": "<1 sentence why>",
      "comfort": "<1 sentence why>",
      "awareness_gain": "<1 sentence why>",
      "product_adoption": "<1 sentence why>",
      "positivity": "<1 sentence why>"
    }
  },
  "questionnaire": {
    "q1_previous_product": "<answer or null>",
    "q2_received_book": "<yes/no/partial or null>",
    "q3_shared_knowledge": "<yes/no/partial or null>",
    "q4_using_kit": "<yes/no or null>",
    "q5_cloth_pad_comfort": "<comfortable/uncomfortable/not applicable or null>",
    "q6_will_continue": "<yes/no/maybe or null>",
    "q7_barrier": "<answer or null>",
    "q8_session_rating": "<1-5 rating or null>"
  },
  "call_outcome": "completed|partial|unavailable|hung_up_early",
  "language_used": "<primary language of call>",
  "key_insights": ["<insight 1>", "<insight 2>", "<insight 3>"]
}`;

    const userMessage = `${studentContext ? `Student: ${studentContext}\n\n` : ""}Transcript:\n${transcriptText}`;

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        temperature: 0.1,
        max_tokens: 8000,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!groqResponse.ok) {
      const err = await groqResponse.text();
      console.error("[ngo-analyze] Groq error:", err);
      return NextResponse.json({ error: "LLM analysis failed", detail: err }, { status: 502 });
    }

    const groqData = await groqResponse.json();
    const rawContent = groqData.choices?.[0]?.message?.content ?? "{}";

    let analysis: AnalysisResult;
    try {
      // Strip markdown code fences if the model wraps its output in ```json … ```
      const cleaned = rawContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      analysis = JSON.parse(cleaned);
    } catch {
      console.error("[ngo-analyze] JSON parse error, raw:", rawContent);
      return NextResponse.json({ error: "Failed to parse LLM response" }, { status: 502 });
    }

    // Ensure overall = sum of factors if LLM didn't compute it correctly
    if (analysis.sentiment?.factors) {
      const f = analysis.sentiment.factors;
      const computed = (f.engagement ?? 0) + (f.comfort ?? 0) + (f.awareness_gain ?? 0) + (f.product_adoption ?? 0) + (f.positivity ?? 0);
      analysis.sentiment.overall = computed;
    }

    // ── Persist to Supabase ──────────────────────────────────────────────────
    const analyzedAt = new Date().toISOString();
    try {
      // Derive call timestamps from first/last transcript turn
      const firstTurn = conversation[0];
      const lastTurn  = conversation[conversation.length - 1];
      const startedAt = firstTurn ? new Date(firstTurn.ts_ms).toISOString() : null;
      const endedAt   = lastTurn  ? new Date(lastTurn.ts_ms).toISOString()  : null;
      const durationSeconds =
        firstTurn && lastTurn
          ? Math.round((lastTurn.ts_ms - firstTurn.ts_ms) / 1000)
          : null;

      const row = {
        // Call metadata
        room_name:              room_name     ?? null,
        phone_number:           phone_number  ?? null,
        call_started_at:        startedAt,
        call_ended_at:          endedAt,
        call_duration_seconds:  durationSeconds,
        call_outcome:           analysis.call_outcome ?? null,
        total_turns:            conversation.filter((t) => t.role === "user").length,
        detected_language:      detected_language ?? analysis.language_used ?? null,
        analyzed_at:            analyzedAt,

        // Student details
        student_name:           student_name ?? null,
        student_age:            student_age  ?? null,
        school_name:            school_name  ?? null,
        school_city:            school_city  ?? null,

        // Full transcript
        transcript: conversation,

        // AI summary
        summary: analysis.summary ?? null,

        // Sentiment scores
        sentiment_overall:          analysis.sentiment?.overall             ?? null,
        sentiment_engagement:       analysis.sentiment?.factors?.engagement        ?? null,
        sentiment_comfort:          analysis.sentiment?.factors?.comfort           ?? null,
        sentiment_awareness_gain:   analysis.sentiment?.factors?.awareness_gain    ?? null,
        sentiment_product_adoption: analysis.sentiment?.factors?.product_adoption  ?? null,
        sentiment_positivity:       analysis.sentiment?.factors?.positivity        ?? null,

        // Sentiment reasoning (JSONB)
        sentiment_reasoning: analysis.sentiment?.reasoning ?? null,

        // Questionnaire answers
        q1_previous_product:   analysis.questionnaire?.q1_previous_product  ?? null,
        q2_received_book:      analysis.questionnaire?.q2_received_book      ?? null,
        q3_shared_knowledge:   analysis.questionnaire?.q3_shared_knowledge   ?? null,
        q4_using_kit:          analysis.questionnaire?.q4_using_kit          ?? null,
        q5_cloth_pad_comfort:  analysis.questionnaire?.q5_cloth_pad_comfort  ?? null,
        q6_will_continue:      analysis.questionnaire?.q6_will_continue      ?? null,
        q7_barrier:            analysis.questionnaire?.q7_barrier            ?? null,
        q8_session_rating:     analysis.questionnaire?.q8_session_rating     ?? null,

        // Key insights
        key_insights: analysis.key_insights ?? null,

        // Call recording (from LiveKit Egress → Supabase bucket)
        recording_url: recording_url ?? null,
      };

      const { data: inserted, error: dbError } = await supabaseServer
        .from("ngo_call_results")
        .insert(row)
        .select("id")
        .single();

      if (dbError) {
        // 23505 = unique_violation — duplicate row, safe to ignore
        if (dbError.code === "23505") {
          console.log("[ngo-analyze] Duplicate row skipped (dedup constraint)");
        } else {
          console.error("[ngo-analyze] Supabase insert error:", dbError.message);
        }
        // Don't fail the request — return analysis even if DB write fails
      } else {
        console.log("[ngo-analyze] Saved call result:", inserted?.id);
      }

      return NextResponse.json({
        analysis,
        transcript: conversation,
        student: { name: student_name, age: student_age, school: school_name, city: school_city },
        detected_language: detected_language ?? "hi-IN",
        analyzed_at: analyzedAt,
        saved_id: inserted?.id ?? null,
        recording_url: recording_url ?? null,
      });
    } catch (dbErr) {
      console.error("[ngo-analyze] Supabase unexpected error:", dbErr);
      // Return analysis anyway
      return NextResponse.json({
        analysis,
        transcript: conversation,
        student: { name: student_name, age: student_age, school: school_name, city: school_city },
        detected_language: detected_language ?? "hi-IN",
        analyzed_at: analyzedAt,
        saved_id: null,
        recording_url: recording_url ?? null,
      });
    }
  } catch (err) {
    console.error("[ngo-analyze] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
