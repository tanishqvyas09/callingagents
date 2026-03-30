"use client";

/**
 * CallResultModal
 *
 * Full-screen overlay shown after a call ends. Displays:
 *  • Student details card
 *  • Full conversation transcript (colour-coded turns)
 *  • 2-line AI-generated summary
 *  • Sentiment analysis: 5 factors × 20 points each (LLM scored)
 *  • Per-question answers extracted from the conversation
 *  • Key insights from the AI
 *  • Call metadata (language, outcome, turn count)
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { AnalysisResult } from "../app/api/ngo-analyze/route";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ConversationTurn {
  role: "user" | "agent";
  text: string;
  lang: string;
  ts_ms: number;
}

export interface CallEndedPayload {
  conversation: ConversationTurn[];
  student_name?: string | null;
  student_age?: number | null;
  school_name?: string | null;
  school_city?: string | null;
  total_turns?: number;
  detected_language?: string;
  phone_number?: string | null;
  room_name?: string | null;
  recording_url?: string | null;
}

interface FullAnalysisResponse {
  analysis: AnalysisResult;
  transcript: ConversationTurn[];
  student: { name?: string | null; age?: number | null; school?: string | null; city?: string | null };
  detected_language: string;
  analyzed_at: string;
  saved_id?: string | null;
  recording_url?: string | null;
}

interface Props {
  payload: CallEndedPayload;
  onClose: () => void;
}

// ─── Survey questions (displayed labels) ─────────────────────────────────────
const SURVEY_QUESTIONS: { key: keyof AnalysisResult["questionnaire"]; label: string }[] = [
  { key: "q1_previous_product",  label: "What product did she use before the session?" },
  { key: "q2_received_book",     label: "Did she receive & read the awareness book?" },
  { key: "q3_shared_knowledge",  label: "Did she share the knowledge with family/friends?" },
  { key: "q4_using_kit",         label: "Is she using the distributed sanitary kit?" },
  { key: "q5_cloth_pad_comfort", label: "How comfortable is she with the cloth pad?" },
  { key: "q6_will_continue",     label: "Will she continue using hygienic products?" },
  { key: "q7_barrier",           label: "What is stopping her from continuing? (if any)" },
  { key: "q8_session_rating",    label: "How did she rate the session? (1–5)" },
];

const SENTIMENT_FACTORS: { key: keyof AnalysisResult["sentiment"]["factors"]; label: string; emoji: string; color: string }[] = [
  { key: "engagement",       label: "Engagement",       emoji: "💬", color: "sky"    },
  { key: "comfort",          label: "Comfort",          emoji: "🌸", color: "pink"   },
  { key: "awareness_gain",   label: "Awareness Gained", emoji: "📚", color: "violet" },
  { key: "product_adoption", label: "Product Adoption", emoji: "✅", color: "emerald"},
  { key: "positivity",       label: "Positivity",       emoji: "⭐", color: "amber"  },
];

const OUTCOME_LABELS: Record<string, { label: string; className: string }> = {
  completed:     { label: "Survey Completed ✓", className: "bg-emerald-900 text-emerald-300 border-emerald-700" },
  partial:       { label: "Partial Survey",      className: "bg-amber-900   text-amber-300   border-amber-700"   },
  unavailable:   { label: "Student Unavailable", className: "bg-slate-700   text-slate-300   border-slate-600"   },
  hung_up_early: { label: "Hung Up Early",       className: "bg-red-900     text-red-300     border-red-700"     },
};

function timeLabel(ts: number) {
  return new Date(ts).toLocaleTimeString("en-IN", { hour12: false });
}

// ─── Sentiment bar ────────────────────────────────────────────────────────────
function SentimentBar({
  value, max = 20, color,
}: { value: number; max?: number; color: string }) {
  const pct = Math.round((value / max) * 100);
  const BAR: Record<string, string> = {
    sky:     "bg-sky-500",
    pink:    "bg-pink-500",
    violet:  "bg-violet-500",
    emerald: "bg-emerald-500",
    amber:   "bg-amber-500",
  };
  const TRACK: Record<string, string> = {
    sky:     "bg-sky-950",
    pink:    "bg-pink-950",
    violet:  "bg-violet-950",
    emerald: "bg-emerald-950",
    amber:   "bg-amber-950",
  };
  return (
    <div className="flex items-center gap-2">
      <div className={`flex-1 h-2.5 rounded-full ${TRACK[color] ?? "bg-slate-800"}`}>
        <div
          className={`h-full rounded-full transition-all duration-700 ${BAR[color] ?? "bg-slate-400"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-slate-300 w-10 text-right">
        {value}/{max}
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function CallResultModal({ payload, onClose }: Props) {
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [result, setResult]             = useState<FullAnalysisResponse | null>(null);
  const [activeTab, setActiveTab]       = useState<"overview" | "transcript" | "raw">("overview");

  // Guard against React Strict Mode double-invoke — only fire once per payload
  const analysisRunRef = useRef(false);

  const runAnalysis = useCallback(async (forced = false) => {
    if (!forced && analysisRunRef.current) return;
    analysisRunRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ngo-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation:       payload.conversation,
          student_name:       payload.student_name,
          student_age:        payload.student_age,
          school_name:        payload.school_name,
          school_city:        payload.school_city,
          detected_language:  payload.detected_language,
          phone_number:       payload.phone_number,
          room_name:          payload.room_name,
          recording_url:      payload.recording_url,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Analysis failed");
      setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [payload]);

  useEffect(() => {
    runAnalysis();
  }, [runAnalysis]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const analysis = result?.analysis;
  const overall  = analysis?.sentiment?.overall ?? 0;

  // Overall score colour
  const scoreColor = overall >= 80 ? "text-emerald-400" : overall >= 55 ? "text-amber-400" : "text-red-400";
  const scoreBgRing = overall >= 80 ? "ring-emerald-500" : overall >= 55 ? "ring-amber-500" : "ring-red-500";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-5xl bg-slate-900 rounded-2xl shadow-2xl border border-slate-700 my-6 flex flex-col overflow-hidden">

        {/* ── Modal header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-600 flex items-center justify-center text-white text-lg font-bold">L</div>
            <div>
              <h2 className="text-base font-bold text-white">Call Result — Team Lajja</h2>
              {result && (
                <p className="text-xs text-slate-400">
                  Analyzed {new Date(result.analyzed_at).toLocaleString("en-IN")}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl font-light leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* ── Loading / Error ── */}
        {loading && (
          <div className="flex flex-col items-center justify-center gap-4 py-20">
            <div className="w-10 h-10 rounded-full border-4 border-rose-500 border-t-transparent animate-spin" />
            <p className="text-slate-400 text-sm">Analyzing conversation with AI…</p>
          </div>
        )}

        {error && !loading && (
          <div className="p-6 space-y-4">
            <div className="bg-red-950 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
              ⚠️ Analysis failed: {error}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => runAnalysis(true)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg"
              >
                Retry Analysis
              </button>
              {/* Still show raw transcript */}
              <button
                onClick={() => setActiveTab("transcript")}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg"
              >
                View Transcript Anyway
              </button>
            </div>
            {/* Fallback transcript without analysis */}
            <RawTranscript turns={payload.conversation} />
          </div>
        )}

        {!loading && !error && result && (
          <>
            {/* ── Tabs ── */}
            <div className="flex gap-1 px-6 pt-4 border-b border-slate-800 flex-shrink-0">
              {(["overview", "transcript", "raw"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors capitalize ${
                    activeTab === tab
                      ? "bg-slate-800 text-white border-x border-t border-slate-700"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {tab === "raw" ? "Raw JSON" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* ── Tab content ── */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">

              {/* ════════════ OVERVIEW TAB ════════════ */}
              {activeTab === "overview" && (
                <>
                  {/* Top row: student card + score circle */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                    {/* Student card */}
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4 space-y-3">
                      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Student Details</h3>
                      <div className="space-y-1.5">
                        <DetailRow icon="👩‍🎓" label="Name"   value={payload.student_name   ?? "—"} />
                        <DetailRow icon="🎂"    label="Age"    value={payload.student_age     ? `${payload.student_age} years` : "—"} />
                        <DetailRow icon="🏫"    label="School" value={payload.school_name     ?? "—"} />
                        <DetailRow icon="📍"    label="City"   value={payload.school_city     ?? "—"} />
                        <DetailRow icon="🌐"    label="Lang"   value={payload.detected_language ?? result.detected_language ?? "—"} />
                        <DetailRow icon="📞"    label="Turns"  value={`${payload.total_turns ?? payload.conversation.length} exchanges`} />
                      </div>

                      {/* Call outcome badge */}
                      {analysis?.call_outcome && (
                        <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${OUTCOME_LABELS[analysis.call_outcome]?.className ?? ""}`}>
                          {OUTCOME_LABELS[analysis.call_outcome]?.label ?? analysis.call_outcome}
                        </div>
                      )}
                    </div>

                    {/* Score circle + summary */}
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4 flex flex-col gap-4">
                      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Overall Sentiment Score</h3>
                      <div className="flex items-center gap-5">
                        {/* Circular score */}
                        <div className={`flex-shrink-0 w-24 h-24 rounded-full ring-4 ${scoreBgRing} bg-slate-900 flex flex-col items-center justify-center`}>
                          <span className={`text-3xl font-extrabold ${scoreColor}`}>{overall}</span>
                          <span className="text-xs text-slate-500 font-medium">/ 100</span>
                        </div>
                        {/* Summary */}
                        {analysis?.summary && (
                          <div className="flex-1">
                            <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-1.5">AI Summary</p>
                            <p className="text-sm text-slate-200 leading-relaxed">{analysis.summary}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Call Recording Player */}
                  {(result?.recording_url || payload.recording_url) && (
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4">
                      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">🎙️ Call Recording</h3>
                      <audio
                        controls
                        preload="none"
                        className="w-full h-10 rounded-lg"
                        src={result?.recording_url || payload.recording_url || ""}
                      >
                        Your browser does not support the audio element.
                      </audio>
                      <p className="text-xs text-slate-500 mt-2">
                        Recording may take a few seconds to become available after the call ends.
                      </p>
                    </div>
                  )}

                  {/* Sentiment breakdown */}
                  {analysis?.sentiment && (
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
                      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Sentiment Breakdown (5 factors × 20 pts each)</h3>
                      <div className="space-y-4">
                        {SENTIMENT_FACTORS.map((f) => {
                          const score    = analysis.sentiment.factors[f.key] ?? 0;
                          const reason   = analysis.sentiment.reasoning?.[f.key] ?? "";
                          return (
                            <div key={f.key} className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-slate-200">
                                  {f.emoji} {f.label}
                                </span>
                              </div>
                              <SentimentBar value={score} max={20} color={f.color} />
                              {reason && (
                                <p className="text-xs text-slate-500 pl-1">{reason}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Q&A answers */}
                  {analysis?.questionnaire && (
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
                      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Survey Responses</h3>
                      <div className="space-y-3">
                        {SURVEY_QUESTIONS.map((sq, i) => {
                          const answer = analysis.questionnaire[sq.key];
                          return (
                            <div key={sq.key} className="flex items-start gap-3">
                              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-violet-900 text-violet-300 text-xs font-bold flex items-center justify-center">
                                {i + 1}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-slate-400 mb-0.5">{sq.label}</p>
                                <p className={`text-sm font-medium ${answer ? "text-slate-100" : "text-slate-600 italic"}`}>
                                  {answer ?? "Not asked / not answered"}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Key insights */}
                  {analysis?.key_insights && analysis.key_insights.length > 0 && (
                    <div className="bg-slate-800 border border-amber-900 rounded-2xl p-5">
                      <h3 className="text-xs font-semibold text-amber-500 uppercase tracking-wider mb-3">💡 Key Insights</h3>
                      <ul className="space-y-2">
                        {analysis.key_insights.map((insight, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                            <span className="text-amber-500 flex-shrink-0 mt-0.5">•</span>
                            {insight}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}

              {/* ════════════ TRANSCRIPT TAB ════════════ */}
              {activeTab === "transcript" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-200">Full Conversation Transcript</h3>
                    <span className="text-xs text-slate-500">
                      {payload.conversation.length} turns
                    </span>
                  </div>
                  <RawTranscript turns={payload.conversation} />
                </div>
              )}

              {/* ════════════ RAW JSON TAB ════════════ */}
              {activeTab === "raw" && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-200">Raw Analysis JSON</h3>
                  <pre className="bg-slate-950 text-green-300 rounded-xl p-4 text-xs overflow-x-auto font-mono whitespace-pre-wrap border border-slate-800">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* ── Footer actions ── */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950 flex-shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => runAnalysis(true)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg transition-colors"
                >
                  ↺ Re-analyze
                </button>
                {result?.saved_id && (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <span>✓</span>
                    <span>Saved to database</span>
                    <span className="font-mono text-emerald-600 text-xs">#{result.saved_id.slice(0, 8)}</span>
                  </span>
                )}
                {result && !result.saved_id && (
                  <span className="text-xs text-amber-500">⚠ Not saved to DB</span>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `ngo-call-result-${Date.now()}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm rounded-lg transition-colors"
                >
                  ⬇ Export JSON
                </button>
                <button
                  onClick={onClose}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-5 text-center flex-shrink-0">{icon}</span>
      <span className="text-slate-500 w-14 flex-shrink-0 text-xs">{label}</span>
      <span className="text-slate-200 truncate">{value}</span>
    </div>
  );
}

function RawTranscript({ turns }: { turns: ConversationTurn[] }) {
  if (!turns || turns.length === 0) {
    return <p className="text-slate-500 text-sm text-center py-8">No transcript available</p>;
  }
  return (
    <div className="space-y-2">
      {turns.map((t, i) => (
        <div
          key={i}
          className={`rounded-xl px-4 py-3 text-sm flex gap-3 ${
            t.role === "user"
              ? "bg-slate-800 border border-slate-700"
              : "bg-rose-950 border border-rose-900"
          }`}
        >
          <div className="flex-shrink-0 w-16">
            <span className={`text-xs font-bold uppercase ${t.role === "user" ? "text-sky-400" : "text-rose-400"}`}>
              {t.role === "user" ? "Student" : "Agent"}
            </span>
            <div className="text-slate-600 text-xs font-mono mt-0.5">{timeLabel(t.ts_ms)}</div>
          </div>
          <div className="flex-1">
            <p className={t.role === "user" ? "text-slate-200" : "text-rose-200"}>{t.text}</p>
            <span className="text-xs text-slate-600 mt-0.5 inline-block">{t.lang}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
