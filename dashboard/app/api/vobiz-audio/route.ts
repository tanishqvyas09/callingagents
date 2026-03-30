/**
 * GET /api/vobiz-audio?recording_id=<id>&format=<mp3|wav>
 *
 * Proxies the authenticated Vobiz media stream to the browser.
 * Required because media.vobiz.ai requires X-Auth-ID / X-Auth-Token headers
 * which the browser <audio> element cannot send directly.
 *
 * Supports HTTP Range requests so the browser scrub-bar works correctly.
 */

import { NextRequest, NextResponse } from "next/server";

const AUTH_ID    = process.env.VOBIZ_AUTH_ID!;
const AUTH_TOKEN = process.env.VOBIZ_AUTH_TOKEN!;

export async function GET(req: NextRequest) {
  if (!AUTH_ID || !AUTH_TOKEN) {
    return NextResponse.json(
      { error: "VOBIZ credentials not configured" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(req.url);
  const recordingId = searchParams.get("recording_id");
  const format      = searchParams.get("format") ?? "wav";

  if (!recordingId) {
    return NextResponse.json({ error: "recording_id required" }, { status: 400 });
  }

  const mediaUrl = `https://media.vobiz.ai/v1/Account/${AUTH_ID}/Recording/${recordingId}.${format}`;

  // Forward Range header so browser can seek inside the audio file
  const rangeHeader = req.headers.get("range");
  const upstreamHeaders: HeadersInit = {
    "X-Auth-ID":    AUTH_ID,
    "X-Auth-Token": AUTH_TOKEN,
  };
  if (rangeHeader) {
    (upstreamHeaders as Record<string, string>)["Range"] = rangeHeader;
  }

  try {
    const upstream = await fetch(mediaUrl, {
      headers: upstreamHeaders,
      cache: "no-store",
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error("[vobiz-audio] upstream error:", upstream.status, text);
      return NextResponse.json(
        { error: `Vobiz media error ${upstream.status}` },
        { status: upstream.status }
      );
    }

    // Stream the audio body back to the browser, preserving content headers
    const contentType   = upstream.headers.get("content-type")   ?? `audio/${format}`;
    const contentLength = upstream.headers.get("content-length");
    const contentRange  = upstream.headers.get("content-range");
    const acceptRanges  = upstream.headers.get("accept-ranges")  ?? "bytes";

    const responseHeaders: Record<string, string> = {
      "Content-Type":  contentType,
      "Accept-Ranges": acceptRanges,
      "Cache-Control": "private, max-age=3600",
    };
    if (contentLength) responseHeaders["Content-Length"] = contentLength;
    if (contentRange)  responseHeaders["Content-Range"]  = contentRange;

    return new NextResponse(upstream.body, {
      status:  upstream.status, // 200 or 206 (partial content for range requests)
      headers: responseHeaders,
    });
  } catch (err) {
    console.error("[vobiz-audio] fetch error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
