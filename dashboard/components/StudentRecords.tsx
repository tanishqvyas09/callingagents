"use client";

import { useState, useEffect, useCallback } from "react";

interface Student {
  id: string;
  student_name: string;
  student_name_english: string | null;
  contact_number: string | null;
  age: number | null;
  school_name: string | null;
  school_city: string | null;
  school_state: string | null;
  campaign_type: string | null;
  percentage: number | null;
  grade: string | null;
  date: string | null;
  // Call tracking
  has_been_called: boolean;
  call_outcome: string | null;
  last_call_at: string | null;
}

const OUTCOME_STYLES: Record<string, { label: string; cls: string }> = {
  completed:     { label: "✓ Completed",   cls: "bg-emerald-900 text-emerald-300" },
  partial:       { label: "◐ Partial",     cls: "bg-amber-900 text-amber-300" },
  hung_up_early: { label: "✗ Hung Up",     cls: "bg-red-900 text-red-300" },
  unavailable:   { label: "— Unavailable", cls: "bg-slate-700 text-slate-300" },
};

export default function StudentRecords() {
  const [students, setStudents] = useState<Student[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("post"); // post or pre
  const [callFilter, setCallFilter] = useState("all"); // all, called, not_called
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const limit = 25;

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        campaign_type: typeFilter,
        call_filter: callFilter,
      });
      if (search.trim()) params.set("search", search.trim());

      const res = await fetch(`/api/ngo-student-records?${params}`);
      if (res.ok) {
        const data = await res.json();
        setStudents(data.students ?? []);
        setTotal(data.total ?? 0);
        setTotalPages(data.totalPages ?? 0);
      }
    } catch (err) {
      console.error("Failed to fetch students:", err);
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, callFilter, search]);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  useEffect(() => {
    setPage(1);
  }, [typeFilter, callFilter, search]);

  return (
    <div className="space-y-4">
      {/* ── Header + filters ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Student Records</h2>
          <p className="text-sm text-slate-400">{total} students found</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <input
            type="text"
            placeholder="Search name, phone, school..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500 w-64"
          />

          {/* Campaign type filter */}
          <div className="flex gap-1">
            {["post", "pre"].map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  typeFilter === t
                    ? "bg-violet-600 text-white"
                    : "bg-slate-800 border border-slate-700 text-slate-400 hover:text-white"
                }`}
              >
                {t === "post" ? "📝 Post Sheets" : "📋 Pre Sheets"}
              </button>
            ))}
          </div>

          {/* Call status filter */}
          <div className="flex gap-1">
            {[
              { key: "all", label: "All" },
              { key: "called", label: "Called" },
              { key: "not_called", label: "Not Called" },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setCallFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  callFilter === f.key
                    ? "bg-rose-600 text-white"
                    : "bg-slate-800 border border-slate-700 text-slate-400 hover:text-white"
                }`}
              >
                {f.label}
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
        ) : students.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
            No students found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-800/50">
                  <th className="text-left py-3 px-4 text-slate-400 font-medium text-xs">#</th>
                  <th className="text-left py-3 px-4 text-slate-400 font-medium text-xs">Student Name</th>
                  <th className="text-left py-3 px-4 text-slate-400 font-medium text-xs">Phone</th>
                  <th className="text-left py-3 px-4 text-slate-400 font-medium text-xs">School</th>
                  <th className="text-center py-3 px-4 text-slate-400 font-medium text-xs">Age</th>
                  <th className="text-center py-3 px-4 text-slate-400 font-medium text-xs">Grade</th>
                  <th className="text-center py-3 px-4 text-slate-400 font-medium text-xs">Score %</th>
                  <th className="text-center py-3 px-4 text-slate-400 font-medium text-xs">Call Status</th>
                  <th className="text-center py-3 px-4 text-slate-400 font-medium text-xs">Date</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s, i) => (
                  <tr key={s.id} className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-4 text-slate-500 text-xs">{(page - 1) * limit + i + 1}</td>
                    <td className="py-3 px-4">
                      <div className="text-white font-medium">{s.student_name_english || s.student_name}</div>
                      {s.student_name_english && s.student_name !== s.student_name_english && (
                        <div className="text-xs text-slate-500">{s.student_name}</div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {s.contact_number ? (
                        <span className="font-mono text-xs text-sky-400">{s.contact_number}</span>
                      ) : (
                        <span className="text-xs text-slate-600">No phone</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-300 text-xs max-w-[200px] truncate">
                      {s.school_name || "—"}
                      {s.school_city && (
                        <div className="text-slate-500">{s.school_city}{s.school_state ? `, ${s.school_state}` : ""}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center text-slate-300 text-xs">{s.age ?? "—"}</td>
                    <td className="py-3 px-4 text-center">
                      {s.grade ? (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${gradeColor(s.grade)}`}>
                          {s.grade}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="py-3 px-4 text-center text-slate-300 text-xs">
                      {s.percentage != null ? `${s.percentage}%` : "—"}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {s.has_been_called ? (
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          OUTCOME_STYLES[s.call_outcome ?? ""]?.cls ?? "bg-emerald-900 text-emerald-300"
                        }`}>
                          {OUTCOME_STYLES[s.call_outcome ?? ""]?.label ?? "Called"}
                        </span>
                      ) : s.contact_number ? (
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
                          Pending
                        </span>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center text-slate-400 text-xs">{s.date || "—"}</td>
                  </tr>
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
          <span className="text-xs text-slate-400">Page {page} of {totalPages}</span>
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

function gradeColor(grade: string): string {
  switch (grade) {
    case "A+": return "bg-emerald-900 text-emerald-300";
    case "A":  return "bg-emerald-900 text-emerald-300";
    case "B":  return "bg-sky-900 text-sky-300";
    case "C":  return "bg-amber-900 text-amber-300";
    case "D":  return "bg-orange-900 text-orange-300";
    case "F":  return "bg-red-900 text-red-300";
    default:   return "bg-slate-700 text-slate-300";
  }
}
