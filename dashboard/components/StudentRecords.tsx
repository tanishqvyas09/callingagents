"use client";

import { useState, useEffect, useCallback } from "react";
import { Search } from "lucide-react";

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
  has_been_called: boolean;
  call_outcome: string | null;
  last_call_at: string | null;
}

const OUTCOME_BADGE: Record<string, { label: string; cls: string }> = {
  completed:     { label: "Completed",   cls: "badge-green" },
  partial:       { label: "Partial",     cls: "badge-amber" },
  hung_up_early: { label: "Hung Up",     cls: "badge-red" },
  unavailable:   { label: "Unavailable", cls: "badge-slate" },
};

export default function StudentRecords() {
  const [students, setStudents] = useState<Student[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("post");
  const [callFilter, setCallFilter] = useState("all");
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

  useEffect(() => { fetchStudents(); }, [fetchStudents]);
  useEffect(() => { setPage(1); }, [typeFilter, callFilter, search]);

  return (
    <div className="space-y-4">
      {/* ── Header + filters ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Student Records</h2>
          <p className="text-sm text-gray-500">{total} students found</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search name, phone, school..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-8 w-64"
            />
          </div>

          {/* Campaign type */}
          <div className="flex gap-1">
            {["post", "pre"].map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  typeFilter === t
                    ? "text-white shadow-sm"
                    : "bg-white border border-gray-200 text-gray-500 hover:border-emerald-300 hover:text-emerald-700"
                }`}
                style={typeFilter === t ? { background: "linear-gradient(135deg, #10b981, #059669)" } : {}}
              >
                {t === "post" ? "Post Sheets" : "Pre Sheets"}
              </button>
            ))}
          </div>

          {/* Call status */}
          <div className="flex gap-1">
            {[{ key: "all", label: "All" }, { key: "called", label: "Called" }, { key: "not_called", label: "Not Called" }].map((f) => (
              <button
                key={f.key}
                onClick={() => setCallFilter(f.key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  callFilter === f.key
                    ? "bg-indigo-500 text-white shadow-sm"
                    : "bg-white border border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-700"
                }`}
              >
                {f.label}
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
        ) : students.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">No students found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/80">
                  <th className="text-left py-3 px-4 text-gray-500 font-semibold text-xs">#</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-semibold text-xs">Student Name</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-semibold text-xs">Phone</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-semibold text-xs">School</th>
                  <th className="text-center py-3 px-4 text-gray-500 font-semibold text-xs">Age</th>
                  <th className="text-center py-3 px-4 text-gray-500 font-semibold text-xs">Grade</th>
                  <th className="text-center py-3 px-4 text-gray-500 font-semibold text-xs">Score %</th>
                  <th className="text-center py-3 px-4 text-gray-500 font-semibold text-xs">Call Status</th>
                  <th className="text-center py-3 px-4 text-gray-500 font-semibold text-xs">Date</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s, i) => (
                  <tr key={s.id} className="border-b border-gray-50 hover:bg-emerald-50/40 transition-colors">
                    <td className="py-3 px-4 text-gray-400 text-xs">{(page - 1) * limit + i + 1}</td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-gray-800">{s.student_name_english || s.student_name}</div>
                      {s.student_name_english && s.student_name !== s.student_name_english && (
                        <div className="text-xs text-gray-400">{s.student_name}</div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {s.contact_number ? (
                        <span className="font-mono text-xs text-sky-600 bg-sky-50 px-2 py-0.5 rounded-lg">{s.contact_number}</span>
                      ) : (
                        <span className="text-xs text-gray-300">No phone</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-gray-600 text-xs max-w-[200px] truncate">
                      {s.school_name || "—"}
                      {s.school_city && (
                        <div className="text-gray-400">{s.school_city}{s.school_state ? `, ${s.school_state}` : ""}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center text-gray-500 text-xs">{s.age ?? "—"}</td>
                    <td className="py-3 px-4 text-center">
                      {s.grade ? (
                        <span className={`badge ${gradeClass(s.grade)}`}>{s.grade}</span>
                      ) : "—"}
                    </td>
                    <td className="py-3 px-4 text-center text-gray-600 text-xs">
                      {s.percentage != null ? `${s.percentage}%` : "—"}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {s.has_been_called ? (
                        <span className={`badge ${OUTCOME_BADGE[s.call_outcome ?? ""]?.cls ?? "badge-green"}`}>
                          {OUTCOME_BADGE[s.call_outcome ?? ""]?.label ?? "Called"}
                        </span>
                      ) : s.contact_number ? (
                        <span className="badge badge-slate">Pending</span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center text-gray-400 text-xs">{s.date || "—"}</td>
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

function gradeClass(grade: string): string {
  switch (grade) {
    case "A+": case "A": return "badge-green";
    case "B":            return "badge-blue";
    case "C":            return "badge-amber";
    case "D":            return "badge-amber";
    case "F":            return "badge-red";
    default:             return "badge-slate";
  }
}
