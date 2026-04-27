"use client";

import { useState, useEffect, useCallback } from "react";
import type { CallResult } from "../lib/types";
import { Search, ChevronDown, ChevronUp } from "lucide-react";

const OUTCOME_BADGE: Record<string, { label: string; cls: string }> = {
  completed:     { label: "Completed",   cls: "badge-green" },
  partial:       { label: "Partial",     cls: "badge-amber" },
  unavailable:   { label: "Unavailable", cls: "badge-slate" },
  hung_up_early: { label: "Hung Up",     cls: "badge-red" },
};

const OUTCOMES = ["all", "completed", "partial", "hung_up_early", "unavailable"];

export default function CallResultsTable() {
  const [results, setResults] = useState<CallResult[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchResults = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "15" });
      if (outcomeFilter !== "all") params.set("outcome", outcomeFilter);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/ngo-call-results?${params}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.results ?? []);
        setTotal(data.total ?? 0);
        setTotalPages(data.totalPages ?? 0);
      }
    } catch (err) {
      console.error("Failed to fetch call results:", err);
    } finally {
      setLoading(false);
    }
  }, [page, outcomeFilter, search]);

  useEffect(() => { fetchResults(); }, [fetchResults]);
  useEffect(() => { setPage(1); }, [outcomeFilter, search]);

  return (
    <div className="space-y-4">
      {/* ── Header + filters ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Call Results</h2>
          <p className="text-sm text-gray-500">{total} total records</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search name or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-8 w-56"
            />
          </div>
          {/* Outcome filter */}
          <div className="flex gap-1">
            {OUTCOMES.map((o) => (
              <button
                key={o}
                onClick={() => setOutcomeFilter(o)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  outcomeFilter === o
                    ? "text-white shadow-sm"
                    : "bg-white border border-gray-200 text-gray-500 hover:border-emerald-300 hover:text-emerald-700"
                }`}
                style={outcomeFilter === o ? { background: "linear-gradient(135deg, #10b981, #059669)" } : {}}
              >
                {o === "all" ? "All" : OUTCOME_BADGE[o]?.label ?? o}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="white-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-400">
            <span className="w-4 h-4 border-2 border-emerald-200 border-t-emerald-500 rounded-full animate-spin mr-2" />
            Loading…
          </div>
        ) : results.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">No call results found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/80">
                  <th className="text-left py-3 px-4 text-gray-500 font-semibold text-xs">Student</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-semibold text-xs">Phone</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-semibold text-xs">School</th>
                  <th className="text-center py-3 px-4 text-gray-500 font-semibold text-xs">Outcome</th>
                  <th className="text-center py-3 px-4 text-gray-500 font-semibold text-xs">Sentiment</th>
                  <th className="text-center py-3 px-4 text-gray-500 font-semibold text-xs">Duration</th>
                  <th className="text-center py-3 px-4 text-gray-500 font-semibold text-xs">Language</th>
                  <th className="text-center py-3 px-4 text-gray-500 font-semibold text-xs">Date</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <ResultRow
                    key={r.id}
                    result={r}
                    expanded={expandedId === r.id}
                    onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="btn-ghost px-4 py-2 text-xs disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-xs text-gray-500 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="btn-ghost px-4 py-2 text-xs disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ── Result Row ────────────────────────────────────────────────────────────────

function ResultRow({ result: r, expanded, onToggle }: { result: CallResult; expanded: boolean; onToggle: () => void }) {
  const outcome = OUTCOME_BADGE[r.call_outcome ?? ""] ?? { label: r.call_outcome ?? "—", cls: "badge-slate" };
  const sentiment = r.sentiment_overall ?? 0;
  const sentimentColor = sentiment >= 70 ? "#15803d" : sentiment >= 40 ? "#b45309" : "#b91c1c";
  const sentimentBg = sentiment >= 70 ? "#dcfce7" : sentiment >= 40 ? "#fef3c7" : "#fee2e2";

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-gray-50 hover:bg-emerald-50/40 cursor-pointer transition-colors"
      >
        <td className="py-3 px-4">
          <div className="font-semibold text-gray-800">{r.student_name || "—"}</div>
          {r.student_age && <div className="text-xs text-gray-400">Age {r.student_age}</div>}
        </td>
        <td className="py-3 px-4 font-mono text-xs text-gray-500">{r.phone_number || "—"}</td>
        <td className="py-3 px-4 text-gray-600 text-xs max-w-[150px] truncate">{r.school_name || "—"}</td>
        <td className="py-3 px-4 text-center">
          <span className={`badge ${outcome.cls}`}>{outcome.label}</span>
        </td>
        <td className="py-3 px-4 text-center">
          {r.sentiment_overall != null ? (
            <span className="badge font-bold" style={{ background: sentimentBg, color: sentimentColor }}>
              {r.sentiment_overall}
            </span>
          ) : "—"}
        </td>
        <td className="py-3 px-4 text-center text-gray-500 text-xs">
          {r.call_duration_seconds ? `${r.call_duration_seconds}s` : "—"}
        </td>
        <td className="py-3 px-4 text-center text-xs">
          <span className="badge badge-slate">{r.detected_language || "—"}</span>
        </td>
        <td className="py-3 px-4 text-center text-gray-400 text-xs">
          {r.analyzed_at ? new Date(r.analyzed_at).toLocaleDateString() : "—"}
        </td>
        <td className="py-3 px-4 text-center text-gray-400">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </td>
      </tr>

      {/* ── Expanded details ── */}
      {expanded && (
        <tr>
          <td colSpan={9} className="bg-emerald-50/30 px-4 py-5">
            <div className="space-y-4">
              {r.summary && (
                <div>
                  <div className="text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Summary</div>
                  <p className="text-sm text-gray-700 leading-relaxed">{r.summary}</p>
                </div>
              )}

              <div>
                <div className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Sentiment Factors</div>
                <div className="grid grid-cols-5 gap-2">
                  {([
                    { label: "Engagement", val: r.sentiment_engagement },
                    { label: "Comfort",    val: r.sentiment_comfort },
                    { label: "Awareness",  val: r.sentiment_awareness_gain },
                    { label: "Adoption",   val: r.sentiment_product_adoption },
                    { label: "Positivity", val: r.sentiment_positivity },
                  ] as { label: string; val: number | null }[]).map((f) => (
                    <div key={f.label} className="bg-white border border-gray-100 rounded-xl p-2.5 text-center">
                      <div className="text-xs text-gray-400">{f.label}</div>
                      <div className="text-sm font-bold text-gray-800 mt-0.5">{f.val != null ? f.val : "—"}<span className="text-xs text-gray-400">/20</span></div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Survey Answers</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {([
                    { label: "Previous product", val: r.q1_previous_product },
                    { label: "Received book",    val: r.q2_received_book },
                    { label: "Shared knowledge", val: r.q3_shared_knowledge },
                    { label: "Using kit",        val: r.q4_using_kit },
                    { label: "Cloth comfort",    val: r.q5_cloth_pad_comfort },
                    { label: "Will continue",    val: r.q6_will_continue },
                    { label: "Barrier",          val: r.q7_barrier },
                    { label: "Rating",           val: r.q8_session_rating },
                  ] as { label: string; val: string | null }[]).map((q) => (
                    <div key={q.label} className="bg-white border border-gray-100 rounded-xl px-3 py-2">
                      <div className="text-xs text-gray-400">{q.label}</div>
                      <div className="text-sm text-gray-700 font-medium capitalize mt-0.5">{q.val != null ? String(q.val) : "—"}</div>
                    </div>
                  ))}
                </div>
              </div>

              {Array.isArray(r.key_insights) && r.key_insights.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Key Insights</div>
                  <ul className="text-xs text-gray-600 space-y-1">
                    {(r.key_insights as string[]).map((insight, i) => (
                      <li key={i} className="flex gap-2 items-start">
                        <span className="text-emerald-500 mt-0.5">•</span>
                        <span>{insight}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {r.recording_url && (
                <div>
                  <div className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Recording</div>
                  <audio controls src={r.recording_url} className="w-full max-w-md h-9" />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}