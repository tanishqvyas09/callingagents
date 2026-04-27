"use client";

import { useState, useCallback, useEffect } from "react";
import type { CampaignState, DashboardStats } from "../lib/types";
import { Play, Square, Users, Phone, CheckCircle2, Clock, PhoneCall, Info } from "lucide-react";

interface Props {
  campaignState: CampaignState | null;
  stats: DashboardStats | null;
  onRefresh: () => void;
}

export default function CampaignManager({ campaignState, stats, onRefresh }: Props) {
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [localState, setLocalState] = useState<CampaignState | null>(campaignState);

  useEffect(() => { setLocalState(campaignState); }, [campaignState]);

  useEffect(() => {
    if (!localState?.running) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/ngo-campaign");
        if (res.ok) { const data = await res.json(); setLocalState(data); }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [localState?.running]);

  const handleAction = useCallback(async (action: "start" | "stop") => {
    setActionLoading(true);
    setActionMsg(null);
    try {
      const res = await fetch("/api/ngo-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      setLocalState(data);
      setActionMsg(data.message || null);
      onRefresh();
    } catch {
      setActionMsg("Failed to perform action");
    } finally {
      setActionLoading(false);
    }
  }, [onRefresh]);

  const running = localState?.running ?? false;
  const stopRequested = localState?.stopRequested ?? false;

  return (
    <div className="space-y-6">
      {/* ── Control Panel ── */}
      <div className="white-card p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Auto-Dialer Control</h2>
            <p className="text-sm text-gray-500 mt-1">Start the campaign to automatically call students one by one</p>
          </div>

          {/* Status badge */}
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${
            running
              ? stopRequested
                ? "bg-amber-50 border border-amber-200 text-amber-700"
                : "bg-emerald-50 border border-emerald-200 text-emerald-700"
              : "bg-gray-50 border border-gray-200 text-gray-600"
          }`}>
            {running && !stopRequested && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            )}
            {running
              ? stopRequested ? "⏳ Stopping after current call…" : "Running"
              : "Stopped"}
          </div>
        </div>

        {/* Start / Stop buttons */}
        <div className="flex gap-4">
          {!running ? (
            <button
              onClick={() => handleAction("start")}
              disabled={actionLoading}
              className="btn-primary flex-1 py-4 text-lg flex items-center justify-center gap-2"
            >
              <Play size={20} />
              {actionLoading ? "Starting…" : "Start Campaign"}
            </button>
          ) : (
            <button
              onClick={() => handleAction("stop")}
              disabled={actionLoading || stopRequested}
              className="btn-danger flex-1 py-4 text-lg flex items-center justify-center gap-2"
            >
              <Square size={20} />
              {stopRequested ? "Finishing last call…" : actionLoading ? "Stopping…" : "Stop Campaign"}
            </button>
          )}
        </div>

        {actionMsg && (
          <div className="mt-4 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 flex items-center gap-2">
            <Info size={14} />
            {actionMsg}
          </div>
        )}
      </div>

      {/* ── Campaign Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MiniCard label="Queue Size"  value={localState?.totalInQueue ?? 0}   icon={<Users size={18} className="text-indigo-500" />}   accent="#6366f1" />
        <MiniCard label="Processed"   value={localState?.processedCount ?? 0} icon={<CheckCircle2 size={18} className="text-emerald-500" />} accent="#10b981" />
        <MiniCard
          label="Started At"
          value={localState?.startedAt ? new Date(localState.startedAt).toLocaleTimeString() : "—"}
          icon={<Clock size={18} className="text-sky-500" />}
          accent="#0ea5e9"
        />
        <MiniCard
          label="Stopped At"
          value={localState?.stoppedAt ? new Date(localState.stoppedAt).toLocaleTimeString() : "—"}
          icon={<Clock size={18} className="text-gray-400" />}
          accent="#9ca3af"
        />
      </div>

      {/* ── Current Call ── */}
      {running && (
        <div className="white-card p-5 border-emerald-200" style={{ borderColor: "#6ee7b7" }}>
          <h3 className="text-sm font-semibold text-emerald-700 mb-4 flex items-center gap-2">
            <PhoneCall size={16} />
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Currently Calling
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <InfoRow label="Student" value={localState?.currentStudentName || "—"} />
            <InfoRow label="Phone"   value={localState?.currentPhoneNumber || "—"} />
            <InfoRow label="Room"    value={localState?.currentRoomName || "—"} />
          </div>

          {(localState?.totalInQueue ?? 0) > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>Progress this session</span>
                <span className="font-semibold text-gray-700">{localState?.processedCount ?? 0} / {localState?.totalInQueue ?? 0}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${(localState?.totalInQueue ?? 0) > 0 ? Math.round(((localState?.processedCount ?? 0) / (localState?.totalInQueue ?? 1)) * 100) : 0}%`,
                    background: "linear-gradient(90deg, #10b981, #059669)",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Overall Campaign Progress ── */}
      <div className="white-card p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-4">Overall Campaign Progress</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <MiniCard label="Total Students" value={stats?.totalStudents ?? 0}      icon={<Users size={18} className="text-indigo-500" />}   accent="#6366f1" />
          <MiniCard label="With Phone"     value={stats?.studentsWithPhone ?? 0}  icon={<Phone size={18} className="text-sky-500" />}       accent="#0ea5e9" />
          <MiniCard label="Called"         value={stats?.studentsProcessed ?? 0}  icon={<CheckCircle2 size={18} className="text-emerald-500" />} accent="#10b981" />
          <MiniCard label="Remaining"      value={stats?.studentsRemaining ?? 0}  icon={<Clock size={18} className="text-amber-500" />}     accent="#f59e0b" />
        </div>

        <div className="w-full bg-gray-100 rounded-full h-3.5 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${stats?.progressPercent ?? 0}%`, background: "linear-gradient(90deg, #10b981, #059669)" }}
          />
        </div>
        <div className="text-right text-xs text-emerald-600 font-semibold mt-1.5">{stats?.progressPercent ?? 0}% complete</div>
      </div>

      {/* ── Quick Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <OutcomeCard label="Completed"     count={stats?.completedCalls ?? 0}  color="emerald" />
        <OutcomeCard label="Partial"       count={stats?.partialCalls ?? 0}    color="amber" />
        <OutcomeCard label="Hung Up"       count={stats?.hungUpEarlyCalls ?? 0} color="red" />
        <OutcomeCard label="Unavailable"   count={stats?.failedCalls ?? 0}     color="slate" />
        <OutcomeCard label="Avg Sentiment" count={stats?.avgSentiment ?? 0}    color="violet" suffix="/100" />
      </div>

      {/* ── How it works ── */}
      <div className="white-card p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <Info size={15} className="text-emerald-600" />
          How the Auto-Dialer Works
        </h3>
        <ol className="space-y-2.5 text-xs text-gray-500">
          {[
            <>Click <strong className="text-gray-800">Start Campaign</strong> — the system fetches all post-sheet students with valid phone numbers.</>,
            <>Students already present in <code className="text-emerald-600 bg-emerald-50 px-1 rounded">ngo_call_results</code> are skipped automatically.</>,
            <>Each student is called one-by-one. The agent does the survey, AI analyzes results, and pushes to DB.</>,
            <>Click <strong className="text-gray-800">Stop Campaign</strong> — the current call finishes, then the dialer pauses.</>,
            <>Click <strong className="text-gray-800">Start</strong> again — resumes from where it stopped (already-called students are skipped).</>,
          ].map((text, i) => (
            <li key={i} className="flex gap-3 items-start">
              <span
                className="w-5 h-5 rounded-full text-white flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5"
                style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
              >
                {i + 1}
              </span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MiniCard({ label, value, icon, accent }: { label: string; value: string | number; icon: React.ReactNode; accent: string }) {
  return (
    <div className="stat-card">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-gray-500 font-medium">{label}</span>
      </div>
      <div className="text-xl font-bold" style={{ color: accent }}>{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-xl px-3 py-2.5">
      <div className="text-xs text-gray-400 mb-0.5">{label}</div>
      <div className="text-sm font-semibold text-gray-800 truncate">{value}</div>
    </div>
  );
}

function OutcomeCard({ label, count, color, suffix }: { label: string; count: number; color: string; suffix?: string }) {
  const styles: Record<string, { bg: string; text: string; border: string }> = {
    emerald: { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" },
    amber:   { bg: "#fffbeb", text: "#b45309", border: "#fde68a" },
    red:     { bg: "#fef2f2", text: "#b91c1c", border: "#fecaca" },
    slate:   { bg: "#f8fafc", text: "#475569", border: "#e2e8f0" },
    violet:  { bg: "#f5f3ff", text: "#7c3aed", border: "#ddd6fe" },
  };
  const s = styles[color] || styles.slate;
  return (
    <div
      className="rounded-2xl p-4 text-center border"
      style={{ background: s.bg, borderColor: s.border }}
    >
      <div className="text-2xl font-bold" style={{ color: s.text }}>{count}{suffix || ""}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

