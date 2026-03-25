"use client";

/**
 * /ngo  — Team Lajja · Making the Difference
 * Menstrual Hygiene Feedback Survey Dashboard
 *
 * Left panel  : Dispatch form + call controls
 * Right panel : NGOAnalytics live feed (real-time millisecond data from agent)
 */

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";

// Lazy-load the LiveKit analytics component (client-side only)
const NGOAnalytics = dynamic(() => import("../../components/NGOAnalytics"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
      Loading analytics…
    </div>
  ),
});

// ─── Types ────────────────────────────────────────────────────────────────────
interface DispatchResult {
  room_name: string;
  ws_url: string;
  token: string;
  job_id?: string;
  phone_number?: string | null;
  error?: string;
}

type CallState = "idle" | "dispatching" | "active" | "error";

// ─── Language info strip ──────────────────────────────────────────────────────
const LANGUAGES = [
  { code: "hi-IN", label: "Hindi", flag: "🇮🇳", note: "Default" },
  { code: "en-IN", label: "English", flag: "🇬🇧", note: "Auto-detected" },
  { code: "te-IN", label: "Telugu", flag: "🌿", note: "Auto-detected" },
];

// ─── Main page ────────────────────────────────────────────────────────────────
export default function NGOPage() {
  const [phoneNumber,   setPhoneNumber]   = useState("");
  const [studentName,   setStudentName]   = useState("");
  const [notes,         setNotes]         = useState("");
  const [callState,     setCallState]     = useState<CallState>("idle");
  const [error,         setError]         = useState<string | null>(null);
  const [dispatchResult, setDispatchResult] = useState<DispatchResult | null>(null);

  // ── Dispatch handler ───────────────────────────────────────────────────────
  const handleDispatch = useCallback(async () => {
    const phone = phoneNumber.trim();
    if (!phone) {
      setError("Enter a phone number (+91…)");
      return;
    }
    setError(null);
    setCallState("dispatching");
    setDispatchResult(null);

    try {
      const res = await fetch("/api/ngo-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone_number:     phone,
          participant_name: studentName || "student",
          notes,
        }),
      });
      const data: DispatchResult = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || "Dispatch failed");
      }

      setDispatchResult(data);
      setCallState("active");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setCallState("error");
    }
  }, [phoneNumber, studentName, notes]);

  // ── Reset ─────────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setCallState("idle");
    setDispatchResult(null);
    setError(null);
    setPhoneNumber("");
    setStudentName("");
    setNotes("");
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-purple-50">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-rose-100 shadow-sm px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🌸</span>
            <div>
              <h1 className="text-xl font-bold text-rose-700">Team Lajja</h1>
              <p className="text-xs text-gray-500">Making the Difference NGO · Menstrual Hygiene Survey</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {LANGUAGES.map(l => (
              <span key={l.code} className="px-2 py-1 rounded-full bg-gray-100 text-xs text-gray-600 flex items-center gap-1">
                <span>{l.flag}</span>
                <span>{l.label}</span>
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* ── Main two-column layout ──────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 py-6 flex gap-6 h-[calc(100vh-80px)]">

        {/* ── Left: Dispatch panel ─────────────────────────────────────── */}
        <aside className="w-96 flex-shrink-0 flex flex-col gap-4">

          {/* Agent info card */}
          <div className="bg-white rounded-2xl border border-rose-200 p-4 shadow-sm">
            <h2 className="font-semibold text-rose-700 mb-3 flex items-center gap-2">
              <span>🤖</span> Agent Configuration
            </h2>
            <div className="space-y-1.5 text-xs text-gray-600">
              <InfoRow label="STT" value="Sarvam saaras:v3 · auto-detect" />
              <InfoRow label="LLM" value="Groq · openai/gpt-oss-120b" />
              <InfoRow label="TTS" value="Sarvam bulbul:v3 · shubh" />
              <InfoRow label="SIP" value="Vobiz trunk (India +91)" />
              <InfoRow label="Languages" value="Hindi · English · Telugu" />
            </div>
          </div>

          {/* Dispatch form */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm flex flex-col gap-3">
            <h2 className="font-semibold text-gray-700 flex items-center gap-2">
              <span>📞</span> Start Feedback Call
            </h2>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Phone Number <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                placeholder="+919876543210"
                value={phoneNumber}
                onChange={e => setPhoneNumber(e.target.value)}
                disabled={callState === "active" || callState === "dispatching"}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Student Name (optional)
              </label>
              <input
                type="text"
                placeholder="Priya Sharma"
                value={studentName}
                onChange={e => setStudentName(e.target.value)}
                disabled={callState === "active" || callState === "dispatching"}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Notes (optional)
              </label>
              <textarea
                rows={2}
                placeholder="School name, district, etc."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                disabled={callState === "active" || callState === "dispatching"}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:bg-gray-50 disabled:text-gray-400 resize-none"
              />
            </div>

            {error && (
              <p className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2 border border-red-200">
                ⚠️ {error}
              </p>
            )}

            {callState === "idle" || callState === "error" ? (
              <button
                onClick={handleDispatch}
                className="w-full bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
              >
                📞 Start Call
              </button>
            ) : callState === "dispatching" ? (
              <button disabled className="w-full bg-rose-300 text-white font-semibold py-2.5 rounded-xl text-sm cursor-not-allowed">
                ⏳ Dispatching agent…
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg border border-green-200">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-green-700 text-xs font-medium">Call active</span>
                </div>
                <button
                  onClick={handleReset}
                  className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl transition-colors text-sm"
                >
                  🔄 New Call
                </button>
              </div>
            )}
          </div>

          {/* Dispatch result info */}
          {dispatchResult && (
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-3 text-xs text-gray-500 space-y-1">
              <div className="font-semibold text-gray-700 mb-1">Session Details</div>
              <InfoRow label="Room" value={dispatchResult.room_name} mono />
              {dispatchResult.job_id && <InfoRow label="Job ID" value={dispatchResult.job_id} mono />}
              <InfoRow label="Phone" value={dispatchResult.phone_number || "—"} />
            </div>
          )}

          {/* Survey question cheat-sheet */}
          <div className="bg-purple-50 rounded-xl border border-purple-200 p-3 text-xs text-purple-700">
            <div className="font-semibold mb-2">📋 Survey Flow (auto-managed by agent)</div>
            <ol className="space-y-1 list-decimal list-inside">
              <li>Menstrual product used before session</li>
              <li>Received &amp; read the awareness book?</li>
              <li>Shared knowledge with family/friends?</li>
              <li>Using distributed sanitary kit?</li>
              <li>Comfortable with cloth pad?</li>
              <li>Will continue using hygienic products?</li>
              <li>If not — reason?</li>
              <li>Rate session 1–5</li>
            </ol>
          </div>
        </aside>

        {/* ── Right: Real-time analytics ───────────────────────────────── */}
        <section className="flex-1 bg-white rounded-2xl border border-gray-200 shadow-sm p-4 overflow-hidden flex flex-col">
          <h2 className="font-semibold text-gray-700 mb-4 flex items-center gap-2 flex-shrink-0">
            <span>📊</span> Real-time Analytics
            <span className="text-xs font-normal text-gray-400 ml-1">(millisecond precision)</span>
          </h2>

          {dispatchResult ? (
            <div className="flex-1 overflow-hidden">
              <NGOAnalytics
                wsUrl={dispatchResult.ws_url}
                token={dispatchResult.token}
                roomName={dispatchResult.room_name}
              />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-4">
              <span className="text-5xl">🌸</span>
              <p className="text-sm text-center max-w-xs">
                Start a call from the left panel to see real-time transcripts, detected languages,
                LLM responses, and per-turn latencies here.
              </p>
              <div className="grid grid-cols-2 gap-3 text-xs text-gray-500 mt-2">
                <div className="bg-gray-50 rounded-lg p-2 border text-center">
                  <div className="font-bold text-blue-600">STT latency</div>
                  <div>Time to transcript</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 border text-center">
                  <div className="font-bold text-violet-600">LLM latency</div>
                  <div>Time to first token</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 border text-center">
                  <div className="font-bold text-green-600">TTS TTFA</div>
                  <div>Time to first audio</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 border text-center">
                  <div className="font-bold text-rose-600">E2E latency</div>
                  <div>Speech → audio out</div>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// ── Small helper ──────────────────────────────────────────────────────────────
function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-1.5">
      <span className="font-medium text-gray-600 w-16 flex-shrink-0">{label}:</span>
      <span className={mono ? "font-mono text-gray-500 truncate" : "text-gray-700"}>{value}</span>
    </div>
  );
}
