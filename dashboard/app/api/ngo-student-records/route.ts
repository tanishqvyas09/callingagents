/**
 * GET /api/ngo-student-records
 *
 * Returns paginated student records from student_answer_sheets,
 * joined with campaign_schools for school info, and cross-referenced
 * with ngo_call_results so each row shows whether the student has been called.
 *
 * Query params:
 *   page          - page number (default 1)
 *   limit         - rows per page (default 25, max 100)
 *   campaign_type - "post" | "pre" (default "post")
 *   call_filter   - "all" | "called" | "not_called" (default "all")
 *   search        - optional name / phone / school ilike search
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { fetchAll } from "@/lib/supabase-fetch-all";
import { normalisePhone } from "@/lib/supabase";
import { STUDENT_TABLE, USE_TEST_TABLE } from "@/lib/table-config";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "25", 10)));
    const campaignType = url.searchParams.get("campaign_type") || "post";
    const callFilter = url.searchParams.get("call_filter") || "all";
    const search = url.searchParams.get("search")?.trim() || "";

    // ── 1. Fetch students from student table ──────────────────────────────
    let query = supabaseServer
      .from(STUDENT_TABLE)
      .select(
        USE_TEST_TABLE
          ? `id, student_name, student_name_english, contact_number, age,
             school_id, school_name, campaign_type, percentage, grade, date`
          : `id, student_name, student_name_english, contact_number, age,
             school_id, school_name, campaign_type, percentage, grade, date,
             campaign_schools!school_id ( name, city, state )`,
        { count: "exact" }
      )
      .eq("is_deleted", false)
      .eq("campaign_type", campaignType)
      .order("created_at", { ascending: false });

    // Search filter — name, phone, or school
    if (search) {
      query = query.or(
        `student_name.ilike.%${search}%,student_name_english.ilike.%${search}%,contact_number.ilike.%${search}%,school_name.ilike.%${search}%`
      );
    }

    // We need to know call status. Unfortunately we can't do the cross-join
    // in one query efficiently, so we fetch the page of students first,
    // then check call status in a second step.
    //
    // For "called" / "not_called" filters we need to do it differently:
    // fetch all phone numbers that have been called, then apply the filter.

    // If call_filter is not "all", we need the called-phones set BEFORE paging
    let calledPhones: Set<string> = new Set();
    let calledOutcomes: Map<string, { outcome: string; date: string }> = new Map();

    if (callFilter !== "all" || true) {
      // Always fetch called phones so we can annotate every row (paginated)
      const callResults = await fetchAll<{
        phone_number: string | null;
        call_outcome: string | null;
        analyzed_at: string | null;
      }>((from, to) =>
        supabaseServer
          .from("ngo_call_results")
          .select("phone_number, call_outcome, analyzed_at")
          .order("analyzed_at", { ascending: false })
          .range(from, to)
      );

      for (const cr of callResults) {
        if (cr.phone_number) {
          const norm = normalisePhone(cr.phone_number);
          if (norm && !calledPhones.has(norm)) {
            calledPhones.add(norm);
            calledOutcomes.set(norm, {
              outcome: cr.call_outcome ?? "completed",
              date: cr.analyzed_at ?? "",
            });
          }
        }
      }
    }

    // For call_filter we need to handle it in JS after fetch (since the filter
    // is based on a cross-table condition). Fetch more rows to compensate.
    if (callFilter === "all") {
      // Simple pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data: students, count, error } = await query;

      if (error) {
        console.error("[ngo-student-records] error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const mapped = (students ?? []).map((s) => mapStudent(s, calledPhones, calledOutcomes));
      const total = count ?? 0;

      return NextResponse.json({
        students: mapped,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } else {
      // Fetch ALL matching students (paginated), then filter by call status, then paginate in JS
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allStudents = await fetchAll<any>((from, to) => {
        let q = supabaseServer
          .from(STUDENT_TABLE)
          .select(
            USE_TEST_TABLE
              ? `id, student_name, student_name_english, contact_number, age,
                 school_id, school_name, campaign_type, percentage, grade, date`
              : `id, student_name, student_name_english, contact_number, age,
                 school_id, school_name, campaign_type, percentage, grade, date,
                 campaign_schools!school_id ( name, city, state )`
          )
          .eq("is_deleted", false)
          .eq("campaign_type", campaignType)
          .order("created_at", { ascending: false });

        if (search) {
          q = q.or(
            `student_name.ilike.%${search}%,student_name_english.ilike.%${search}%,contact_number.ilike.%${search}%,school_name.ilike.%${search}%`
          );
        }

        return q.range(from, to);
      });

      const allMapped = allStudents.map((s) =>
        mapStudent(s, calledPhones, calledOutcomes)
      );

      const filtered =
        callFilter === "called"
          ? allMapped.filter((s) => s.has_been_called)
          : allMapped.filter((s) => !s.has_been_called && s.contact_number);

      const total = filtered.length;
      const from = (page - 1) * limit;
      const paged = filtered.slice(from, from + limit);

      return NextResponse.json({
        students: paged,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    }
  } catch (err: unknown) {
    console.error("[ngo-student-records] unexpected error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapStudent(
  s: any,
  calledPhones: Set<string>,
  calledOutcomes: Map<string, { outcome: string; date: string }>
) {
  const school = Array.isArray(s.campaign_schools)
    ? s.campaign_schools[0]
    : s.campaign_schools;

  const norm = normalisePhone(s.contact_number);
  const called = norm ? calledPhones.has(norm) : false;
  const callInfo = norm ? calledOutcomes.get(norm) : undefined;

  return {
    id: s.id,
    student_name: s.student_name,
    student_name_english: s.student_name_english,
    contact_number: s.contact_number,
    age: s.age,
    school_name: school?.name ?? s.school_name ?? null,
    school_city: school?.city ?? null,
    school_state: school?.state ?? null,
    campaign_type: s.campaign_type,
    percentage: s.percentage,
    grade: s.grade,
    date: s.date,
    has_been_called: called,
    call_outcome: callInfo?.outcome ?? null,
    last_call_at: callInfo?.date ?? null,
  };
}
