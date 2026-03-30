"use client";

/**
 * RecordingsPanel
 *
 * Fetches call recordings from Vobiz via /api/vobiz-recordings and renders:
 *   • Filter bar (phone number search, date range, pagination)
 *   • Recording cards with inline HTML5 audio player
 *   • CDR metadata: duration, from/to, timestamp, format
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types (mirrors Vobiz recording object) ───────────────────────────────────
interface VobizRecording {
  recording_id:                  string;
  recording_url:                 string;
  recording_format:              string;       // "mp3" | "wav"
  recording_type:                string;       // "call" | "conference"
  call_uuid:                     string;
  conference_name:               string | null;
  from_number:                   string;
  to_number:                     string;
  add_time:                      string;       // ISO timestamp
  recording_duration_ms:         string;       // float string
  recording_start_ms:            string;       // float string
  recording_end_ms:              string;       // float string
  rounded_recording_duration:    number;       // seconds (billing)
  recording_storage_duration:    number;
  recording_storage_rate:        number;
  monthly_recording_storage_amount: number;
  resource_uri:                  string;
}

interface VobizMeta {
  limit:       number;
  offset:      number;
  total_count: number;
  next:        string | null;
  previous:    string | null;
}

interface VobizResponse {
  objects: VobizRecording[];
  meta:    VobizMeta;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDuration(ms: string | number): string {
  const totalSeconds = Math.round(Number(ms) / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day:    "2-digit",
      month:  "short",
      year:   "numeric",
      hour:   "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatPhone(raw: string): string {
  if (!raw) return "—";
  // Ensure E.164 display
  const cleaned = raw.replace(/\D/g, "");
  return cleaned.startsWith("91") && cleaned.length === 12
    ? `+${cleaned}`
    : `+${cleaned}`;
}

// ─── Single recording card ────────────────────────────────────────────────────
function RecordingCard({ rec }: { rec: VobizRecording }) {
  const audioRef          = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying]         = useState(false);
  const [progress, setProgress]       = useState(0);   // 0-100
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration]       = useState(0);
  const [loadError, setLoadError]     = useState(false);

  // Always route audio through our server-side proxy so auth headers are added.
  // media.vobiz.ai returns 401 when the browser requests the URL directly.
  const proxyUrl = `/api/vobiz-audio?recording_id=${encodeURIComponent(rec.recording_id)}&format=${rec.recording_format}`;

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play().catch(() => setLoadError(true));
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0);
  };

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (audio) setDuration(audio.duration);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  };

  function fmtSec(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  const durationSec = Math.round(Number(rec.recording_duration_ms) / 1000);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3 hover:border-slate-600 transition-colors">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sky-400 text-sm font-semibold truncate">
              {formatPhone(rec.to_number)}
            </span>
            <span className="text-slate-600 text-xs">←</span>
            <span className="font-mono text-slate-400 text-xs truncate">
              {formatPhone(rec.from_number)}
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">{formatDate(rec.add_time)}</div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <span className={`px-2 py-0.5 rounded-full text-xs font-mono uppercase ${
              rec.recording_type === "trunk"
                ? "bg-violet-900 text-violet-300"
                : "bg-slate-700 text-slate-300"
            }`}>
              {rec.recording_type}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 text-xs font-mono uppercase">
              {rec.recording_format}
            </span>
          </div>
          <span className="text-xs text-slate-400 font-mono">{formatDuration(rec.recording_duration_ms)}</span>
        </div>
      </div>

      {/* Audio player */}
      {loadError ? (
        <div className="text-xs text-red-400 bg-red-950 border border-red-800 rounded-lg px-3 py-2">
          ⚠ Could not load audio. The recording may still be processing.{" "}
          <button
            onClick={() => setLoadError(false)}
            className="underline hover:text-red-200"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Progress bar */}
          <div
            className="w-full h-2 bg-slate-700 rounded-full cursor-pointer group"
            onClick={handleSeek}
          >
            <div
              className="h-full bg-sky-500 rounded-full transition-all group-hover:bg-sky-400"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-3">
            <button
              onClick={toggle}
              className="w-8 h-8 flex-shrink-0 rounded-full bg-sky-600 hover:bg-sky-500 flex items-center justify-center text-white transition-colors"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                // Pause icon
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                  <rect x="6" y="5" width="4" height="14" rx="1"/>
                  <rect x="14" y="5" width="4" height="14" rx="1"/>
                </svg>
              ) : (
                // Play icon
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                  <path d="M8 5.14v14l11-7-11-7z"/>
                </svg>
              )}
            </button>

            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {fmtSec(currentTime)} / {duration ? fmtSec(duration) : fmtSec(durationSec)}
            </span>

            <div className="flex-1" />

            {/* Download link — proxied so auth headers are injected */}
            <a
              href={proxyUrl}
              download={`${rec.recording_id}.${rec.recording_format}`}
              className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
              title="Download recording"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                <path d="M12 16l-6-6h4V4h4v6h4l-6 6zm-8 4h16v-2H4v2z"/>
              </svg>
              Download
            </a>
          </div>

          {/* Hidden HTML5 audio element — uses proxy URL, supports Range for seeking */}
          <audio
            ref={audioRef}
            src={proxyUrl}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => { setPlaying(false); setProgress(0); setCurrentTime(0); }}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onError={() => setLoadError(true)}
            preload="metadata"
          />
        </div>
      )}

      {/* Call UUID */}
      <div className="text-xs text-slate-600 font-mono truncate" title={rec.call_uuid}>
        UUID: {rec.call_uuid}
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────
interface RecordingsPanelProps {
  /** If provided, pre-filters recordings by this number (E.164 stripped of +) */
  defaultToNumber?: string | null;
}

const PAGE_SIZE = 10;

export default function RecordingsPanel({ defaultToNumber }: RecordingsPanelProps) {
  const [toNumber, setToNumber]       = useState(
    defaultToNumber ? defaultToNumber.replace(/^\+/, "") : ""
  );
  const [inputVal, setInputVal]       = useState(toNumber);
  const [limit]                       = useState(PAGE_SIZE);
  const [offset, setOffset]           = useState(0);

  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [data, setData]               = useState<VobizResponse | null>(null);

  const fetchRecordings = useCallback(async (toNum: string, off: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit:  String(limit),
        offset: String(off),
        // Do NOT pass recording_type — Vobiz SIP trunks use "trunk", not "call"
        // Omitting it returns all recordings regardless of type
      });
      if (toNum.trim()) {
        // Strip leading + so Vobiz can match both "+918989528422" and "8989528422"
        params.set("to_number", toNum.trim().replace(/^\+/, ""));
      }

      const res = await fetch(`/api/vobiz-recordings?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to fetch recordings");
      setData(json as VobizResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  // Fetch on mount and whenever filter/page changes
  useEffect(() => {
    fetchRecordings(toNumber, offset);
  }, [fetchRecordings, toNumber, offset]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0);
    setToNumber(inputVal);
  };

  const total      = data?.meta?.total_count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const recordings  = data?.objects ?? [];

  return (
    <div className="flex flex-col h-full gap-4">

      {/* ── Filter bar ── */}
      <form onSubmit={handleSearch} className="flex items-center gap-2">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-mono">+</span>
          <input
            type="text"
            placeholder="Filter by phone number (e.g. 919876543210)"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-6 pr-3 py-2 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
          />
          {inputVal && (
            <button
              type="button"
              onClick={() => { setInputVal(""); setOffset(0); setToNumber(""); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-sm"
            >
              ✕
            </button>
          )}
        </div>
        <button
          type="submit"
          className="px-4 py-2 bg-sky-700 hover:bg-sky-600 text-white text-sm rounded-lg transition-colors font-medium"
        >
          Search
        </button>
        <button
          type="button"
          onClick={() => fetchRecordings(toNumber, offset)}
          className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg transition-colors"
          title="Refresh"
        >
          ↺
        </button>
      </form>

      {/* ── Status row ── */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {loading
            ? "Loading recordings…"
            : error
            ? ""
            : total > 0
            ? `${total} recording${total !== 1 ? "s" : ""}${toNumber ? ` for +${toNumber}` : ""}`
            : "No recordings found"}
        </span>
        {total > PAGE_SIZE && !loading && (
          <span>
            Page {currentPage} / {totalPages}
          </span>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-sm text-red-300">
          ⚠ {error}
          {error.includes("VOBIZ_AUTH") && (
            <p className="text-xs text-red-400 mt-1">
              Set <span className="font-mono">VOBIZ_AUTH_ID</span> and{" "}
              <span className="font-mono">VOBIZ_AUTH_TOKEN</span> in{" "}
              <span className="font-mono">dashboard/.env.local</span>
            </p>
          )}
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && (
        <div className="space-y-3 flex-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-28 bg-slate-800 border border-slate-700 rounded-xl animate-pulse"
            />
          ))}
        </div>
      )}

      {/* ── Recording list ── */}
      {!loading && recordings.length > 0 && (
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {recordings.map((rec) => (
            <RecordingCard key={rec.recording_id} rec={rec} />
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && !error && recordings.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
          <div className="text-3xl">🎙</div>
          <p className="text-slate-500 text-sm max-w-xs">
            {toNumber
              ? `No recordings found for +${toNumber}`
              : "No call recordings yet. Recordings appear here after calls complete."}
          </p>
          {toNumber && (
            <button
              onClick={() => { setInputVal(""); setToNumber(""); setOffset(0); }}
              className="text-xs text-sky-400 hover:text-sky-300 underline"
            >
              Clear filter → show all recordings
            </button>
          )}
        </div>
      )}

      {/* ── Pagination ── */}
      {!loading && total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800 flex-shrink-0">
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-xs rounded-lg transition-colors"
          >
            ← Prev
          </button>
          <span className="text-xs text-slate-500 font-mono">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <button
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-xs rounded-lg transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
