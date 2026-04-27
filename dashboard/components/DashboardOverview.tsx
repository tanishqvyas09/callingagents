"use client";

import type { DashboardStats } from "../lib/types";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, LineChart, Line,
} from "recharts";
import type { PieLabelRenderProps } from "recharts";
import { RefreshCw, TrendingUp } from "lucide-react";

interface Props {
  stats: DashboardStats | null;
  loading: boolean;
  onRefresh: () => void;
}

const COLORS = ["#10b981", "#f59e0b", "#ef4444", "#6b7280", "#8b5cf6", "#06b6d4"];

const TOOLTIP_STYLE = {
  contentStyle: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: "12px", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" },
  labelStyle: { color: "#374151", fontWeight: 600, fontSize: 12 },
  itemStyle: { color: "#374151", fontSize: 12 },
};

export default function DashboardOverview({ stats, loading, onRefresh }: Props) {
  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <span className="w-5 h-5 border-2 border-emerald-200 border-t-emerald-500 rounded-full animate-spin mr-2" />
        Loading dashboard...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Campaign Overview</h2>
          <p className="text-sm text-gray-500 mt-0.5">Menstrual Hygiene Survey · Real-time data</p>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm text-gray-600 hover:border-emerald-300 hover:text-emerald-700 transition-all shadow-sm"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Total Students" value={stats.totalStudents} sub="post sheets"   accent="#6366f1" />
        <StatCard label="With Phone"     value={stats.studentsWithPhone} sub="callable"  accent="#0ea5e9" />
        <StatCard label="Calls Made"     value={stats.totalCalls} sub="total"            accent="#8b5cf6" />
        <StatCard label="Completed"      value={stats.completedCalls} sub="full survey"  accent="#10b981" />
        <StatCard label="Remaining"      value={stats.studentsRemaining} sub="to call"   accent="#f59e0b" />
        <StatCard label="Progress"       value={`${stats.progressPercent}%`} sub={`${stats.studentsProcessed} done`} accent="#ec4899" />
      </div>

      {/* ── Progress bar ── */}
      <div className="white-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-emerald-600" />
            <h3 className="text-sm font-semibold text-gray-800">Campaign Progress</h3>
          </div>
          <span className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1">
            {stats.studentsProcessed} of {stats.studentsWithPhone} students called
          </span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${stats.progressPercent}%`, background: "linear-gradient(90deg, #10b981, #059669)" }}
          />
        </div>
        <div className="text-right text-xs text-emerald-600 font-semibold mt-1.5">{stats.progressPercent}%</div>
      </div>

      {/* ── Averages row ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AvgCard
          label="Avg. Sentiment"
          value={stats.avgSentiment}
          max={100}
          unit="/100"
          color={stats.avgSentiment >= 70 ? "#10b981" : stats.avgSentiment >= 40 ? "#f59e0b" : "#ef4444"}
        />
        <AvgCard label="Avg. Duration" value={stats.avgDuration} unit="sec"   color="#0ea5e9" />
        <AvgCard label="Avg. Turns"    value={stats.avgTurns}    unit="turns" color="#8b5cf6" />
      </div>

      {/* ── Charts row 1 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Call Outcomes">
          {stats.outcomeDistribution.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={stats.outcomeDistribution}
                  cx="50%" cy="50%"
                  innerRadius={60} outerRadius={100}
                  paddingAngle={3}
                  dataKey="value"
                  label={(props: PieLabelRenderProps) => `${props.name ?? ""} ${(((props.percent as number) ?? 0) * 100).toFixed(0)}%`}
                >
                  {stats.outcomeDistribution.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>

        <ChartCard title="Sentiment Factors (avg /20)">
          {stats.sentimentFactors.some((f) => f.avg > 0) ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stats.sentimentFactors} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis type="number" domain={[0, 20]} tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <YAxis type="category" dataKey="factor" tick={{ fill: "#9ca3af", fontSize: 11 }} width={120} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Bar dataKey="avg" fill="#10b981" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>
      </div>

      {/* ── Charts row 2 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Daily Calls">
          {stats.dailyProgress.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={stats.dailyProgress}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 10 }} />
                <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Line type="monotone" dataKey="calls"     stroke="#8b5cf6" strokeWidth={2} dot={{ fill: "#8b5cf6" }} name="Total Calls" />
                <Line type="monotone" dataKey="completed" stroke="#10b981" strokeWidth={2} dot={{ fill: "#10b981" }} name="Completed" />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>

        <ChartCard title="Languages Detected">
          {stats.languageDistribution.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stats.languageDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="language" tick={{ fill: "#9ca3af", fontSize: 10 }} />
                <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {stats.languageDistribution.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>
      </div>

      {/* ── Question Answer Stats ── */}
      <div className="white-card p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-4">Survey Question Breakdown</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stats.questionStats.map((q) => (
            <div key={q.key} className="bg-gray-50 border border-gray-100 rounded-xl p-4">
              <h4 className="text-xs font-semibold text-gray-600 mb-2">{q.question}</h4>
              {q.answers.length > 0 ? (
                <div className="space-y-1.5">
                  {q.answers.slice(0, 5).map((a) => (
                    <div key={a.answer} className="flex items-center justify-between text-xs">
                      <span className="text-gray-500 capitalize">{a.answer}</span>
                      <span className="font-mono text-gray-800 bg-white border border-gray-200 px-2 py-0.5 rounded-lg">{a.count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">No data yet</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── School Breakdown ── */}
      {stats.schoolBreakdown.length > 0 && (
        <div className="white-card p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">School Breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2.5 px-3 text-gray-400 font-semibold">School</th>
                  <th className="text-right py-2.5 px-3 text-gray-400 font-semibold">Total</th>
                  <th className="text-right py-2.5 px-3 text-gray-400 font-semibold">Called</th>
                  <th className="text-right py-2.5 px-3 text-gray-400 font-semibold">Avg Sentiment</th>
                </tr>
              </thead>
              <tbody>
                {stats.schoolBreakdown.map((s) => (
                  <tr key={s.school} className="border-b border-gray-50 hover:bg-emerald-50/50 transition-colors">
                    <td className="py-2.5 px-3 text-gray-800 font-medium max-w-[250px] truncate">{s.school}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600">{s.total}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600">{s.called}</td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={`badge ${s.avgSentiment >= 70 ? "badge-green" : s.avgSentiment >= 40 ? "badge-amber" : "badge-red"}`}>
                        {s.avgSentiment}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Barrier Analysis ── */}
      {stats.barrierAnalysis.length > 0 && (
        <div className="white-card p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">Barriers to Continuation (Q7)</h3>
          <div className="flex flex-wrap gap-2">
            {stats.barrierAnalysis.map((b) => (
              <div key={b.barrier} className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-xl">
                <span className="text-xs text-red-600 capitalize">{b.barrier}</span>
                <span className="text-xs font-bold text-red-700 bg-red-100 rounded-lg px-1.5 py-0.5">{b.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub: string; accent: string }) {
  return (
    <div className="stat-card">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: accent }} />
        <div className="text-xs text-gray-500 font-medium">{label}</div>
      </div>
      <div className="text-2xl font-bold text-gray-900" style={{ color: accent }}>{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{sub}</div>
    </div>
  );
}

function AvgCard({ label, value, unit, max, color }: { label: string; value: number; unit: string; max?: number; color: string }) {
  const barPct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="white-card p-4">
      <div className="text-xs text-gray-500 font-medium mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-900">
        {value} <span className="text-sm text-gray-400 font-normal">{unit}</span>
      </div>
      {max && (
        <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
          <div className="h-full rounded-full transition-all" style={{ width: `${barPct}%`, background: color }} />
        </div>
      )}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="white-card p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex items-center justify-center h-60 text-gray-300 text-sm">
      No data yet — start calling to see charts
    </div>
  );
}
