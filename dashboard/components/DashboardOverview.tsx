"use client";

import type { DashboardStats } from "../lib/types";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, LineChart, Line,
} from "recharts";
import type { PieLabelRenderProps } from "recharts";

interface Props {
  stats: DashboardStats | null;
  loading: boolean;
  onRefresh: () => void;
}

const COLORS = ["#10b981", "#f59e0b", "#ef4444", "#6b7280", "#8b5cf6", "#06b6d4"];

export default function DashboardOverview({ stats, loading, onRefresh }: Props) {
  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <span className="w-5 h-5 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin mr-2" />
        Loading dashboard...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Campaign Overview</h2>
        <button
          onClick={onRefresh}
          className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <StatCard label="Total Students" value={stats.totalStudents} sub="post sheets" color="slate" />
        <StatCard label="With Phone" value={stats.studentsWithPhone} sub="callable" color="sky" />
        <StatCard label="Calls Made" value={stats.totalCalls} sub="total" color="violet" />
        <StatCard label="Completed" value={stats.completedCalls} sub="full survey" color="emerald" />
        <StatCard label="Remaining" value={stats.studentsRemaining} sub="to call" color="amber" />
        <StatCard label="Progress" value={`${stats.progressPercent}%`} sub={`${stats.studentsProcessed} done`} color="rose" />
      </div>

      {/* ── Progress bar ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-200">Campaign Progress</h3>
          <span className="text-xs text-slate-400">
            {stats.studentsProcessed} of {stats.studentsWithPhone} students called
          </span>
        </div>
        <div className="w-full bg-slate-800 rounded-full h-4 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-rose-500 to-violet-500 rounded-full transition-all duration-700"
            style={{ width: `${stats.progressPercent}%` }}
          />
        </div>
      </div>

      {/* ── Averages row ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AvgCard
          label="Avg. Sentiment"
          value={stats.avgSentiment}
          max={100}
          unit="/100"
          color={stats.avgSentiment >= 70 ? "emerald" : stats.avgSentiment >= 40 ? "amber" : "red"}
        />
        <AvgCard label="Avg. Duration" value={stats.avgDuration} unit="sec" color="sky" />
        <AvgCard label="Avg. Turns" value={stats.avgTurns} unit="turns" color="violet" />
      </div>

      {/* ── Charts row 1 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Outcome Pie */}
        <ChartCard title="Call Outcomes">
          {stats.outcomeDistribution.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={stats.outcomeDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={3}
                  dataKey="value"
                  label={(props: PieLabelRenderProps) => `${props.name ?? ""} ${(((props.percent as number) ?? 0) * 100).toFixed(0)}%`}
                >
                  {stats.outcomeDistribution.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }}
                  labelStyle={{ color: "#94a3b8" }}
                  itemStyle={{ color: "#e2e8f0" }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </ChartCard>

        {/* Sentiment Factors Bar */}
        <ChartCard title="Sentiment Factors (avg of /20)">
          {stats.sentimentFactors.some((f) => f.avg > 0) ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stats.sentimentFactors} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis type="number" domain={[0, 20]} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="factor"
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  width={120}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }}
                  itemStyle={{ color: "#e2e8f0" }}
                />
                <Bar dataKey="avg" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </ChartCard>
      </div>

      {/* ── Charts row 2 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Progress Line */}
        <ChartCard title="Daily Calls">
          {stats.dailyProgress.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={stats.dailyProgress}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }}
                  itemStyle={{ color: "#e2e8f0" }}
                />
                <Line type="monotone" dataKey="calls" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: "#8b5cf6" }} name="Total Calls" />
                <Line type="monotone" dataKey="completed" stroke="#10b981" strokeWidth={2} dot={{ fill: "#10b981" }} name="Completed" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </ChartCard>

        {/* Language Distribution */}
        <ChartCard title="Languages Detected">
          {stats.languageDistribution.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stats.languageDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="language" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }}
                  itemStyle={{ color: "#e2e8f0" }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {stats.languageDistribution.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </ChartCard>
      </div>

      {/* ── Question Answer Stats ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-4">Survey Question Breakdown</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stats.questionStats.map((q) => (
            <div key={q.key} className="bg-slate-800 rounded-xl p-4">
              <h4 className="text-xs font-semibold text-slate-300 mb-2">{q.question}</h4>
              {q.answers.length > 0 ? (
                <div className="space-y-1.5">
                  {q.answers.slice(0, 5).map((a) => (
                    <div key={a.answer} className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 capitalize">{a.answer}</span>
                      <span className="font-mono text-slate-200 bg-slate-700 px-2 py-0.5 rounded">{a.count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500">No data yet</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── School Breakdown ── */}
      {stats.schoolBreakdown.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-4">School Breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-2 px-3 text-slate-400 font-medium">School</th>
                  <th className="text-right py-2 px-3 text-slate-400 font-medium">Total Students</th>
                  <th className="text-right py-2 px-3 text-slate-400 font-medium">Called</th>
                  <th className="text-right py-2 px-3 text-slate-400 font-medium">Avg Sentiment</th>
                </tr>
              </thead>
              <tbody>
                {stats.schoolBreakdown.map((s) => (
                  <tr key={s.school} className="border-b border-slate-800 hover:bg-slate-800/50">
                    <td className="py-2 px-3 text-slate-200 font-medium max-w-[250px] truncate">{s.school}</td>
                    <td className="py-2 px-3 text-right text-slate-300">{s.total}</td>
                    <td className="py-2 px-3 text-right text-slate-300">{s.called}</td>
                    <td className="py-2 px-3 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        s.avgSentiment >= 70
                          ? "bg-emerald-900 text-emerald-300"
                          : s.avgSentiment >= 40
                          ? "bg-amber-900 text-amber-300"
                          : "bg-red-900 text-red-300"
                      }`}>
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
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-4">
            Barriers to Continuation (Q7)
          </h3>
          <div className="flex flex-wrap gap-2">
            {stats.barrierAnalysis.map((b) => (
              <div key={b.barrier} className="flex items-center gap-2 px-3 py-1.5 bg-red-950 border border-red-800 rounded-xl">
                <span className="text-xs text-red-300 capitalize">{b.barrier}</span>
                <span className="text-xs font-bold text-red-200">{b.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, color,
}: {
  label: string;
  value: string | number;
  sub: string;
  color: string;
}) {
  const BG: Record<string, string> = {
    slate:   "bg-slate-900 border-slate-800",
    sky:     "bg-sky-950 border-sky-800",
    violet:  "bg-violet-950 border-violet-800",
    emerald: "bg-emerald-950 border-emerald-800",
    amber:   "bg-amber-950 border-amber-800",
    rose:    "bg-rose-950 border-rose-800",
  };
  const TEXT: Record<string, string> = {
    slate:   "text-slate-200",
    sky:     "text-sky-300",
    violet:  "text-violet-300",
    emerald: "text-emerald-300",
    amber:   "text-amber-300",
    rose:    "text-rose-300",
  };
  return (
    <div className={`rounded-2xl border p-4 ${BG[color] || BG.slate}`}>
      <div className="text-xs text-slate-400 font-medium mb-1">{label}</div>
      <div className={`text-2xl font-bold ${TEXT[color] || TEXT.slate}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}

function AvgCard({
  label, value, unit, max, color,
}: {
  label: string;
  value: number;
  unit: string;
  max?: number;
  color: string;
}) {
  const barPct = max ? Math.min(100, (value / max) * 100) : 0;
  const BAR_COL: Record<string, string> = {
    emerald: "bg-emerald-500",
    amber:   "bg-amber-500",
    red:     "bg-red-500",
    sky:     "bg-sky-500",
    violet:  "bg-violet-500",
  };
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <div className="text-xs text-slate-400 font-medium mb-1">{label}</div>
      <div className="text-2xl font-bold text-white">
        {value} <span className="text-sm text-slate-500 font-normal">{unit}</span>
      </div>
      {max && (
        <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2">
          <div
            className={`h-full rounded-full transition-all ${BAR_COL[color] || BAR_COL.sky}`}
            style={{ width: `${barPct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-slate-200 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex items-center justify-center h-60 text-slate-600 text-sm">
      No data yet — start calling to see charts
    </div>
  );
}
