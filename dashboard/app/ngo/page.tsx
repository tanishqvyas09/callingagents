"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { NgoStudent } from "../../lib/supabase";

const NGOAnalytics = dynamic(() => import("../../components/NGOAnalytics"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-slate-400 text-sm">
      Loading analytics...
    </div>
  ),
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">

      {/* ── Header ── */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex-shrink-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-rose-600 flex items-center justify-center text-xl font-bold text-white shadow-lg">L</div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">Team Lajja</h1>
              <p className="text-xs text-slate-400">Making the Difference NGO &mdash; Menstrual Hygiene Survey</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {LANGUAGES.map((l) => (
              <span
                key={l.code}
                className="px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-xs font-medium text-slate-300"
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
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-violet-600 flex items-center justify-center text-white text-xs">A</span>
              Agent Configuration
            </h2>
            <div className="space-y-2">
              <ConfigRow label="STT"       value="Sarvam saaras:v3 · auto-detect" />
              <ConfigRow label="LLM"       value="Groq · openai/gpt-oss-120b" />
              <ConfigRow label="TTS"       value="Sarvam bulbul:v3 · shubh" />
              <ConfigRow label="SIP"       value="Vobiz trunk — India +91" />
              <ConfigRow label="Languages" value="hi · en · te · gu · kn + 5 more" />
            </div>
          </div>

          {/* Student search */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-sky-600 flex items-center justify-center text-white text-xs">S</span>
              Find Student
              <span className="text-xs font-normal text-slate-500 ml-1">from campaign records</span>
            </h2>

            {/* Search input */}
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
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent disabled:opacity-50 pr-8"
              />
              {searching && (
                <span className="absolute right-3 top-3 text-slate-400 text-xs animate-spin">o</span>
              )}
              {selectedStudent && (
                <button
                  onClick={handleClearStudent}
                  className="absolute right-2.5 top-2 text-slate-400 hover:text-white text-lg font-bold leading-none"
                  title="Clear"
                >
                  x
                </button>
              )}
            </div>

            {searchError && (
              <p className="text-amber-400 text-xs bg-amber-950 border border-amber-800 rounded-lg px-3 py-2">
                Warning: {searchError}
              </p>
            )}

            {/* Dropdown */}
            {showDropdown && searchResults.length > 0 && (
              <div
                ref={dropdownRef}
                className="border border-slate-700 rounded-xl bg-slate-800 max-h-60 overflow-y-auto divide-y divide-slate-700 shadow-2xl"
              >
                {searchResults.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleSelectStudent(s)}
                    className="w-full text-left px-3 py-3 hover:bg-slate-700 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">{s.student_name}</span>
                      {s.age && (
                        <span className="text-xs text-slate-400 bg-slate-700 px-1.5 py-0.5 rounded">
                          age {s.age}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs font-mono text-sky-400">{s.contact_e164}</span>
                      {s.school_name && (
                        <span className="text-xs text-slate-400 truncate max-w-[150px]">
                          {s.school_name}
                        </span>
                      )}
                      {s.school_city && (
                        <span className="text-xs text-slate-500">{s.school_city}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {showDropdown && !searching && searchResults.length === 0 && searchQuery.trim().length >= 2 && (
              <p className="text-xs text-slate-500 text-center py-2">
                No students found with a valid 10-digit number
              </p>
            )}

            {/* Selected student card */}
            {selectedStudent && (
              <div className="bg-slate-800 border border-sky-800 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white text-sm">{selectedStudent.student_name}</span>
                  {selectedStudent.age && (
                    <span className="text-xs text-slate-300 bg-slate-700 px-2 py-0.5 rounded-full">
                      Age {selectedStudent.age}
                    </span>
                  )}
                </div>
                <div className="font-mono text-sky-400 text-sm">{selectedStudent.contact_e164}</div>
                {selectedStudent.school_name && (
                  <div className="text-xs text-slate-300">{selectedStudent.school_name}</div>
                )}
                {(selectedStudent.school_city || selectedStudent.school_state) && (
                  <div className="text-xs text-slate-500">
                    {[selectedStudent.school_city, selectedStudent.school_state]
                      .filter(Boolean)
                      .join(", ")}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Call form */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-rose-600 flex items-center justify-center text-white text-xs">C</span>
              Start Feedback Call
            </h2>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Phone Number <span className="text-rose-400">*</span>
                <span className="text-slate-600 ml-1">auto-filled or type manually</span>
              </label>
              <input
                type="tel"
                placeholder="+919876543210"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                disabled={busy}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm font-mono text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Student Name</label>
              <input
                type="text"
                placeholder="Priya Sharma"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                disabled={busy}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Notes</label>
              <textarea
                rows={2}
                placeholder="School, city, age — auto-filled from student record"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={busy}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent disabled:opacity-50 resize-none"
              />
            </div>

            {callError && (
              <p className="text-red-400 text-xs bg-red-950 border border-red-800 rounded-lg px-3 py-2">
                {callError}
              </p>
            )}

            {callState === "idle" || callState === "error" ? (
              <button
                onClick={handleDispatch}
                disabled={!phoneNumber.trim()}
                className="w-full bg-rose-600 hover:bg-rose-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
              >
                Call Now
              </button>
            ) : callState === "dispatching" ? (
              <button
                disabled
                className="w-full bg-slate-700 text-slate-400 font-semibold py-3 rounded-xl text-sm cursor-not-allowed"
              >
                Dispatching agent...
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2.5 p-3 bg-emerald-950 border border-emerald-800 rounded-xl">
                  <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse flex-shrink-0" />
                  <span className="text-emerald-300 text-sm font-medium">Call active</span>
                </div>
                <button
                  onClick={handleReset}
                  className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-semibold py-2.5 rounded-xl transition-colors text-sm"
                >
                  New Call
                </button>
              </div>
            )}
          </div>

          {/* Session details */}
          {dispatchResult && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Session</div>
              <MonoRow label="Room"  value={dispatchResult.room_name} />
              {dispatchResult.job_id && <MonoRow label="Job" value={dispatchResult.job_id} />}
              <MonoRow label="Phone" value={dispatchResult.phone_number || "—"} />
            </div>
          )}

          {/* Survey flow */}
          <div className="bg-slate-900 border border-violet-900 rounded-xl p-4">
            <div className="text-xs font-semibold text-violet-400 uppercase tracking-wider mb-3">Survey Flow</div>
            <ol className="space-y-1.5 text-xs text-slate-400 list-none">
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
                  <span className="text-violet-600 font-mono w-4 flex-shrink-0">{i + 1}.</span>
                  <span className="text-slate-300">{q}</span>
                </li>
              ))}
            </ol>
          </div>
        </aside>

        {/* ── Right: Analytics ── */}
        <section className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-emerald-600 flex items-center justify-center text-white text-xs">R</span>
              Real-time Analytics
            </h2>
            <span className="text-xs text-slate-600 font-mono">millisecond precision</span>
          </div>

          {dispatchResult ? (
            <div className="flex-1 overflow-hidden">
              <NGOAnalytics
                wsUrl={dispatchResult.ws_url}
                token={dispatchResult.token}
                roomName={dispatchResult.room_name}
              />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-6">
              <div className="text-center space-y-2">
                <div className="text-4xl font-bold text-slate-700">Lajja</div>
                <p className="text-slate-500 text-sm max-w-sm leading-relaxed">
                  Search for a student on the left and click{" "}
                  <span className="text-rose-400 font-semibold">Call Now</span> to see live
                  transcripts, detected languages, and per-turn latency metrics here.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
                <MetricCard label="STT Latency"  sub="Time to transcript"    color="sky" />
                <MetricCard label="LLM Latency"  sub="Time to first token"   color="violet" />
                <MetricCard label="TTS TTFA"     sub="Time to first audio"   color="emerald" />
                <MetricCard label="E2E Latency"  sub="Speech to audio out"   color="rose" />
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-slate-500 w-20 flex-shrink-0">{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  );
}

function MonoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-slate-500 w-10 flex-shrink-0">{label}</span>
      <span className="font-mono text-slate-300 truncate">{value}</span>
    </div>
  );
}

function MetricCard({
  label,
  sub,
  color,
}: {
  label: string;
  sub: string;
  color: "sky" | "violet" | "emerald" | "rose";
}) {
  const ring: Record<string, string> = {
    sky:     "border-sky-800 bg-sky-950",
    violet:  "border-violet-800 bg-violet-950",
    emerald: "border-emerald-800 bg-emerald-950",
    rose:    "border-rose-800 bg-rose-950",
  };
  const text: Record<string, string> = {
    sky:     "text-sky-400",
    violet:  "text-violet-400",
    emerald: "text-emerald-400",
    rose:    "text-rose-400",
  };
  return (
    <div className={`border rounded-xl p-3 text-center ${ring[color]}`}>
      <div className={`text-xs font-bold ${text[color]}`}>{label}</div>
      <div className="text-xs text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}
