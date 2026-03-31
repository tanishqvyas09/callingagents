"use client";

import { useState, useCallback, useEffect } from "react";
import type { CampaignState, DashboardStats } from "../lib/types";

interface Props {
  campaignState: CampaignState | null;
  stats: DashboardStats | null;
  onRefresh: () => void;
}

export default function CampaignManager({ campaignState, stats, onRefresh }: Props) {
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [localState, setLocalState] = useState<CampaignState | null>(campaignState);

  // Sync with parent props
  useEffect(() => {
    setLocalState(campaignState);
  }, [campaignState]);

  // Auto-poll while running
  useEffect(() => {
    if (!localState?.running) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/ngo-campaign");
        if (res.ok) {
          const data = await res.json();
          setLocalState(data);
        }
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
    } catch (err) {
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
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">Auto-Dialer Control</h2>
            <p className="text-sm text-slate-400 mt-1">
              Start the campaign to automatically call students one by one
            </p>
          </div>

          {/* Status badge */}
          <div className={`px-4 py-2 rounded-full text-sm font-semibold ${
            running
              ? stopRequested
                ? "bg-amber-950 border border-amber-700 text-amber-300"
                : "bg-emerald-950 border border-emerald-700 text-emerald-300"
              : "bg-slate-800 border border-slate-700 text-slate-300"
          }`}>
            {running
              ? stopRequested
                ? "⏳ Stopping after current call..."
                : "🟢 Running"
              : "⏸ Stopped"}
          </div>
        </div>

        {/* Start / Stop buttons */}
        <div className="flex gap-4">
          {!running ? (
            <button
              onClick={() => handleAction("start")}
              disabled={actionLoading}
              className="flex-1 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl shadow-lg transition-all disabled:opacity-50 text-lg"
            >
              {actionLoading ? "Starting..." : "▶ Start Campaign"}
            </button>
          ) : (
            <button
              onClick={() => handleAction("stop")}
              disabled={actionLoading || stopRequested}
              className="flex-1 py-4 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold rounded-xl shadow-lg transition-all disabled:opacity-50 text-lg"
            >
              {stopRequested ? "Finishing last call..." : actionLoading ? "Stopping..." : "⏹ Stop Campaign"}
            </button>
          )}
        </div>

        {actionMsg && (
          <div className="mt-4 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-300">
            {actionMsg}
          </div>
        )}
      </div>

      {/* ── Campaign Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MiniCard label="Queue Size" value={localState?.totalInQueue ?? 0} icon="📋" />
        <MiniCard label="Processed" value={localState?.processedCount ?? 0} icon="✅" />
        <MiniCard
          label="Started At"
          value={localState?.startedAt ? new Date(localState.startedAt).toLocaleTimeString() : "—"}
          icon="🕐"
        />
        <MiniCard
          label="Stopped At"
          value={localState?.stoppedAt ? new Date(localState.stoppedAt).toLocaleTimeString() : "—"}
          icon="🕐"
        />
      </div>

      {/* ── Current Call ── */}
      {running && (
        <div className="bg-slate-900 border border-emerald-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-emerald-400 mb-4 flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            Currently Calling
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <InfoRow label="Student" value={localState?.currentStudentName || "—"} />
            <InfoRow label="Phone" value={localState?.currentPhoneNumber || "—"} />
            <InfoRow label="Room" value={localState?.currentRoomName || "—"} />
          </div>

          {/* Progress within this batch */}
          {(localState?.totalInQueue ?? 0) > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>Progress this session</span>
                <span>
                  {localState?.processedCount ?? 0} / {localState?.totalInQueue ?? 0}
                </span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{
                    width: `${
                      (localState?.totalInQueue ?? 0) > 0
                        ? Math.round(((localState?.processedCount ?? 0) / (localState?.totalInQueue ?? 1)) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Overall Campaign Progress ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-4">Overall Campaign Progress</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <MiniCard label="Total Students" value={stats?.totalStudents ?? 0} icon="🎓" />
          <MiniCard label="With Phone" value={stats?.studentsWithPhone ?? 0} icon="📱" />
          <MiniCard label="Called" value={stats?.studentsProcessed ?? 0} icon="📞" />
          <MiniCard label="Remaining" value={stats?.studentsRemaining ?? 0} icon="⏳" />
        </div>

        <div className="w-full bg-slate-800 rounded-full h-4 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-rose-500 to-violet-500 rounded-full transition-all duration-700"
            style={{ width: `${stats?.progressPercent ?? 0}%` }}
          />
        </div>
        <div className="text-right text-xs text-slate-400 mt-1">
          {stats?.progressPercent ?? 0}% complete
        </div>
      </div>

      {/* ── Quick Stats from Results ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <OutcomeCard label="Completed" count={stats?.completedCalls ?? 0} color="emerald" />
        <OutcomeCard label="Partial" count={stats?.partialCalls ?? 0} color="amber" />
        <OutcomeCard label="Hung Up" count={stats?.hungUpEarlyCalls ?? 0} color="red" />
        <OutcomeCard label="Unavailable" count={stats?.failedCalls ?? 0} color="slate" />
        <OutcomeCard label="Avg Sentiment" count={stats?.avgSentiment ?? 0} color="violet" suffix="/100" />
      </div>

      {/* ── How it works ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-3">How the Auto-Dialer Works</h3>
        <ol className="space-y-2 text-xs text-slate-400">
          <li className="flex gap-3">
            <span className="w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center flex-shrink-0 text-xs font-bold">1</span>
            <span>Click <strong className="text-white">Start Campaign</strong> — the system fetches all post-sheet students with valid phone numbers.</span>
          </li>
          <li className="flex gap-3">
            <span className="w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center flex-shrink-0 text-xs font-bold">2</span>
            <span>Students already present in <code className="text-rose-300">ngo_call_results</code> are skipped automatically.</span>
          </li>
          <li className="flex gap-3">
            <span className="w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center flex-shrink-0 text-xs font-bold">3</span>
            <span>Each student is called one-by-one. The agent does the survey, AI analyzes results, and pushes to DB.</span>
          </li>
          <li className="flex gap-3">
            <span className="w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center flex-shrink-0 text-xs font-bold">4</span>
            <span>Click <strong className="text-white">Stop Campaign</strong> — the current call finishes, then the dialer pauses.</span>
          </li>
          <li className="flex gap-3">
            <span className="w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center flex-shrink-0 text-xs font-bold">5</span>
            <span>Click <strong className="text-white">Start</strong> again — resumes from where it stopped (already-called students are skipped).</span>
          </li>
        </ol>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MiniCard({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1">
        <span>{icon}</span>
        <span className="text-xs text-slate-400">{label}</span>
      </div>
      <div className="text-xl font-bold text-white">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500 mb-0.5">{label}</div>
      <div className="text-sm font-medium text-white truncate">{value}</div>
    </div>
  );
}

function OutcomeCard({
  label, count, color, suffix,
}: {
  label: string;
  count: number;
  color: string;
  suffix?: string;
}) {
  const BG: Record<string, string> = {
    emerald: "bg-emerald-950 border-emerald-800",
    amber:   "bg-amber-950 border-amber-800",
    red:     "bg-red-950 border-red-800",
    slate:   "bg-slate-800 border-slate-700",
    violet:  "bg-violet-950 border-violet-800",
  };
  const TEXT: Record<string, string> = {
    emerald: "text-emerald-300",
    amber:   "text-amber-300",
    red:     "text-red-300",
    slate:   "text-slate-300",
    violet:  "text-violet-300",
  };
  return (
    <div className={`border rounded-xl p-3 text-center ${BG[color] || BG.slate}`}>
      <div className={`text-2xl font-bold ${TEXT[color] || TEXT.slate}`}>
        {count}{suffix || ""}
      </div>
      <div className="text-xs text-slate-400 mt-0.5">{label}</div>
    </div>
  );
}
