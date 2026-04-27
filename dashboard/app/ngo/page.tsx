"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { NgoStudent } from "../../lib/supabase";
import type { CallEndedPayload } from "../../components/CallResultModal";

const NGOAnalytics = dynamic(() => import("../../components/NGOAnalytics"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-slate-400 text-sm">
      Loading analytics...
    </div>
  ),
});

const CallResultModal = dynamic(() => import("../../components/CallResultModal"), {
  ssr: false,
});

interface DispatchResult {
  room_name: string;
  ws_url: string;
  token: string;
  job_id?: string;
  phone_number?: string | null;
  error?: string;
}

type CallState = "idle" | "dispatching" | "active" | "error";

const LANGUAGES = [
  { code: "hi-IN", label: "Hindi" },
  { code: "en-IN", label: "English" },
  { code: "te-IN", label: "Telugu" },
  { code: "gu-IN", label: "Gujarati" },
  { code: "kn-IN", label: "Kannada" },
];

export default function NGOPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NgoStudent[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<NgoStudent | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [phoneNumber, setPhoneNumber] = useState("");
  const [studentName, setStudentName] = useState("");
  const [notes, setNotes] = useState("");
  const [callState, setCallState] = useState<CallState>("idle");
  const [callError, setCallError] = useState<string | null>(null);
  const [dispatchResult, setDispatchResult] = useState<DispatchResult | null>(null);

  // Call result modal state
  const [callEndedPayload, setCallEndedPayload] = useState<CallEndedPayload | null>(null);

  const handleCallEnded = useCallback((payload: CallEndedPayload) => {
    setCallEndedPayload(payload);
    setCallState("idle");
  }, []);

  // Debounced search
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const res = await fetch(
          `/api/ngo-students?search=${encodeURIComponent(searchQuery.trim())}&limit=30`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Search failed");
        setSearchResults(json.students ?? []);
        setShowDropdown(true);
      } catch (e: unknown) {
        setSearchError(e instanceof Error ? e.message : String(e));
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        searchRef.current && !searchRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSelectStudent = useCallback((s: NgoStudent) => {
    setSelectedStudent(s);
    setPhoneNumber(s.contact_e164);
    setStudentName(s.student_name);
    setNotes(
      [
        s.school_name ? `School: ${s.school_name}` : "",
        s.school_city ? `City: ${s.school_city}` : "",
        s.school_state ? `State: ${s.school_state}` : "",
        s.age ? `Age: ${s.age}` : "",
      ]
        .filter(Boolean)
        .join(" | ")
    );
    setSearchQuery(s.student_name);
    setShowDropdown(false);
    setCallError(null);
  }, []);

  const handleClearStudent = useCallback(() => {
    setSelectedStudent(null);
    setSearchQuery("");
    setPhoneNumber("");
    setStudentName("");
    setNotes("");
    setSearchResults([]);
    setShowDropdown(false);
    setTimeout(() => searchRef.current?.focus(), 50);
  }, []);

  const handleDispatch = useCallback(async () => {
    const phone = phoneNumber.trim();
    if (!phone) {
      setCallError("Select a student or enter a phone number");
      return;
    }
    setCallError(null);
    setCallState("dispatching");
    setDispatchResult(null);
    try {
      const res = await fetch("/api/ngo-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone_number:    phone,
          participant_name: studentName || "student",
          student_name:    studentName || null,
          student_age:     selectedStudent?.age ?? null,
          school_name:     selectedStudent?.school_name ?? null,
          school_city:     selectedStudent?.school_city ?? null,
          notes,
        }),
      });
      const data: DispatchResult = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Dispatch failed");
      setDispatchResult(data);
      setCallState("active");
    } catch (e: unknown) {
      setCallError(e instanceof Error ? e.message : String(e));
      setCallState("error");
    }
  }, [phoneNumber, studentName, notes]);

  const handleReset = useCallback(() => {
    setCallState("idle");
    setDispatchResult(null);
    setCallError(null);
    setPhoneNumber("");
    setStudentName("");
    setNotes("");
    setSelectedStudent(null);
    setSearchQuery("");
    setSearchResults([]);
  }, []);

  const busy = callState === "active" || callState === "dispatching";

  return (
    <div className="min-h-screen text-gray-900 flex flex-col" style={{ background: "linear-gradient(135deg, #f8fafc 0%, #ecfdf5 40%, #f0fdf4 70%, #f8fafc 100%)" }}>

      {/* ── Header ── */}
      <header
        className="flex-shrink-0 px-6 py-4"
        style={{
          background: "rgba(255,255,255,0.78)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(16,185,129,0.12)",
        }}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-xl font-black text-white shadow-md"
              style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
            >
              L
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-tight">Team Lajja</h1>
              <p className="text-xs text-emerald-600 font-medium">Making the Difference NGO &mdash; Menstrual Hygiene Survey</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/ngo/dashboard"
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ background: "linear-gradient(135deg, #10b981, #059669)", boxShadow: "0 2px 8px rgba(16,185,129,0.35)" }}
            >
              <span>📊</span> Dashboard
            </a>
            {LANGUAGES.map((l) => (
              <span
                key={l.code}
                className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-medium text-gray-600"
              >
                {l.label}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-5 flex gap-5 overflow-hidden">

        {/* ── Left sidebar ── */}
        <aside className="w-[380px] flex-shrink-0 flex flex-col gap-4 overflow-y-auto pr-1">

          {/* Agent config */}
          <div className="white-card p-4">
            <h2 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <span
                className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                style={{ background: "linear-gradient(135deg, #8b5cf6, #7c3aed)" }}
              >A</span>
              Agent Configuration
            </h2>
            <div className="space-y-2">
              <ConfigRow label="STT"       value="Gemini Live · auto-detect" />
              <ConfigRow label="LLM"       value="Gemini 2.0 Flash Live" />
              <ConfigRow label="Voice"     value="Aoede (Gemini native)" />
              <ConfigRow label="SIP"       value="LiveKit trunk — India +91" />
              <ConfigRow label="Languages" value="hi · en · te · gu · kn + 5 more" />
            </div>
          </div>

          {/* Student search */}
          <div className="white-card p-4 flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <span
                className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                style={{ background: "linear-gradient(135deg, #0ea5e9, #0284c7)" }}
              >S</span>
              Find Student
              <span className="text-xs font-normal text-gray-400 ml-1">from campaign records</span>
            </h2>

            <div className="relative">
              <input
                ref={searchRef}
                type="text"
                placeholder="Type student name..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (selectedStudent) setSelectedStudent(null);
                }}
                onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                disabled={busy}
                className="input-field pr-8 disabled:opacity-50"
              />
              {searching && (
                <span className="absolute right-3 top-3 w-3 h-3 border-2 border-emerald-300 border-t-emerald-600 rounded-full animate-spin" />
              )}
              {selectedStudent && (
                <button
                  onClick={handleClearStudent}
                  className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-700 text-lg font-bold leading-none"
                  title="Clear"
                >×</button>
              )}
            </div>

            {searchError && (
              <p className="text-amber-700 text-xs bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                ⚠ {searchError}
              </p>
            )}

            {showDropdown && searchResults.length > 0 && (
              <div
                ref={dropdownRef}
                className="border border-emerald-100 rounded-xl bg-white max-h-60 overflow-y-auto divide-y divide-gray-50 shadow-xl"
              >
                {searchResults.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleSelectStudent(s)}
                    className="w-full text-left px-3 py-3 hover:bg-emerald-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-800">{s.student_name}</span>
                      {s.age && (
                        <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-lg">age {s.age}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs font-mono text-sky-600">{s.contact_e164}</span>
                      {s.school_name && (
                        <span className="text-xs text-gray-500 truncate max-w-[150px]">{s.school_name}</span>
                      )}
                      {s.school_city && <span className="text-xs text-gray-400">{s.school_city}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {showDropdown && !searching && searchResults.length === 0 && searchQuery.trim().length >= 2 && (
              <p className="text-xs text-gray-400 text-center py-2">No students found with a valid 10-digit number</p>
            )}

            {selectedStudent && (
              <div
                className="rounded-xl p-3 space-y-1.5"
                style={{ background: "#f0fdf4", border: "1px solid #6ee7b7" }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-800 text-sm">{selectedStudent.student_name}</span>
                  {selectedStudent.age && (
                    <span className="text-xs text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">Age {selectedStudent.age}</span>
                  )}
                </div>
                <div className="font-mono text-sky-600 text-sm">{selectedStudent.contact_e164}</div>
                {selectedStudent.school_name && (
                  <div className="text-xs text-gray-600">{selectedStudent.school_name}</div>
                )}
                {(selectedStudent.school_city || selectedStudent.school_state) && (
                  <div className="text-xs text-gray-400">
                    {[selectedStudent.school_city, selectedStudent.school_state].filter(Boolean).join(", ")}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Call form */}
          <div className="white-card p-4 flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <span
                className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
              >C</span>
              Start Feedback Call
            </h2>

            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                Phone Number <span className="text-red-400">*</span>
                <span className="text-gray-400 ml-1 font-normal">auto-filled or type manually</span>
              </label>
              <input
                type="tel"
                placeholder="+919876543210"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                disabled={busy}
                className="input-field font-mono disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Student Name</label>
              <input
                type="text"
                placeholder="Priya Sharma"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                disabled={busy}
                className="input-field disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Notes</label>
              <textarea
                rows={2}
                placeholder="School, city, age — auto-filled from student record"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={busy}
                className="input-field resize-none disabled:opacity-50"
              />
            </div>

            {callError && (
              <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                ✕ {callError}
              </p>
            )}

            {callState === "idle" || callState === "error" ? (
              <button
                onClick={handleDispatch}
                disabled={!phoneNumber.trim()}
                className="btn-primary w-full py-3 text-sm"
              >
                Call Now
              </button>
            ) : callState === "dispatching" ? (
              <button disabled className="w-full py-3 rounded-xl bg-gray-100 text-gray-400 font-semibold text-sm cursor-not-allowed flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-gray-300 border-t-emerald-500 rounded-full animate-spin" />
                Dispatching agent…
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2.5 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  <span className="text-emerald-700 text-sm font-semibold">Call active</span>
                </div>
                <button onClick={handleReset} className="btn-ghost w-full py-2.5 text-sm">
                  New Call
                </button>
              </div>
            )}
          </div>

          {/* View last result */}
          {callEndedPayload && callState === "idle" && (
            <button
              onClick={() => setCallEndedPayload(callEndedPayload)}
              className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
              style={{ background: "#f5f3ff", border: "1px solid #ddd6fe", color: "#7c3aed" }}
            >
              <span>📊</span> View Last Call Results
            </button>
          )}

          {/* Session details */}
          {dispatchResult && (
            <div className="white-card p-3 space-y-2">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Session</div>
              <MonoRow label="Room"  value={dispatchResult.room_name} />
              {dispatchResult.job_id && <MonoRow label="Job" value={dispatchResult.job_id} />}
              <MonoRow label="Phone" value={dispatchResult.phone_number || "—"} />
            </div>
          )}

          {/* Survey flow */}
          <div className="white-card p-4" style={{ borderColor: "#ddd6fe" }}>
            <div className="text-xs font-semibold text-violet-500 uppercase tracking-wider mb-3">Survey Flow</div>
            <ol className="space-y-1.5 text-xs list-none">
              {[
                "Product used before session",
                "Received & read awareness book?",
                "Shared with family / friends?",
                "Using distributed sanitary kit?",
                "Comfortable with cloth pad?",
                "Will continue hygienic products?",
                "If not — what is stopping you?",
                "Rate session 1–5",
              ].map((q, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-violet-400 font-mono w-4 flex-shrink-0">{i + 1}.</span>
                  <span className="text-gray-600">{q}</span>
                </li>
              ))}
            </ol>
          </div>
        </aside>

        {/* ── Right: Analytics ── */}
        <section
          className="flex-1 rounded-2xl p-5 flex flex-col overflow-hidden"
          style={{
            background: "rgba(255,255,255,0.78)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "1px solid rgba(16,185,129,0.12)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 4px 20px rgba(16,185,129,0.06)",
          }}
        >
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <span
                className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
              >R</span>
              Real-time Analytics
            </h2>
            <span className="text-xs text-gray-400 font-mono">millisecond precision</span>
          </div>

          {dispatchResult ? (
            <div className="flex-1 overflow-hidden">
              <NGOAnalytics
                wsUrl={dispatchResult.ws_url}
                token={dispatchResult.token}
                roomName={dispatchResult.room_name}
                onCallEnded={handleCallEnded}
              />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-6">
              <div className="text-center space-y-2">
                <div className="text-4xl font-bold text-gray-200">Lajja</div>
                <p className="text-gray-400 text-sm max-w-sm leading-relaxed">
                  Search for a student on the left and click{" "}
                  <span className="text-emerald-600 font-semibold">Call Now</span> to see live
                  transcripts, detected languages, and per-turn latency metrics here.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
                <MetricCard label="STT Latency"  sub="Time to transcript"  color="sky" />
                <MetricCard label="LLM Latency"  sub="Time to first token" color="violet" />
                <MetricCard label="TTS TTFA"     sub="Time to first audio" color="emerald" />
                <MetricCard label="E2E Latency"  sub="Speech to audio out" color="rose" />
              </div>
            </div>
          )}
        </section>
      </main>

      {callEndedPayload && (
        <CallResultModal payload={callEndedPayload} onClose={() => setCallEndedPayload(null)} />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-gray-400 w-20 flex-shrink-0">{label}</span>
      <span className="text-gray-700 font-medium">{value}</span>
    </div>
  );
}

function MonoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-gray-400 w-10 flex-shrink-0">{label}</span>
      <span className="font-mono text-gray-600 truncate">{value}</span>
    </div>
  );
}

function MetricCard({ label, sub, color }: { label: string; sub: string; color: "sky" | "violet" | "emerald" | "rose" }) {
  const styles: Record<string, { bg: string; border: string; text: string }> = {
    sky:     { bg: "#f0f9ff", border: "#bae6fd", text: "#0284c7" },
    violet:  { bg: "#f5f3ff", border: "#ddd6fe", text: "#7c3aed" },
    emerald: { bg: "#f0fdf4", border: "#bbf7d0", text: "#059669" },
    rose:    { bg: "#fff1f2", border: "#fecdd3", text: "#e11d48" },
  };
  const s = styles[color];
  return (
    <div className="rounded-xl p-3 text-center border" style={{ background: s.bg, borderColor: s.border }}>
      <div className="text-xs font-bold" style={{ color: s.text }}>{label}</div>
      <div className="text-xs text-gray-400 mt-0.5">{sub}</div>
    </div>
  );
}