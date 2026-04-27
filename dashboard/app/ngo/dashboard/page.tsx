"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  PhoneCall,
  ClipboardList,
  GraduationCap,
  Phone,
  Activity,
  ChevronRight,
} from "lucide-react";
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

const TABS: { id: Tab; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "overview",  label: "Dashboard",        icon: <LayoutDashboard size={18} />, desc: "Overview & analytics" },
  { id: "campaign",  label: "Campaign Manager",  icon: <PhoneCall size={18} />,       desc: "Auto-dialer control" },
  { id: "results",   label: "Call Results",      icon: <ClipboardList size={18} />,   desc: "Detailed call logs" },
  { id: "students",  label: "Student Records",   icon: <GraduationCap size={18} />,   desc: "Student database" },
];

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [campaignState, setCampaignState] = useState<CampaignState | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/ngo-stats");
      if (res.ok) { const data = await res.json(); setStats(data); }
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCampaignState = useCallback(async () => {
    try {
      const res = await fetch("/api/ngo-campaign");
      if (res.ok) { const data = await res.json(); setCampaignState(data); }
    } catch (err) {
      console.error("Failed to fetch campaign state:", err);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchCampaignState();
  }, [fetchStats, fetchCampaignState]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchStats();
      fetchCampaignState();
    }, 10_000);
    return () => clearInterval(interval);
  }, [fetchStats, fetchCampaignState]);

  const activeTab = TABS.find((t) => t.id === tab)!;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "linear-gradient(135deg, #f8fafc 0%, #ecfdf5 40%, #f0fdf4 70%, #f8fafc 100%)" }}>

      {/* ── Sidebar ── */}
      <motion.aside
        initial={false}
        animate={{ width: sidebarCollapsed ? 68 : 260 }}
        transition={{ duration: 0.22, ease: "easeInOut" }}
        className="flex-shrink-0 flex flex-col h-full overflow-hidden"
        style={{
          background: "rgba(255,255,255,0.82)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderRight: "1px solid rgba(16,185,129,0.12)",
          boxShadow: "4px 0 24px rgba(16,185,129,0.06)",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 flex-shrink-0 border-b border-emerald-50">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-base flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #10b981, #059669)", boxShadow: "0 2px 8px rgba(16,185,129,0.4)" }}
          >
            L
          </div>
          <AnimatePresence>
            {!sidebarCollapsed && (
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="text-sm font-bold text-gray-900 leading-tight whitespace-nowrap">Team Lajja</div>
                <div className="text-xs text-emerald-600 font-medium whitespace-nowrap">Making the Difference</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {TABS.map((t) => {
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="w-full text-left"
                title={sidebarCollapsed ? t.label : undefined}
              >
                <div
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 ${
                    isActive
                      ? "text-white shadow-sm"
                      : "text-gray-500 hover:text-gray-800 hover:bg-emerald-50"
                  }`}
                  style={isActive ? { background: "linear-gradient(135deg, #10b981, #059669)", boxShadow: "0 2px 8px rgba(16,185,129,0.3)" } : {}}
                >
                  <span className="flex-shrink-0">{t.icon}</span>
                  <AnimatePresence>
                    {!sidebarCollapsed && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.12 }}
                        className="overflow-hidden min-w-0"
                      >
                        <div className="text-sm font-semibold whitespace-nowrap">{t.label}</div>
                        <div className={`text-xs whitespace-nowrap ${isActive ? "text-emerald-100" : "text-gray-400"}`}>{t.desc}</div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {isActive && !sidebarCollapsed && (
                    <ChevronRight size={14} className="ml-auto flex-shrink-0 text-emerald-100" />
                  )}
                </div>
              </button>
            );
          })}
        </nav>

        {/* Collapse toggle + single-call link */}
        <div className="flex-shrink-0 border-t border-emerald-50 px-3 py-3 space-y-1">
          <a
            href="/ngo"
            title="Single Call"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 transition-all`}
          >
            <Phone size={18} className="flex-shrink-0" />
            {!sidebarCollapsed && <span className="text-sm font-medium whitespace-nowrap">Single Call</span>}
          </a>
          <button
            onClick={() => setSidebarCollapsed((c) => !c)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all w-full"
          >
            <motion.div animate={{ rotate: sidebarCollapsed ? 0 : 180 }} transition={{ duration: 0.22 }}>
              <ChevronRight size={18} />
            </motion.div>
            {!sidebarCollapsed && <span className="text-xs font-medium whitespace-nowrap">Collapse</span>}
          </button>
        </div>
      </motion.aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* ── Top header bar ── */}
        <header
          className="flex-shrink-0 flex items-center justify-between px-6 py-4"
          style={{
            background: "rgba(255,255,255,0.75)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderBottom: "1px solid rgba(16,185,129,0.1)",
          }}
        >
          <div>
            <h1 className="text-lg font-bold text-gray-900">{activeTab.label}</h1>
            <p className="text-xs text-gray-500 mt-0.5">Menstrual Hygiene Campaign · Team Lajja</p>
          </div>

          <div className="flex items-center gap-3">
            {campaignState?.running && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full"
                style={{ background: "#dcfce7", border: "1px solid #6ee7b7" }}
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <Activity size={12} className="text-emerald-700" />
                <span className="text-xs font-semibold text-emerald-700">
                  Calling: {campaignState.currentStudentName || "..."}
                </span>
              </motion.div>
            )}
            <div className="text-xs text-gray-400 bg-white border border-gray-200 rounded-lg px-3 py-1.5 font-medium">
              {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </div>
          </div>
        </header>

        {/* ── Page content ── */}
        <main className="flex-1 overflow-y-auto px-6 py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {tab === "overview" && (
                <DashboardOverview stats={stats} loading={loading} onRefresh={fetchStats} />
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
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function LoadingPlaceholder() {
  return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
      <div className="flex items-center gap-2">
        <span className="w-4 h-4 border-2 border-emerald-200 border-t-emerald-500 rounded-full animate-spin" />
        Loading...
      </div>
    </div>
  );
}
