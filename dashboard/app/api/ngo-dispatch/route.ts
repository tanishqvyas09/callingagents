/**
 * POST /api/ngo-dispatch
 *
 * Creates a LiveKit room with NGO metadata, dispatches the "ngo-caller" agent,
 * and (if phone_number provided) the agent itself will initiate the SIP call.
 *
 * Body:
 *   { phone_number: string; participant_name?: string; notes?: string }
 *
 * Returns:
 *   { room_name, ws_url, token, job_id? }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
} from "livekit-server-sdk";

const LK_URL    = process.env.LIVEKIT_URL!;
const LK_KEY    = process.env.LIVEKIT_API_KEY!;
const LK_SECRET = process.env.LIVEKIT_API_SECRET!;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phone_number, participant_name, notes } = body as {
      phone_number?: string;
      participant_name?: string;
      notes?: string;
    };

    // ── 1. Create a unique room ────────────────────────────────────────────
    const roomName = `ngo-${Date.now()}`;
    const roomSvc  = new RoomServiceClient(LK_URL, LK_KEY, LK_SECRET);

    const roomMeta = JSON.stringify({
      phone_number:     phone_number || null,
      participant_name: participant_name || "student",
      notes:            notes || "",
      ngo:              "Making the Difference",
      team:             "Team Lajja",
      agent:            "ngo-caller",
      created_at:       new Date().toISOString(),
    });

    await roomSvc.createRoom({
      name:     roomName,
      metadata: roomMeta,
      emptyTimeout: 300,   // seconds before LiveKit auto-cleans empty room
      maxParticipants: 5,
    });

    // ── 2. Dispatch the ngo-caller agent ───────────────────────────────────
    const dispatchClient = new AgentDispatchClient(LK_URL, LK_KEY, LK_SECRET);
    let jobId: string | undefined;

    try {
      const dispatch = await dispatchClient.createDispatch(roomName, "ngo-caller", {
        metadata: roomMeta,
      });
      jobId = dispatch.id;
    } catch (e) {
      // Non-fatal — agent may still connect if running in "auto" mode
      console.warn("[ngo-dispatch] AgentDispatch failed (agent may auto-join):", e);
    }

    // ── 3. Generate a viewer token for the dashboard ───────────────────────
    const identity = `dashboard-${Date.now()}`;
    const token    = new AccessToken(LK_KEY, LK_SECRET, { identity });

    token.addGrant({
      roomJoin:          true,
      room:              roomName,
      canPublish:        false,
      canSubscribe:      true,
      canPublishData:    true,   // receive data channel events
      roomAdmin:         false,
    });

    const jwt = await token.toJwt();

    return NextResponse.json({
      room_name: roomName,
      ws_url:    LK_URL,
      token:     jwt,
      job_id:    jobId,
      phone_number: phone_number || null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ngo-dispatch] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
