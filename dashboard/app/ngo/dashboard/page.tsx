"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import type { DashboardStats, CampaignState } from "@/lib/types";

const DashboardOverview = dynamic(() => import("@/components/DashboardOverview"), {
  ssr: false,
  loading: () => <LoadingPlaceholder />,
});

const CampaignManager = dynamic(() => import("@/components/CampaignManager"), {
  ssr: false,
  loading: () => <LoadingPlaceholder />,
});

const CallResultsTable = dynamic(() => import("@/components/CallResultsTable"), {
  ssr: false,
  loading: () => <LoadingPlaceholder />,
});

const StudentRecords = dynamic(() => import("@/components/StudentRecords"), {
  ssr: false,
  loading: () => <LoadingPlaceholder />,
});

type Tab = "overview" | "campaign" | "results" | "students";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "overview",  label: "Dashboard",       icon: "📊" },
  { id: "campaign",  label: "Campaign Manager", icon: "📞" },
  { id: "results",   label: "Call Results",     icon: "📋" },
  { id: "students",  label: "Student Records",  icon: "🎓" },
];

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [campaignState, setCampaignState] = useState<CampaignState | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/ngo-stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch campaign state
  const fetchCampaignState = useCallback(async () => {
    try {
      const res = await fetch("/api/ngo-campaign");
      if (res.ok) {
        const data = await res.json();
        setCampaignState(data);
      }
    } catch (err) {
      console.error("Failed to fetch campaign state:", err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchStats();
    fetchCampaignState();
  }, [fetchStats, fetchCampaignState]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStats();
      fetchCampaignState();
    }, 10_000);
    return () => clearInterval(interval);
  }, [fetchStats, fetchCampaignState]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* ── Header ── */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex-shrink-0">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-rose-600 flex items-center justify-center text-xl font-bold text-white shadow-lg">
              L
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">
                Team Lajja — Dashboard
              </h1>
              <p className="text-xs text-slate-400">
                Making the Difference NGO — Menstrual Hygiene Campaign
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Campaign status indicator */}
            {campaignState?.running && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-950 border border-emerald-700">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
                <span className="text-xs font-medium text-emerald-300">
                  Calling: {campaignState.currentStudentName || "..."}
                </span>
              </div>
            )}
            <a
              href="/ngo"
              className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
            >
              ← Single Call
            </a>
          </div>
        </div>
      </header>

      {/* ── Tab navigation ── */}
      <nav className="bg-slate-900/50 border-b border-slate-800 px-6 flex-shrink-0">
        <div className="max-w-[1400px] mx-auto flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-all ${
                tab === t.id
                  ? "border-rose-500 text-white"
                  : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600"
              }`}
            >
              <span className="mr-1.5">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Tab content ── */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-6 overflow-y-auto">
        {tab === "overview" && (
          <DashboardOverview
            stats={stats}
            loading={loading}
            onRefresh={fetchStats}
          />
        )}
        {tab === "campaign" && (
          <CampaignManager
            campaignState={campaignState}
            stats={stats}
            onRefresh={() => { fetchStats(); fetchCampaignState(); }}
          />
        )}
        {tab === "results" && <CallResultsTable />}
        {tab === "students" && <StudentRecords />}
      </main>
    </div>
  );
}

function LoadingPlaceholder() {
  return (
    <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
      <div className="flex items-center gap-2">
        <span className="w-4 h-4 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin" />
        Loading...
      </div>
    </div>
  );
}
