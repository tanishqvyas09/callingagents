/**
 * GET /api/ngo-call-results
 *
 * Returns paginated call results from ngo_call_results table.
 *
 * Query params:
 *   page?     — page number (default 1)
 *   limit?    — results per page (default 20, max 100)
 *   outcome?  — filter by call_outcome
 *   search?   — search by student_name or phone_number
 *   school?   — filter by school_name
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page     = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit    = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
    const outcome  = searchParams.get("outcome") ?? undefined;
    const search   = searchParams.get("search") ?? undefined;
    const school   = searchParams.get("school") ?? undefined;
    const offset   = (page - 1) * limit;

    // Build query
    let query = supabaseServer
      .from("ngo_call_results")
      .select("*", { count: "exact" })
      .order("analyzed_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (outcome) {
      query = query.eq("call_outcome", outcome);
    }
    if (school) {
      query = query.ilike("school_name", `%${school}%`);
    }
    if (search) {
      query = query.or(`student_name.ilike.%${search}%,phone_number.ilike.%${search}%`);
    }

    const { data, count, error } = await query;

    if (error) {
      console.error("[ngo-call-results] error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      results: data ?? [],
      total: count ?? 0,
      page,
      limit,
      totalPages: count ? Math.ceil(count / limit) : 0,
    });
  } catch (err) {
    console.error("[ngo-call-results] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
