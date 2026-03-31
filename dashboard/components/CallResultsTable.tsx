"use client";

import { useState, useEffect, useCallback } from "react";
import type { CallResult } from "../lib/types";

const OUTCOME_STYLES: Record<string, { label: string; cls: string }> = {
  completed:     { label: "Completed",    cls: "bg-emerald-900 text-emerald-300 border-emerald-700" },
  partial:       { label: "Partial",      cls: "bg-amber-900 text-amber-300 border-amber-700" },
  unavailable:   { label: "Unavailable",  cls: "bg-slate-700 text-slate-300 border-slate-600" },
  hung_up_early: { label: "Hung Up",      cls: "bg-red-900 text-red-300 border-red-700" },
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
      const params = new URLSearchParams({
        page: String(page),
        limit: "15",
      });
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

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [outcomeFilter, search]);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="space-y-4">
      {/* ── Header + filters ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Call Results</h2>
          <p className="text-sm text-slate-400">{total} total records</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <input
            type="text"
            placeholder="Search name or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500 w-60"
          />
          {/* Outcome filter */}
          <div className="flex gap-1">
            {OUTCOMES.map((o) => (
              <button
                key={o}
                onClick={() => setOutcomeFilter(o)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  outcomeFilter === o
                    ? "bg-rose-600 text-white"
                    : "bg-slate-800 border border-slate-700 text-slate-400 hover:text-white"
                }`}
              >
                {o === "all" ? "All" : OUTCOME_STYLES[o]?.label ?? o}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-slate-500">
            <span className="w-4 h-4 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin mr-2" />
            Loading...
          </div>
        ) : results.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
            No call results found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-800/50">
                  <th className="text-left py-3 px-4 text-slate-400 font-medium text-xs">Student</th>
                  <th className="text-left py-3 px-4 text-slate-400 font-medium text-xs">Phone</th>
                  <th className="text-left py-3 px-4 text-slate-400 font-medium text-xs">School</th>
                  <th className="text-center py-3 px-4 text-slate-400 font-medium text-xs">Outcome</th>
                  <th className="text-center py-3 px-4 text-slate-400 font-medium text-xs">Sentiment</th>
                  <th className="text-center py-3 px-4 text-slate-400 font-medium text-xs">Duration</th>
                  <th className="text-center py-3 px-4 text-slate-400 font-medium text-xs">Language</th>
                  <th className="text-center py-3 px-4 text-slate-400 font-medium text-xs">Date</th>
                  <th className="text-center py-3 px-4 text-slate-400 font-medium text-xs"></th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <ResultRow
                    key={r.id}
                    result={r}
                    expanded={expandedId === r.id}
                    onToggle={() => toggleExpand(r.id)}
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
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-50"
          >
            ← Prev
          </button>
          <span className="text-xs text-slate-400">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-50"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ── Result Row ────────────────────────────────────────────────────────────────

function ResultRow({
  result: r,
  expanded,
  onToggle,
}: {
  result: CallResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  const outcome = OUTCOME_STYLES[r.call_outcome ?? ""] ?? { label: r.call_outcome ?? "—", cls: "bg-slate-700 text-slate-300" };
  const sentimentColor =
    (r.sentiment_overall ?? 0) >= 70
      ? "text-emerald-400"
      : (r.sentiment_overall ?? 0) >= 40
      ? "text-amber-400"
      : "text-red-400";

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-slate-800 hover:bg-slate-800/50 cursor-pointer transition-colors"
      >
        <td className="py-3 px-4">
          <div className="text-white font-medium">{r.student_name || "—"}</div>
          {r.student_age && <div className="text-xs text-slate-500">Age {r.student_age}</div>}
        </td>
        <td className="py-3 px-4 text-slate-300 font-mono text-xs">{r.phone_number || "—"}</td>
        <td className="py-3 px-4 text-slate-300 text-xs max-w-[150px] truncate">{r.school_name || "—"}</td>
        <td className="py-3 px-4 text-center">
          <span className={`px-2 py-1 rounded-full text-xs font-medium border ${outcome.cls}`}>
            {outcome.label}
          </span>
        </td>
        <td className={`py-3 px-4 text-center font-bold ${sentimentColor}`}>
          {r.sentiment_overall != null ? String(r.sentiment_overall) : "—"}
        </td>
        <td className="py-3 px-4 text-center text-slate-300 text-xs">
          {r.call_duration_seconds ? `${r.call_duration_seconds}s` : "—"}
        </td>
        <td className="py-3 px-4 text-center text-xs">
          <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-300">{r.detected_language || "—"}</span>
        </td>
        <td className="py-3 px-4 text-center text-slate-400 text-xs">
          {r.analyzed_at ? new Date(r.analyzed_at).toLocaleDateString() : "—"}
        </td>
        <td className="py-3 px-4 text-center text-slate-500 text-xs">{expanded ? "▲" : "▼"}</td>
      </tr>

      {/* ── Expanded details ── */}
      {expanded && (
        <tr>
          <td colSpan={9} className="bg-slate-800/30 px-4 py-4">
            <div className="space-y-4">
              {/* Summary */}
              {r.summary && (
                <div>
                  <div className="text-xs font-semibold text-slate-400 mb-1">Summary</div>
                  <p className="text-sm text-slate-200">{r.summary}</p>
                </div>
              )}

              {/* Sentiment factors */}
              <div>
                <div className="text-xs font-semibold text-slate-400 mb-2">Sentiment Factors</div>
                <div className="grid grid-cols-5 gap-2">
                  {([
                    { label: "Engagement", val: r.sentiment_engagement },
                    { label: "Comfort", val: r.sentiment_comfort },
                    { label: "Awareness", val: r.sentiment_awareness_gain },
                    { label: "Adoption", val: r.sentiment_product_adoption },
                    { label: "Positivity", val: r.sentiment_positivity },
                  ] as { label: string; val: number | null }[]).map((f) => (
                    <div key={f.label} className="bg-slate-800 rounded-lg p-2 text-center">
                      <div className="text-xs text-slate-500">{f.label}</div>
                      <div className="text-sm font-bold text-white">{f.val != null ? String(f.val) : "—"}<span className="text-xs text-slate-500">/20</span></div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Survey answers */}
              <div>
                <div className="text-xs font-semibold text-slate-400 mb-2">Survey Answers</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {([
                    { label: "Previous product", val: r.q1_previous_product },
                    { label: "Received book", val: r.q2_received_book },
                    { label: "Shared knowledge", val: r.q3_shared_knowledge },
                    { label: "Using kit", val: r.q4_using_kit },
                    { label: "Cloth comfort", val: r.q5_cloth_pad_comfort },
                    { label: "Will continue", val: r.q6_will_continue },
                    { label: "Barrier", val: r.q7_barrier },
                    { label: "Rating", val: r.q8_session_rating },
                  ] as { label: string; val: string | null }[]).map((q) => (
                    <div key={q.label} className="bg-slate-800 rounded-lg px-3 py-2">
                      <div className="text-xs text-slate-500">{q.label}</div>
                      <div className="text-sm text-white capitalize">{q.val != null ? String(q.val) : "—"}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Key insights */}
              {Array.isArray(r.key_insights) && r.key_insights.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-400 mb-1">Key Insights</div>
                  <ul className="text-xs text-slate-300 space-y-1">
                    {(r.key_insights as string[]).map((insight, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-violet-400">•</span>
                        <span>{insight}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recording */}
              {r.recording_url && (
                <div>
                  <div className="text-xs font-semibold text-slate-400 mb-1">Recording</div>
                  <audio controls src={r.recording_url} className="w-full max-w-md h-8" />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
