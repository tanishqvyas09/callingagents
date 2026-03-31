/**
 * Campaign Auto-Dialer Control
 *
 * POST /api/ngo-campaign  { action: "start" | "stop" | "status" }
 *
 * Uses an in-memory campaign state that tracks the auto-dialer.
 * When started, it fetches "post" students with phone numbers from
 * student_answer_sheets, skipping those already in ngo_call_results,
 * and calls them one-by-one via /api/ngo-dispatch.
 *
 * The "stop" action sets a flag so the current call will be the last.
 * "status" returns the current campaign state.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { fetchAll } from "@/lib/supabase-fetch-all";
import { normalisePhone } from "@/lib/supabase";
import { STUDENT_TABLE, USE_TEST_TABLE } from "@/lib/table-config";
import type { CampaignState } from "@/lib/types";

export const dynamic = "force-dynamic";

// ── In-memory campaign state (persists across requests in the same process) ──
const campaignState: CampaignState = {
  running: false,
  currentStudentId: null,
  currentStudentName: null,
  currentPhoneNumber: null,
  currentRoomName: null,
  totalInQueue: 0,
  processedCount: 0,
  startedAt: null,
  stoppedAt: null,
  stopRequested: false,
};

// Track the background loop promise
let campaignLoop: Promise<void> | null = null;

// ── Get students to call (not yet called) ────────────────────────────────────
async function getStudentQueue() {
  // Get all post-campaign students with phone numbers (paginated to avoid 1000-row limit)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let students: any[];
  try {
    students = await fetchAll((from, to) =>
      supabaseServer
        .from(STUDENT_TABLE)
        .select(
          USE_TEST_TABLE
            ? `id, student_name, student_name_english, contact_number, age,
               school_id, school_name, campaign_type, project_id`
            : `id, student_name, student_name_english, contact_number, age,
               school_id, school_name, campaign_type, project_id,
               campaign_schools!school_id ( name, city, state )`
        )
        .eq("is_deleted", false)
        .eq("campaign_type", "post")
        .not("contact_number", "is", null)
        .order("created_at", { ascending: true })
        .range(from, to)
    );
  } catch (err) {
    console.error("[campaign] Error fetching students:", err);
    return [];
  }

  // Get all phone numbers already called (paginated)
  let calledRows: { phone_number: string | null }[] = [];
  try {
    calledRows = await fetchAll<{ phone_number: string | null }>((from, to) =>
      supabaseServer
        .from("ngo_call_results")
        .select("phone_number")
        .range(from, to)
    );
  } catch {
    // If call results fail, continue with empty set
  }

  const calledPhones = new Set(
    calledRows
      .map((r) => r.phone_number)
      .filter(Boolean)
  );

  // Filter to valid phones not yet called
  const queue: {
    id: string;
    student_name: string;
    contact_e164: string;
    age: number | null;
    school_name: string | null;
    school_city: string | null;
    school_state: string | null;
  }[] = [];

  for (const s of students) {
    const e164 = normalisePhone(s.contact_number);
    if (!e164) continue;
    if (calledPhones.has(e164)) continue;

    const school = Array.isArray(s.campaign_schools)
      ? s.campaign_schools[0]
      : s.campaign_schools;

    queue.push({
      id: s.id,
      student_name: s.student_name_english || s.student_name,
      contact_e164: e164,
      age: s.age ?? null,
      school_name: (school as { name?: string })?.name ?? s.school_name ?? null,
      school_city: (school as { city?: string })?.city ?? null,
      school_state: (school as { state?: string })?.state ?? null,
    });
  }

  return queue;
}

// ── Dispatch a call for one student ──────────────────────────────────────────
async function dispatchCall(student: {
  id: string;
  student_name: string;
  contact_e164: string;
  age: number | null;
  school_name: string | null;
  school_city: string | null;
}) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/ngo-dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone_number: student.contact_e164,
      participant_name: student.student_name,
      student_name: student.student_name,
      student_age: student.age,
      school_name: student.school_name,
      school_city: student.school_city,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || "Dispatch failed");
  }
  return data as { room_name: string };
}

// ── Wait for call to finish (poll ngo_call_results) ──────────────────────────
async function waitForCallCompletion(roomName: string, maxWaitMs = 180_000) {
  const startTime = Date.now();
  const pollInterval = 4_000; // 4 seconds

  while (Date.now() - startTime < maxWaitMs) {
    const { data } = await supabaseServer
      .from("ngo_call_results")
      .select("id, call_outcome")
      .eq("room_name", roomName)
      .maybeSingle();

    if (data) {
      return data;
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return null; // timeout
}

// ── Safety net: write an "unavailable" row if the agent didn't ───────────────
async function writeUnavailableResult(student: {
  student_name: string;
  contact_e164: string;
  age: number | null;
  school_name: string | null;
  school_city: string | null;
}, roomName: string) {
  const now = new Date().toISOString();
  const { error } = await supabaseServer
    .from("ngo_call_results")
    .insert({
      room_name:             roomName,
      phone_number:          student.contact_e164,
      call_started_at:       now,
      call_ended_at:         now,
      call_duration_seconds: 0,
      call_outcome:          "unavailable",
      total_turns:           0,
      analyzed_at:           now,
      student_name:          student.student_name,
      student_age:           student.age,
      school_name:           student.school_name,
      school_city:           student.school_city,
      transcript:            [],
      summary:               "Call unavailable: timed out waiting for result",
      key_insights:          ["Call was not answered or agent did not report back"],
    })
    .select("id")
    .single();

  if (error && error.code !== "23505") {
    console.error(`[campaign] Failed to write unavailable result: ${error.message}`);
  } else {
    console.log(`[campaign] Wrote safety-net unavailable result for ${student.contact_e164}`);
  }
}

// ── Campaign loop ────────────────────────────────────────────────────────────
async function runCampaignLoop() {
  try {
    const queue = await getStudentQueue();
    campaignState.totalInQueue = queue.length;
    campaignState.processedCount = 0;

    console.log(`[campaign] Starting auto-dialer with ${queue.length} students`);

    for (const student of queue) {
      // Check if stop was requested
      if (campaignState.stopRequested) {
        console.log("[campaign] Stop requested, finishing after current state");
        break;
      }

      // Update state
      campaignState.currentStudentId = student.id;
      campaignState.currentStudentName = student.student_name;
      campaignState.currentPhoneNumber = student.contact_e164;

      console.log(`[campaign] Calling student: ${student.student_name} (${student.contact_e164})`);

      try {
        const result = await dispatchCall(student);
        campaignState.currentRoomName = result.room_name;

        // Wait for call to complete (agent writes result via /api/ngo-analyze)
        const callResult = await waitForCallCompletion(result.room_name);

        if (callResult) {
          console.log(`[campaign] Call completed: ${student.student_name} → ${callResult.call_outcome}`);
        } else {
          // Agent didn't write a result in time — write a safety-net "unavailable" row
          console.log(`[campaign] Call timed out: ${student.student_name} — writing unavailable result`);
          await writeUnavailableResult(student, result.room_name);
        }
      } catch (err) {
        console.error(`[campaign] Dispatch failed for ${student.student_name}:`, err);
        // Dispatch itself failed (e.g. network error to ngo-dispatch API) —
        // write an unavailable row so we don't retry this student forever.
        const failedRoom = `ngo-failed-${Date.now()}`;
        await writeUnavailableResult(student, failedRoom);
      }

      campaignState.processedCount++;

      // Check stop again after call completes
      if (campaignState.stopRequested) {
        console.log("[campaign] Stop requested, this was the last call");
        break;
      }

      // Small delay between calls
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } catch (err) {
    console.error("[campaign] Loop error:", err);
  } finally {
    campaignState.running = false;
    campaignState.currentStudentId = null;
    campaignState.currentStudentName = null;
    campaignState.currentPhoneNumber = null;
    campaignState.currentRoomName = null;
    campaignState.stoppedAt = new Date().toISOString();
    campaignState.stopRequested = false;
    campaignLoop = null;
    console.log("[campaign] Auto-dialer stopped");
  }
}

// ── Route handler ────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as string;

    switch (action) {
      case "start": {
        if (campaignState.running) {
          return NextResponse.json({
            ...campaignState,
            message: "Campaign is already running",
          });
        }

        // Reset state
        campaignState.running = true;
        campaignState.stopRequested = false;
        campaignState.startedAt = new Date().toISOString();
        campaignState.stoppedAt = null;
        campaignState.processedCount = 0;

        // Start the loop in background (don't await)
        campaignLoop = runCampaignLoop();

        return NextResponse.json({
          ...campaignState,
          message: "Campaign started",
        });
      }

      case "stop": {
        if (!campaignState.running) {
          return NextResponse.json({
            ...campaignState,
            message: "Campaign is not running",
          });
        }

        campaignState.stopRequested = true;
        return NextResponse.json({
          ...campaignState,
          message: "Stop requested — current call will be the last",
        });
      }

      case "status": {
        return NextResponse.json(campaignState);
      }

      default:
        return NextResponse.json({ error: "Invalid action. Use: start, stop, status" }, { status: 400 });
    }
  } catch (err) {
    console.error("[ngo-campaign] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// Also support GET for easy status check
export async function GET() {
  return NextResponse.json(campaignState);
}
