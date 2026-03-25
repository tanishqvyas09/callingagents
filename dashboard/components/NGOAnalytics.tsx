"use client";

/**
 * NGOAnalytics
 *
 * Connects to a LiveKit room as a passive observer and listens on the
 * "ngo-analytics" data channel topic for events emitted by ngo_agent.py.
 *
 * Event types:
 *   session_start | stt_start | stt | user_turn | tts_start | tts_done | call_answered | call_failed
 *
 * Displays a millisecond-level live feed of:
 *   • User transcript + detected language
 *   • LLM response text
 *   • TTS language / speaker / model
 *   • Per-turn latencies: STT, LLM (TTFA), E2E
 *   • Language switches highlighted
 *   • Connection state chip
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Room,
  RoomEvent,
  DataPacket_Kind,
  ConnectionState,
  Participant,
} from "livekit-client";

// ─── Types ────────────────────────────────────────────────────────────────────
interface AnalyticsEvent {
  type: string;
  ts_ms: number;
  [key: string]: unknown;
}

interface TurnRecord {
  id: number;
  ts_ms: number;
  user_text: string;
  user_lang: string;
  user_lang_raw: string;
  lang_switched: boolean;
  stt_latency_ms: number;
  confidence: number;
  llm_text: string;
  tts_language: string;
  tts_speaker: string;
  tts_model: string;
  llm_latency_ms: number;
  tts_ttfa_ms: number;
  e2e_latency_ms: number;
}

interface SessionInfo {
  phone_number: string;
  ngo: string;
  team: string;
  stt_model: string;
  llm_model: string;
  tts_model: string;
  tts_speaker: string;
  default_language: string;
}

interface Props {
  wsUrl: string;
  token: string;
  roomName: string;
}

// ─── Language badge colours ───────────────────────────────────────────────────
const LANG_COLOUR: Record<string, string> = {
  "hi-IN": "bg-orange-100 text-orange-800 border-orange-300",
  "en-IN": "bg-blue-100  text-blue-800  border-blue-300",
  "te-IN": "bg-green-100 text-green-800 border-green-300",
};
function langBadge(lang: string) {
  return LANG_COLOUR[lang] ?? "bg-gray-100 text-gray-800 border-gray-300";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ms(n: number | undefined) {
  if (n === undefined || n === 0) return "—";
  return `${n} ms`;
}
function timeLabel(ts: number) {
  return new Date(ts).toLocaleTimeString("en-IN", { hour12: false, fractionalSecondDigits: 3 });
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function NGOAnalytics({ wsUrl, token, roomName }: Props) {
  const roomRef   = useRef<Room | null>(null);
  const [connState,   setConnState]   = useState<string>("idle");
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [turns,       setTurns]       = useState<TurnRecord[]>([]);
  const [rawEvents,   setRawEvents]   = useState<AnalyticsEvent[]>([]);
  const [callStatus,  setCallStatus]  = useState<string>("waiting");
  const pendingTurn   = useRef<Partial<TurnRecord>>({});
  const turnCounter   = useRef(0);
  const feedRef       = useRef<HTMLDivElement>(null);

  // ── Scroll latest into view ────────────────────────────────────────────────
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  // ── Event handler ──────────────────────────────────────────────────────────
  const handleEvent = useCallback((ev: AnalyticsEvent) => {
    setRawEvents(prev => [ev, ...prev].slice(0, 200));

    switch (ev.type) {
      case "session_start":
        setSessionInfo(ev as unknown as SessionInfo);
        setCallStatus("connecting");
        break;

      case "call_answered":
        setCallStatus("in-call");
        break;

      case "call_failed":
        setCallStatus("failed");
        break;

      case "stt_start":
        pendingTurn.current = {
          ts_ms: ev.ts_ms,
        };
        break;

      case "stt": {
        // Merge STT fields into pending turn
        pendingTurn.current = {
          ...pendingTurn.current,
          user_text:       String(ev.transcript  ?? ""),
          user_lang:       String(ev.language_resolved ?? ""),
          user_lang_raw:   String(ev.language_raw      ?? ""),
          lang_switched:   Boolean(ev.lang_switched),
          stt_latency_ms:  Number(ev.stt_latency_ms  ?? 0),
          confidence:      Number(ev.confidence       ?? 0),
        };
        break;
      }

      case "tts_done": {
        // Finalise the turn record
        const t: TurnRecord = {
          id:            ++turnCounter.current,
          ts_ms:         pendingTurn.current.ts_ms ?? ev.ts_ms,
          user_text:     pendingTurn.current.user_text     ?? "",
          user_lang:     pendingTurn.current.user_lang     ?? "",
          user_lang_raw: pendingTurn.current.user_lang_raw ?? "",
          lang_switched: pendingTurn.current.lang_switched ?? false,
          stt_latency_ms:pendingTurn.current.stt_latency_ms ?? 0,
          confidence:    pendingTurn.current.confidence     ?? 0,
          llm_text:      String(ev.llm_response_text ?? ""),
          tts_language:  String(ev.tts_language ?? ""),
          tts_speaker:   String(ev.tts_speaker   ?? ""),
          tts_model:     String(ev.tts_model     ?? ""),
          llm_latency_ms: pendingTurn.current.llm_latency_ms  ?? 0,
          tts_ttfa_ms:    pendingTurn.current.tts_ttfa_ms     ?? 0,
          e2e_latency_ms: pendingTurn.current.e2e_latency_ms  ?? 0,
        };
        setTurns(prev => [...prev, t]);
        pendingTurn.current = {};
        break;
      }

      case "tts_start": {
        // Capture latency fields as soon as first audio frame fires
        pendingTurn.current = {
          ...pendingTurn.current,
          llm_text:       String(ev.llm_response_text ?? ""),
          tts_language:   String(ev.tts_language ?? ""),
          tts_speaker:    String(ev.tts_speaker   ?? ""),
          tts_model:      String(ev.tts_model     ?? ""),
          llm_latency_ms: Number(ev.llm_latency_ms ?? 0),
          tts_ttfa_ms:    Number(ev.tts_ttfa_ms   ?? 0),
          e2e_latency_ms: Number(ev.e2e_latency_ms ?? 0),
        };
        break;
      }
    }
  }, []);

  // ── LiveKit room connection ────────────────────────────────────────────────
  useEffect(() => {
    if (!wsUrl || !token) return;

    const room = new Room();
    roomRef.current = room;

    room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      setConnState(state);
    });

    room.on(
      RoomEvent.DataReceived,
      (payload: Uint8Array, participant?: Participant, _kind?: DataPacket_Kind, topic?: string) => {
        if (topic !== "ngo-analytics") return;
        try {
          const ev: AnalyticsEvent = JSON.parse(new TextDecoder().decode(payload));
          handleEvent(ev);
        } catch (e) {
          console.warn("[NGOAnalytics] parse error", e);
        }
      }
    );

    room.connect(wsUrl, token).catch(console.error);

    return () => {
      room.disconnect();
    };
  }, [wsUrl, token, handleEvent]);

  // ─── Render ──────────────────────────────────────────────────────────────
  const connDot = connState === "connected"
    ? "bg-green-500" : connState === "connecting"
    ? "bg-yellow-400 animate-pulse" : "bg-gray-400";

  const statusColour: Record<string, string> = {
    waiting:    "text-gray-500",
    connecting: "text-yellow-600",
    "in-call":  "text-green-600",
    failed:     "text-red-600",
  };

  return (
    <div className="flex flex-col gap-4 h-full">

      {/* ── Header ── */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-rose-50 border border-rose-200">
        <div>
          <h2 className="font-bold text-rose-700 text-lg">
            🌸 Team Lajja — Live Analytics
          </h2>
          <p className="text-xs text-rose-500">
            Room: <span className="font-mono">{roomName}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${connDot}`} />
            <span className="text-gray-600 capitalize">{connState}</span>
          </div>
          <span className={`text-xs font-semibold ${statusColour[callStatus] ?? "text-gray-500"}`}>
            Call: {callStatus}
          </span>
        </div>
      </div>

      {/* ── Session Info ── */}
      {sessionInfo && (
        <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-purple-50 border border-purple-200 text-xs">
          <div><span className="font-semibold text-purple-700">Phone:</span> {sessionInfo.phone_number}</div>
          <div><span className="font-semibold text-purple-700">LLM:</span> {sessionInfo.llm_model}</div>
          <div><span className="font-semibold text-purple-700">STT:</span> {sessionInfo.stt_model}</div>
          <div><span className="font-semibold text-purple-700">TTS:</span> {sessionInfo.tts_model} / {sessionInfo.tts_speaker}</div>
          <div className="col-span-2"><span className="font-semibold text-purple-700">Default lang:</span> {sessionInfo.default_language}</div>
        </div>
      )}

      {/* ── Turn Feed ── */}
      <div
        ref={feedRef}
        className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1"
        style={{ minHeight: 0 }}
      >
        {turns.length === 0 && (
          <p className="text-center text-gray-400 text-sm mt-8">
            Waiting for conversation…
          </p>
        )}

        {turns.map(t => (
          <div
            key={t.id}
            className={`rounded-xl border p-3 text-sm shadow-sm transition-all ${
              t.lang_switched ? "border-amber-400 bg-amber-50" : "border-gray-200 bg-white"
            }`}
          >
            {/* Turn header */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-gray-400 text-xs font-mono">{timeLabel(t.ts_ms)}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs border font-medium ${langBadge(t.user_lang)}`}>
                {t.user_lang || "?"}
              </span>
              {t.lang_switched && (
                <span className="px-2 py-0.5 rounded-full text-xs bg-amber-200 text-amber-800 border border-amber-400 font-bold">
                  ⚡ lang switch
                </span>
              )}
              <span className="text-gray-400 text-xs ml-auto">
                conf: {(t.confidence * 100).toFixed(0)}%
              </span>
            </div>

            {/* User speech */}
            <div className="mb-2">
              <div className="text-xs text-gray-400 mb-0.5 font-semibold uppercase tracking-wide">Student</div>
              <div className="text-gray-800">{t.user_text || <em className="text-gray-400">—</em>}</div>
            </div>

            {/* Agent response */}
            <div className="mb-2">
              <div className="text-xs text-rose-400 mb-0.5 font-semibold uppercase tracking-wide">Agent (Lajja)</div>
              <div className="text-gray-700 italic">{t.llm_text || <em className="text-gray-400">—</em>}</div>
            </div>

            {/* Latency strip */}
            <div className="flex flex-wrap gap-3 mt-2 pt-2 border-t border-gray-100 text-xs">
              <LatencyChip label="STT" value={ms(t.stt_latency_ms)} colour="blue" />
              <LatencyChip label="LLM" value={ms(t.llm_latency_ms)} colour="violet" />
              <LatencyChip label="TTFA" value={ms(t.tts_ttfa_ms)} colour="green" />
              <LatencyChip label="E2E" value={ms(t.e2e_latency_ms)} colour="rose" bold />
              <span className="ml-auto text-gray-400">
                TTS: {t.tts_language} / {t.tts_speaker} / {t.tts_model}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Raw Event Log ── */}
      <details className="text-xs">
        <summary className="cursor-pointer text-gray-500 hover:text-gray-700 select-none">
          Raw event log ({rawEvents.length})
        </summary>
        <div className="mt-1 max-h-40 overflow-y-auto bg-gray-900 text-green-300 rounded-lg p-2 font-mono">
          {rawEvents.slice(0, 50).map((e, i) => (
            <div key={i} className="border-b border-gray-700 py-0.5">
              <span className="text-gray-500">{timeLabel(e.ts_ms)} </span>
              <span className="text-yellow-300">{e.type} </span>
              {JSON.stringify(e, null, 0).slice(0, 120)}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

// ── Small latency chip ────────────────────────────────────────────────────────
function LatencyChip({
  label, value, colour, bold,
}: {
  label: string; value: string; colour: string; bold?: boolean;
}) {
  const cols: Record<string, string> = {
    blue:   "bg-blue-50   text-blue-700   border-blue-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
    green:  "bg-green-50  text-green-700  border-green-200",
    rose:   "bg-rose-50   text-rose-700   border-rose-200",
  };
  return (
    <span className={`px-2 py-0.5 rounded border ${cols[colour]} ${bold ? "font-bold" : ""}`}>
      {label}: {value}
    </span>
  );
}
