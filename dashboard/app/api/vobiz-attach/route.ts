/**
 * GET /api/vobiz-attach?id=<ngo_call_results row UUID>
 *
 * Returns the recording_url for a saved call result row.
 * With LiveKit Egress the URL is stored synchronously at call end,
 * so this endpoint is a simple single-read (no polling needed).
 *
 * Response:
 *   { recording_url: string | null, ready: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("ngo_call_results")
    .select("recording_url")
    .eq("id", id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    recording_url: data?.recording_url ?? null,
    ready: !!data?.recording_url,
  });
}
