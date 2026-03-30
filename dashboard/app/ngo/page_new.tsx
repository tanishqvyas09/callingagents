"use client";

/**
 * /ngo  â€” Team Lajja Â· Making the Difference
 * Menstrual Hygiene Feedback Survey Dashboard
 *
 * Left panel  : Student picker (Supabase) + call controls
 * Right panel : NGOAnalytics live feed (real-time data from agent)
 */

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { NgoStudent } from "../../lib/supabase";

// Lazy-load the LiveKit analytics component (client-side only)
const NGOAnalytics = dynamic(() => import("../../components/NGOAnalytics"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
      Loading analyticsâ€¦
    </div>
  ),
});

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface DispatchResult {
  room_name: string;
  ws_url: string;
  token: string;
  job_id?: string;
  phone_number?: string | null;
  error?: string;
}

type CallState = "idle" | "dispatching" | "active" | "error";

// â”€â”€â”€ Language info strip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const LANGUAGES = [
  { code: "hi-IN", label: "Hindi",    flag: "ðŸ‡®ðŸ‡³" },
  { code: "en-IN", label: "English",  flag: "ðŸ‡¬ðŸ‡§" },
  { code: "te-IN", label: "Telugu",   flag: "ðŸŒ¿" },
  { code: "gu-IN", label: "Gujarati", flag: "ðŸŸ " },
  { code: "kn-IN", label: "Kannada",  flag: "ðŸŸ¡" },
];

// â”€â”€â”€ Main page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function NGOPage() {
  // â”€â”€ Student picker state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [searchQuery,     setSearchQuery]     = useState("");
  const [searchResults,   setSearchResults]   = useState<NgoStudent[]>([]);
  const [searching,       setSearching]       = useState(false);
  const [searchError,     setSearchError]     = useState<string | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<NgoStudent | null>(null);
  const [showDropdown,    setShowDropdown]    = useState(false);
  const searchRef  = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // â”€â”€ Call form state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [phoneNumber,    setPhoneNumber]    = useState("");
  const [studentName,    setStudentName]    = useState("");
  const [notes,          setNotes]          = useState("");
  const [callState,      setCallState]      = useState<CallState>("idle");
  const [callError,      setCallError]      = useState<string | null>(null);
  const [dispatchResult, setDispatchResult] = useState<DispatchResult | null>(null);

  // â”€â”€ Debounced search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        searchRef.current  && !searchRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // â”€â”€ Select student â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleSelectStudent = useCallback((s: NgoStudent) => {
    setSelectedStudent(s);
    setPhoneNumber(s.contact_e164);
    setStudentName(s.student_name);
    setNotes(
      [
        s.school_name   ? `School: ${s.school_name}`   : "",
        s.school_city   ? `City: ${s.school_city}`     : "",
        s.school_state  ? `State: ${s.school_state}`   : "",
        s.age           ? `Age: ${s.age}`              : "",
      ].filter(Boolean).join(" Â· ")
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

  // â”€â”€ Dispatch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleDispatch = useCallback(async () => {
    const phone = phoneNumber.trim();
    if (!phone) { setCallError("Select a student or enter a phone number"); return; }
    setCallError(null);
    setCallState("dispatching");
    setDispatchResult(null);
    try {
      const res = await fetch("/api/ngo-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_number: phone, participant_name: studentName || "student", notes }),
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

  // â”€â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-purple-50">
      {/* Header */}
      <header className="bg-white border-b border-rose-100 shadow-sm px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">ðŸŒ¸</span>
            <div>
              <h1 className="text-xl font-bold text-rose-700">Team Lajja</h1>
              <p className="text-xs text-gray-500">Making the Difference NGO Â· Menstrual Hygiene Survey</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {LANGUAGES.map(l => (
              <span key={l.code} className="px-2 py-1 rounded-full bg-gray-100 text-xs text-gray-600 flex items-center gap-1">
                <span>{l.flag}</span><span>{l.label}</span>
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* Main layout */}
      <main className="max-w-7xl mx-auto px-4 py-6 flex gap-6 h-[calc(100vh-80px)]">

        {/* â”€â”€ Left â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <aside className="w-96 flex-shrink-0 flex flex-col gap-4 overflow-y-auto">

          {/* Agent config */}
          <div className="bg-white rounded-2xl border border-rose-200 p-4 shadow-sm">
            <h2 className="font-semibold text-rose-700 mb-3 flex items-center gap-2">
              <span>ðŸ¤–</span> Agent Configuration
            </h2>
            <div className="space-y-1.5 text-xs text-gray-600">
              <InfoRow label="STT"       value="Sarvam saaras:v3 Â· auto-detect" />
              <InfoRow label="LLM"       value="Groq Â· openai/gpt-oss-120b" />
              <InfoRow label="TTS"       value="Sarvam bulbul:v3 Â· shubh" />
              <InfoRow label="SIP"       value="Vobiz trunk (India +91)" />
              <InfoRow label="Languages" value="hi Â· en Â· te Â· gu Â· kn + 6 more" />
            </div>
          </div>

          {/* Student search */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm flex flex-col gap-3">
            <h2 className="font-semibold text-gray-700 flex items-center gap-2">
              <span>ðŸ”</span> Find Student
              <span className="text-xs font-normal text-gray-400">(from campaign records)</span>
            </h2>

            {/* Search input */}
            <div className="relative">
              <input
                ref={searchRef}
                type="text"
                placeholder="Type student name to searchâ€¦"
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); if (selectedStudent) setSelectedStudent(null); }}
                onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                disabled={callState === "active" || callState === "dispatching"}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm pr-8 focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:bg-gray-50 disabled:text-gray-400"
              />
              {searching && <span className="absolute right-2.5 top-2.5 text-gray-400 text-xs">â³</span>}
              {selectedStudent && (
                <button onClick={handleClearStudent} className="absolute right-2 top-1.5 text-gray-400 hover:text-gray-700 text-lg font-bold leading-none" title="Clear">Ã—</button>
              )}
            </div>

            {searchError && (
              <p className="text-amber-600 text-xs bg-amber-50 rounded-lg px-2 py-1.5 border border-amber-200">âš ï¸ {searchError}</p>
            )}

            {/* Dropdown results */}
            {showDropdown && searchResults.length > 0 && (
              <div ref={dropdownRef} className="border border-gray-200 rounded-xl shadow-lg bg-white max-h-56 overflow-y-auto divide-y divide-gray-100">
                {searchResults.map(s => (
                  <button key={s.id} onClick={() => handleSelectStudent(s)}
                    className="w-full text-left px-3 py-2.5 hover:bg-rose-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-800">{s.student_name}</span>
                      {s.age && <span className="text-xs text-gray-400">age {s.age}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-rose-600 font-mono">{s.contact_e164}</span>
                      {s.school_name && <span className="text-xs text-gray-400 truncate max-w-[140px]">ðŸ« {s.school_name}</span>}
                      {s.school_city && <span className="text-xs text-gray-400">ðŸ“ {s.school_city}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {showDropdown && !searching && searchResults.length === 0 && searchQuery.trim().length >= 2 && (
              <p className="text-xs text-gray-400 text-center py-1">No students found with a valid phone number</p>
            )}

            {/* Selected student card */}
            {selectedStudent && (
              <div className="bg-rose-50 rounded-xl border border-rose-200 p-3 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-rose-800 text-sm">{selectedStudent.student_name}</span>
                  {selectedStudent.age && <span className="text-rose-500">Age {selectedStudent.age}</span>}
                </div>
                <div className="font-mono text-rose-600">{selectedStudent.contact_e164}</div>
                {selectedStudent.school_name && <div className="text-gray-600">ðŸ« {selectedStudent.school_name}</div>}
                {(selectedStudent.school_address || selectedStudent.school_city) && (
                  <div className="text-gray-500">
                    ðŸ“ {[selectedStudent.school_address, selectedStudent.school_city, selectedStudent.school_state].filter(Boolean).join(", ")}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Call form */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm flex flex-col gap-3">
            <h2 className="font-semibold text-gray-700 flex items-center gap-2">
              <span>ðŸ“ž</span> Start Feedback Call
            </h2>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Phone Number <span className="text-red-500">*</span>
                <span className="text-gray-400 font-normal ml-1">(auto-filled or type manually)</span>
              </label>
              <input type="tel" placeholder="+919876543210" value={phoneNumber}
                onChange={e => setPhoneNumber(e.target.value)}
                disabled={callState === "active" || callState === "dispatching"}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Student Name</label>
              <input type="text" placeholder="Priya Sharma" value={studentName}
                onChange={e => setStudentName(e.target.value)}
                disabled={callState === "active" || callState === "dispatching"}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
              <textarea rows={2} placeholder="School Â· city Â· age (auto-filled from student record)"
                value={notes} onChange={e => setNotes(e.target.value)}
                disabled={callState === "active" || callState === "dispatching"}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:bg-gray-50 disabled:text-gray-400 resize-none"
              />
            </div>

            {callError && (
              <p className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2 border border-red-200">âš ï¸ {callError}</p>
            )}

            {callState === "idle" || callState === "error" ? (
              <button onClick={handleDispatch} disabled={!phoneNumber.trim()}
                className="w-full bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm">
                ðŸ“ž Start Call
              </button>
            ) : callState === "dispatching" ? (
              <button disabled className="w-full bg-rose-300 text-white font-semibold py-2.5 rounded-xl text-sm cursor-not-allowed">
                â³ Dispatching agentâ€¦
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg border border-green-200">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-green-700 text-xs font-medium">Call active</span>
                </div>
                <button onClick={handleReset}
                  className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-xl transition-colors text-sm">
                  ðŸ”„ New Call
                </button>
              </div>
            )}
          </div>

          {/* Session details */}
          {dispatchResult && (
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-3 text-xs text-gray-500 space-y-1">
              <div className="font-semibold text-gray-700 mb-1">Session Details</div>
              <InfoRow label="Room"  value={dispatchResult.room_name} mono />
              {dispatchResult.job_id && <InfoRow label="Job" value={dispatchResult.job_id} mono />}
              <InfoRow label="Phone" value={dispatchResult.phone_number || "â€”"} />
            </div>
          )}

          {/* Survey cheat-sheet */}
          <div className="bg-purple-50 rounded-xl border border-purple-200 p-3 text-xs text-purple-700">
            <div className="font-semibold mb-2">ðŸ“‹ Survey Flow (auto-managed by agent)</div>
            <ol className="space-y-1 list-decimal list-inside">
              <li>Menstrual product used before session</li>
              <li>Received &amp; read the awareness book?</li>
              <li>Shared knowledge with family/friends?</li>
              <li>Using distributed sanitary kit?</li>
              <li>Comfortable with cloth pad?</li>
              <li>Will continue using hygienic products?</li>
              <li>If not â€” reason?</li>
              <li>Rate session 1â€“5</li>
            </ol>
          </div>
        </aside>

        {/* â”€â”€ Right: Live analytics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <section className="flex-1 bg-white rounded-2xl border border-gray-200 shadow-sm p-4 overflow-hidden flex flex-col">
          <h2 className="font-semibold text-gray-700 mb-4 flex items-center gap-2 flex-shrink-0">
            <span>ðŸ“Š</span> Real-time Analytics
            <span className="text-xs font-normal text-gray-400 ml-1">(millisecond precision)</span>
          </h2>
          {dispatchResult ? (
            <div className="flex-1 overflow-hidden">
              <NGOAnalytics wsUrl={dispatchResult.ws_url} token={dispatchResult.token} roomName={dispatchResult.room_name} />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-4">
              <span className="text-5xl">ðŸŒ¸</span>
              <p className="text-sm text-center max-w-xs">
                Search for a student, select them, then click
                <strong className="text-rose-600"> Start Call</strong> to see live transcripts,
                detected languages, LLM responses and per-turn latencies.
              </p>
              <div className="grid grid-cols-2 gap-3 text-xs text-gray-500 mt-2">
                <Metric color="blue"   label="STT latency"  sub="Time to transcript" />
                <Metric color="violet" label="LLM latency"  sub="Time to first token" />
                <Metric color="green"  label="TTS TTFA"     sub="Time to first audio" />
                <Metric color="rose"   label="E2E latency"  sub="Speech â†’ audio out" />
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-1.5">
      <span className="font-medium text-gray-600 w-16 flex-shrink-0">{label}:</span>
      <span className={mono ? "font-mono text-gray-500 truncate" : "text-gray-700"}>{value}</span>
    </div>
  );
}

function Metric({ color, label, sub }: { color: string; label: string; sub: string }) {
  const colours: Record<string, string> = {
    blue: "text-blue-600", violet: "text-violet-600", green: "text-green-600", rose: "text-rose-600",
  };
  return (
    <div className="bg-gray-50 rounded-lg p-2 border text-center">
      <div className={`font-bold ${colours[color] ?? "text-gray-600"}`}>{label}</div>
      <div>{sub}</div>
    </div>
  );
}
