/**
 * GET /api/vobiz-recordings
 *
 * Server-side proxy to the Vobiz Recording API.
 * Hides VOBIZ_AUTH_ID / VOBIZ_AUTH_TOKEN from the browser.
 *
 * Query params (all optional):
 *   limit        – number of records to return (default 20, max 100)
 *   offset       – pagination offset (default 0)
 *   call_uuid    – filter by a specific Vobiz call UUID
 *   to_number    – filter by destination phone number (digits only, e.g. 919876543210)
 *   recording_type – "trunk" | "call" | "conference" — default "trunk" (SIP trunks use "trunk")
 *
 * Returns Vobiz API response as-is (objects[] + meta).
 */

import { NextRequest, NextResponse } from "next/server";

const VOBIZ_BASE = "https://api.vobiz.ai/api/v1";
const AUTH_ID    = process.env.VOBIZ_AUTH_ID!;
const AUTH_TOKEN = process.env.VOBIZ_AUTH_TOKEN!;

export async function GET(req: NextRequest) {
  if (!AUTH_ID || !AUTH_TOKEN) {
    return NextResponse.json(
      { error: "VOBIZ_AUTH_ID / VOBIZ_AUTH_TOKEN not configured in .env.local" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(req.url);

  // Build Vobiz query string – pass through supported params only
  const vobizParams = new URLSearchParams();
  const limit  = searchParams.get("limit")  ?? "20";
  const offset = searchParams.get("offset") ?? "0";
  vobizParams.set("limit",  limit);
  vobizParams.set("offset", offset);

  const callUuid      = searchParams.get("call_uuid");
  const toNumber      = searchParams.get("to_number");
  // SIP trunk recordings have recording_type="trunk", NOT "call"
  // Only add the filter if explicitly requested — omitting it returns all types
  const recordingType = searchParams.get("recording_type");

  if (callUuid)      vobizParams.set("call_uuid",      callUuid);
  if (toNumber)      vobizParams.set("to_number",      toNumber);
  if (recordingType) vobizParams.set("recording_type", recordingType);

  const url = `${VOBIZ_BASE}/Account/${AUTH_ID}/Recording/?${vobizParams.toString()}`;

  try {
    const res = await fetch(url, {
      headers: {
        "X-Auth-ID":     AUTH_ID,
        "X-Auth-Token":  AUTH_TOKEN,
        "Content-Type":  "application/json",
        "Accept":        "application/json",
      },
      // Don't cache — recordings list changes after every call
      cache: "no-store",
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("[vobiz-recordings] Vobiz API error:", res.status, data);
      return NextResponse.json(
        { error: data?.error ?? "Vobiz API error", status: res.status },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[vobiz-recordings] fetch error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
