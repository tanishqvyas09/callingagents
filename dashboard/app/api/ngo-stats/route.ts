/**
 * GET /api/ngo-stats
 *
 * Aggregates data from both student_answer_sheets (campaign) and
 * ngo_call_results (calls) to produce dashboard statistics.
 */

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { fetchAll } from "@/lib/supabase-fetch-all";
import { STUDENT_TABLE } from "@/lib/table-config";
import type { DashboardStats } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // ── 1. Campaign students (post sheets with phone numbers) ────────────
    const allStudents = await fetchAll<{
      id: string;
      contact_number: string | null;
      school_name: string | null;
      school_id: string | null;
      campaign_type: string | null;
      age: number | null;
    }>((from, to) =>
      supabaseServer
        .from(STUDENT_TABLE)
        .select("id, contact_number, school_name, school_id, campaign_type, age")
        .eq("is_deleted", false)
        .eq("campaign_type", "post")
        .range(from, to)
    );

    const totalStudents = allStudents.length;
    const studentsWithPhone = allStudents.filter(
      (s) => s.contact_number && s.contact_number.trim().length >= 10
    ).length;

    // ── 2. Call results ──────────────────────────────────────────────────
    const allCalls = await fetchAll<{
      id: string;
      phone_number: string | null;
      call_outcome: string | null;
      call_duration_seconds: number | null;
      total_turns: number | null;
      detected_language: string | null;
      sentiment_overall: number | null;
      sentiment_engagement: number | null;
      sentiment_comfort: number | null;
      sentiment_awareness_gain: number | null;
      sentiment_product_adoption: number | null;
      sentiment_positivity: number | null;
      student_name: string | null;
      school_name: string | null;
      school_city: string | null;
      q1_previous_product: string | null;
      q2_received_book: string | null;
      q3_shared_knowledge: string | null;
      q4_using_kit: string | null;
      q5_cloth_pad_comfort: string | null;
      q6_will_continue: string | null;
      q7_barrier: string | null;
      q8_session_rating: string | null;
      analyzed_at: string | null;
      call_started_at: string | null;
    }>((from, to) =>
      supabaseServer
        .from("ngo_call_results")
        .select(
          "id, phone_number, call_outcome, call_duration_seconds, total_turns, detected_language, sentiment_overall, sentiment_engagement, sentiment_comfort, sentiment_awareness_gain, sentiment_product_adoption, sentiment_positivity, student_name, school_name, school_city, q1_previous_product, q2_received_book, q3_shared_knowledge, q4_using_kit, q5_cloth_pad_comfort, q6_will_continue, q7_barrier, q8_session_rating, analyzed_at, call_started_at"
        )
        .order("analyzed_at", { ascending: false })
        .range(from, to)
    );

    const totalCalls = allCalls.length;

    // Outcome counts
    const completedCalls = allCalls.filter((c) => c.call_outcome === "completed").length;
    const partialCalls = allCalls.filter((c) => c.call_outcome === "partial").length;
    const failedCalls = allCalls.filter((c) => c.call_outcome === "unavailable").length;
    const hungUpEarlyCalls = allCalls.filter((c) => c.call_outcome === "hung_up_early").length;

    // Unique phone numbers processed
    const uniquePhones = new Set(allCalls.map((c) => c.phone_number).filter(Boolean));
    const studentsProcessed = uniquePhones.size;
    const studentsRemaining = Math.max(0, studentsWithPhone - studentsProcessed);
    const progressPercent = studentsWithPhone > 0
      ? Math.round((studentsProcessed / studentsWithPhone) * 100)
      : 0;

    // Averages
    const sentimentVals = allCalls.map((c) => c.sentiment_overall).filter((v): v is number => v != null);
    const avgSentiment = sentimentVals.length > 0
      ? Math.round(sentimentVals.reduce((a, b) => a + b, 0) / sentimentVals.length)
      : 0;

    const durationVals = allCalls.map((c) => c.call_duration_seconds).filter((v): v is number => v != null);
    const avgDuration = durationVals.length > 0
      ? Math.round(durationVals.reduce((a, b) => a + b, 0) / durationVals.length)
      : 0;

    const turnVals = allCalls.map((c) => c.total_turns).filter((v): v is number => v != null);
    const avgTurns = turnVals.length > 0
      ? Math.round(turnVals.reduce((a, b) => a + b, 0) / turnVals.length)
      : 0;

    // ── 3. Outcome distribution (pie chart) ──────────────────────────────
    const outcomeDistribution = [
      { name: "Completed", value: completedCalls, color: "#10b981" },
      { name: "Partial", value: partialCalls, color: "#f59e0b" },
      { name: "Hung Up Early", value: hungUpEarlyCalls, color: "#ef4444" },
      { name: "Unavailable", value: failedCalls, color: "#6b7280" },
    ].filter((o) => o.value > 0);

    // ── 4. Sentiment factors averages ────────────────────────────────────
    function factorAvg(key: "sentiment_engagement" | "sentiment_comfort" | "sentiment_awareness_gain" | "sentiment_product_adoption" | "sentiment_positivity") {
      const vals = allCalls.map((c) => c[key]).filter((v): v is number => v != null);
      return vals.length > 0 ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0;
    }

    const sentimentFactors = [
      { factor: "Engagement", avg: factorAvg("sentiment_engagement"), max: 20 },
      { factor: "Comfort", avg: factorAvg("sentiment_comfort"), max: 20 },
      { factor: "Awareness Gain", avg: factorAvg("sentiment_awareness_gain"), max: 20 },
      { factor: "Product Adoption", avg: factorAvg("sentiment_product_adoption"), max: 20 },
      { factor: "Positivity", avg: factorAvg("sentiment_positivity"), max: 20 },
    ];

    // ── 5. Question answer distribution ──────────────────────────────────
    function questionDist(key: string, label: string) {
      const counts: Record<string, number> = {};
      for (const c of allCalls) {
        const val = (c as Record<string, unknown>)[key] as string | null;
        if (val) {
          const normalized = val.toLowerCase().trim();
          counts[normalized] = (counts[normalized] || 0) + 1;
        }
      }
      return {
        question: label,
        key,
        answers: Object.entries(counts)
          .map(([answer, count]) => ({ answer, count }))
          .sort((a, b) => b.count - a.count),
      };
    }

    const questionStats = [
      questionDist("q1_previous_product", "Previous product used"),
      questionDist("q2_received_book", "Received book"),
      questionDist("q3_shared_knowledge", "Shared knowledge"),
      questionDist("q4_using_kit", "Using kit"),
      questionDist("q6_will_continue", "Will continue"),
      questionDist("q8_session_rating", "Session rating"),
    ];

    // ── 6. School breakdown ──────────────────────────────────────────────
    const schoolMap = new Map<string, { total: number; called: number; sentimentSum: number; sentimentCount: number }>();
    for (const s of allStudents) {
      const name = s.school_name || "Unknown";
      if (!schoolMap.has(name)) {
        schoolMap.set(name, { total: 0, called: 0, sentimentSum: 0, sentimentCount: 0 });
      }
      schoolMap.get(name)!.total++;
    }
    for (const c of allCalls) {
      const name = c.school_name || "Unknown";
      if (!schoolMap.has(name)) {
        schoolMap.set(name, { total: 0, called: 0, sentimentSum: 0, sentimentCount: 0 });
      }
      const entry = schoolMap.get(name)!;
      entry.called++;
      if (c.sentiment_overall != null) {
        entry.sentimentSum += c.sentiment_overall;
        entry.sentimentCount++;
      }
    }
    const schoolBreakdown = Array.from(schoolMap.entries())
      .map(([school, data]) => ({
        school,
        total: data.total,
        called: data.called,
        avgSentiment: data.sentimentCount > 0 ? Math.round(data.sentimentSum / data.sentimentCount) : 0,
      }))
      .filter((s) => s.school !== "Unknown" && (s.total > 0 || s.called > 0))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);

    // ── 7. Daily progress ────────────────────────────────────────────────
    const dailyMap = new Map<string, { calls: number; completed: number }>();
    for (const c of allCalls) {
      const date = c.analyzed_at ? c.analyzed_at.split("T")[0] : "unknown";
      if (!dailyMap.has(date)) dailyMap.set(date, { calls: 0, completed: 0 });
      dailyMap.get(date)!.calls++;
      if (c.call_outcome === "completed") dailyMap.get(date)!.completed++;
    }
    const dailyProgress = Array.from(dailyMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // ── 8. Language distribution ─────────────────────────────────────────
    const langMap = new Map<string, number>();
    for (const c of allCalls) {
      const lang = c.detected_language || "unknown";
      langMap.set(lang, (langMap.get(lang) || 0) + 1);
    }
    const languageDistribution = Array.from(langMap.entries())
      .map(([language, count]) => ({ language, count }))
      .sort((a, b) => b.count - a.count);

    // ── 9. Barrier analysis ──────────────────────────────────────────────
    const barrierMap = new Map<string, number>();
    for (const c of allCalls) {
      if (c.q7_barrier) {
        const barrier = c.q7_barrier.toLowerCase().trim();
        barrierMap.set(barrier, (barrierMap.get(barrier) || 0) + 1);
      }
    }
    const barrierAnalysis = Array.from(barrierMap.entries())
      .map(([barrier, count]) => ({ barrier, count }))
      .sort((a, b) => b.count - a.count);

    // ── Return ───────────────────────────────────────────────────────────
    const stats: DashboardStats = {
      totalStudents,
      studentsWithPhone,
      totalCalls,
      completedCalls,
      partialCalls,
      failedCalls,
      hungUpEarlyCalls,
      studentsProcessed,
      studentsRemaining,
      progressPercent,
      avgSentiment,
      avgDuration,
      avgTurns,
      outcomeDistribution,
      sentimentFactors,
      questionStats,
      schoolBreakdown,
      dailyProgress,
      languageDistribution,
      barrierAnalysis,
    };

    return NextResponse.json(stats);
  } catch (err) {
    console.error("[ngo-stats] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
