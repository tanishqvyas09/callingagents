/**
 * GET /api/ngo-students
 *
 * Fetches students from Supabase campaign_results joined with campaign_schools.
 * Only returns students with a valid 10-digit Indian mobile number.
 *
 * Query params:
 *   search?  — partial name search (ilike)
 *   limit?   — max results (default 100)
 *   school_id? — filter by specific school UUID
 *
 * Returns:
 *   { students: NgoStudent[]; total: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchNgoStudents } from "../../../lib/supabase";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search   = searchParams.get("search")    ?? undefined;
    const limitRaw = searchParams.get("limit")     ?? "100";
    const limit    = Math.min(parseInt(limitRaw, 10) || 100, 500);

    const { data, error } = await fetchNgoStudents(search, limit);

    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }

    return NextResponse.json({
      students: data,
      total: data.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ngo-students] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
