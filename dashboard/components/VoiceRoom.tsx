"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
    Room,
    RoomEvent,
    Track,
    RemoteParticipant,
    RemoteTrackPublication,
    RemoteTrack,
    LocalParticipant,
    ConnectionState,
    DataPacket_Kind,
    ParticipantEvent,
} from "livekit-client";
import {
    Mic,
    MicOff,
    Phone,
    PhoneOff,
    Loader2,
    Bot,
    User,
    Wifi,
    WifiOff,
    Volume2,
    MessageSquare,
    Sparkles,
    AlertCircle,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type CallStatus = "idle" | "connecting" | "connected" | "disconnecting" | "error";

interface TranscriptEntry {
    id: string;
    role: "user" | "agent";
    text: string;
    timestamp: Date;
}

interface VoiceConfig {
    prompt: string;
    modelProvider: "openai" | "groq";
    voice: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CallStatus }) {
    const map: Record<CallStatus, { color: string; label: string; pulse: boolean }> = {
        idle: { color: "bg-gray-500", label: "Ready", pulse: false },
        connecting: { color: "bg-yellow-500", label: "Connecting…", pulse: true },
        connected: { color: "bg-green-500", label: "Live", pulse: true },
        disconnecting: { color: "bg-orange-500", label: "Ending…", pulse: true },
        error: { color: "bg-red-500", label: "Error", pulse: false },
    };
    const { color, label, pulse } = map[status];
    return (
        <span className="flex items-center gap-2 text-sm font-medium text-gray-300">
            <span className="relative flex h-2.5 w-2.5">
                {pulse && (
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-75`} />
                )}
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
            </span>
            {label}
        </span>
    );
}

function AgentSpeakingWave({ speaking }: { speaking: boolean }) {
    if (!speaking) return null;
    return (
        <div className="flex items-end gap-[3px] h-5">
            {[...Array(5)].map((_, i) => (
                <div
                    key={i}
                    className="w-1 bg-blue-400 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.1}s`, height: `${Math.random() * 14 + 6}px` }}
                />
            ))}
        </div>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function VoiceRoom() {
    const [config, setConfig] = useState<VoiceConfig>({
        prompt: "",
        modelProvider: "openai",
        voice: "alloy",
    });

    const [status, setStatus] = useState<CallStatus>("idle");
    const [isEnding, setIsEnding] = useState(false);
    const [error, setError] = useState<string>("");
    const [isMuted, setIsMuted] = useState(false);
    const [agentSpeaking, setAgentSpeaking] = useState(false);
    const [userSpeaking, setUserSpeaking] = useState(false);
    const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
    const [roomName, setRoomName] = useState<string>("");

    const roomRef = useRef<Room | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const transcriptEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll transcript
    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [transcript]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            roomRef.current?.disconnect();
        };
    }, []);

    // ── Attach remote audio track ─────────────────────────────────────────────
    const attachAudio = useCallback((track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;
        const audioEl = track.attach();
        audioEl.autoplay = true;
        audioEl.style.display = "none";
        document.body.appendChild(audioEl);
        audioRef.current = audioEl;
    }, []);

    // ── Parse transcript events from agent data channel ───────────────────────
    const handleData = useCallback((payload: Uint8Array) => {
        try {
            const text = new TextDecoder().decode(payload);
            const msg = JSON.parse(text);

            // LiveKit agents publish transcripts as { type: "transcript", role, text }
            if (msg.type === "transcript" && msg.text?.trim()) {
                setTranscript((prev) => [
                    ...prev,
                    {
                        id: `${Date.now()}-${Math.random()}`,
                        role: msg.role === "assistant" ? "agent" : "user",
                        text: msg.text.trim(),
                        timestamp: new Date(),
                    },
                ]);
            }
        } catch {
            // Non-JSON data packets are ignored
        }
    }, []);

    // ── Connect to LiveKit room ───────────────────────────────────────────────
    const startCall = async () => {
        setError("");
        setStatus("connecting");
        setTranscript([]);

        try {
            // 1. Dispatch agent + create room (no SIP)
            const dispatchRes = await fetch("/api/voip-dispatch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: config.prompt,
                    modelProvider: config.modelProvider,
                    voice: config.voice,
                }),
            });
            const dispatchData = await dispatchRes.json();
            if (!dispatchRes.ok) throw new Error(dispatchData.error || "Dispatch failed");

            const { roomName: rName } = dispatchData;
            setRoomName(rName);

            // 2. Get an access token for this room
            const tokenRes = await fetch("/api/token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    roomName: rName,
                    participantName: `user-${Date.now()}`,
                }),
            });
            const tokenData = await tokenRes.json();
            if (!tokenRes.ok) throw new Error(tokenData.error || "Token fetch failed");

            const { token, url } = tokenData;

            // 3. Connect to LiveKit room via WebRTC
            const room = new Room({
                adaptiveStream: true,          // auto bitrate
                dynacast: true,                // efficient pub
                audioCaptureDefaults: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });
            roomRef.current = room;

            // Room-level events
            room.on(RoomEvent.Connected, () => {
                setStatus("connected");
            });

            room.on(RoomEvent.Disconnected, () => {
                setStatus("idle");
                setAgentSpeaking(false);
                setUserSpeaking(false);
                // Remove injected audio element
                audioRef.current?.remove();
            });

            room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
                if (state === ConnectionState.Reconnecting) setStatus("connecting");
            });

            // Remote track (agent audio)
            room.on(
                RoomEvent.TrackSubscribed,
                (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
                    if (track.kind === Track.Kind.Audio) {
                        attachAudio(track);
                        // Watch agent speaking state
                        participant.on(ParticipantEvent.IsSpeakingChanged, (speaking: boolean) => {
                            setAgentSpeaking(speaking);
                        });
                    }
                }
            );

            // Data channel (transcripts)
            room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
                handleData(payload);
            });

            // Local speaking detection
            room.on(RoomEvent.LocalTrackPublished, () => {
                room.localParticipant.on(ParticipantEvent.IsSpeakingChanged, (speaking: boolean) => {
                    setUserSpeaking(speaking);
                });
            });

            // Connect with mic enabled
            await room.connect(url, token);
            await room.localParticipant.setMicrophoneEnabled(true);

        } catch (err: any) {
            console.error("Call error:", err);
            setError(err.message || "Failed to start call");
            setStatus("error");
            roomRef.current?.disconnect();
            roomRef.current = null;
        }
    };

    // ── Disconnect ────────────────────────────────────────────────────────────
    const endCall = async () => {
        setIsEnding(true);
        setStatus("disconnecting");
        await roomRef.current?.disconnect();
        roomRef.current = null;
        setRoomName("");
        setIsEnding(false);
    };

    // ── Toggle mute ───────────────────────────────────────────────────────────
    const toggleMute = async () => {
        const room = roomRef.current;
        if (!room) return;
        const muted = !isMuted;
        await room.localParticipant.setMicrophoneEnabled(!muted);
        setIsMuted(muted);
    };

    const isActive = status === "connected";
    const isLoading = status === "connecting" || status === "disconnecting";

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="relative group max-w-lg w-full">
            {/* Glow */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-2xl opacity-75 group-hover:opacity-100 transition duration-1000 blur-lg" />

            <div className="relative p-8 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex flex-col gap-6">

                {/* ── Header ─────────────────────────────────────────────── */}
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400">
                            VoIP Voice Chat
                        </h2>
                        <p className="text-xs text-gray-500 mt-0.5">Browser → WebRTC → AI Agent</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <StatusBadge status={status} />
                        {isActive && <AgentSpeakingWave speaking={agentSpeaking} />}
                    </div>
                </div>

                {/* ── Config (only when idle) ─────────────────────────────── */}
                {!isActive && status !== "connecting" && (
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="text-xs text-gray-400 font-medium flex items-center gap-1.5">
                                <MessageSquare className="w-3.5 h-3.5" /> Session Context
                            </label>
                            <textarea
                                placeholder="e.g. You are a friendly school receptionist… (leave blank for default)"
                                value={config.prompt}
                                onChange={(e) => setConfig({ ...config, prompt: e.target.value })}
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-600 outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all resize-none h-20 text-sm"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <label className="text-xs text-gray-400 font-medium">LLM Model</label>
                                <select
                                    value={config.modelProvider}
                                    onChange={(e) => setConfig({ ...config, modelProvider: e.target.value as "openai" | "groq" })}
                                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                                >
                                    <option value="openai">GPT-4o-mini</option>
                                    <option value="groq">Groq Llama 3.3</option>
                                </select>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs text-gray-400 font-medium">Voice</label>
                                <select
                                    value={config.voice}
                                    onChange={(e) => setConfig({ ...config, voice: e.target.value })}
                                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                >
                                    <option value="alloy">Alloy (US)</option>
                                    <option value="echo">Echo (US)</option>
                                    <option value="shimmer">Shimmer (US)</option>
                                    <option value="anushka">Anushka (Indian)</option>
                                    <option value="aravind">Aravind (Indian)</option>
                                </select>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Live session UI ──────────────────────────────────────── */}
                {isActive && (
                    <div className="space-y-4">
                        {/* Speaking indicators */}
                        <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/10">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-full transition-all ${userSpeaking ? "bg-cyan-500/30 ring-2 ring-cyan-500" : "bg-white/5"}`}>
                                    <User className={`w-4 h-4 ${userSpeaking ? "text-cyan-400" : "text-gray-500"}`} />
                                </div>
                                <span className={`text-sm ${userSpeaking ? "text-cyan-400 font-medium" : "text-gray-500"}`}>
                                    {userSpeaking ? "You're speaking…" : "You (silent)"}
                                </span>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className={`text-sm ${agentSpeaking ? "text-blue-400 font-medium" : "text-gray-500"}`}>
                                    {agentSpeaking ? "Agent speaking…" : "Agent (listening)"}
                                </span>
                                <div className={`p-2 rounded-full transition-all ${agentSpeaking ? "bg-blue-500/30 ring-2 ring-blue-500" : "bg-white/5"}`}>
                                    <Bot className={`w-4 h-4 ${agentSpeaking ? "text-blue-400" : "text-gray-500"}`} />
                                </div>
                            </div>
                        </div>

                        {/* Transcript */}
                        <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                            <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10">
                                <MessageSquare className="w-3.5 h-3.5 text-gray-500" />
                                <span className="text-xs text-gray-500 font-medium">Live Transcript</span>
                            </div>
                            <div className="h-52 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                                {transcript.length === 0 && (
                                    <p className="text-center text-gray-600 text-sm mt-8">
                                        Transcript will appear here…
                                    </p>
                                )}
                                {transcript.map((entry) => (
                                    <div
                                        key={entry.id}
                                        className={`flex gap-2 ${entry.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                                    >
                                        <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${entry.role === "agent" ? "bg-blue-500/20" : "bg-cyan-500/20"}`}>
                                            {entry.role === "agent"
                                                ? <Bot className="w-3.5 h-3.5 text-blue-400" />
                                                : <User className="w-3.5 h-3.5 text-cyan-400" />
                                            }
                                        </div>
                                        <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${entry.role === "agent"
                                            ? "bg-blue-500/10 text-blue-100 border border-blue-500/20"
                                            : "bg-cyan-500/10 text-cyan-100 border border-cyan-500/20"
                                            }`}>
                                            {entry.text}
                                        </div>
                                    </div>
                                ))}
                                <div ref={transcriptEndRef} />
                            </div>
                        </div>

                        {/* Room info */}
                        <p className="text-xs text-gray-600 truncate">
                            <Wifi className="inline w-3 h-3 mr-1" />
                            Room: <span className="font-mono">{roomName}</span>
                        </p>
                    </div>
                )}

                {/* ── Error ───────────────────────────────────────────────── */}
                {error && (
                    <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        {error}
                    </div>
                )}

                {/* ── Action Buttons ───────────────────────────────────────── */}
                <div className="flex gap-3">
                    {!isActive ? (
                        <button
                            onClick={startCall}
                            disabled={isLoading}
                            className="flex-1 py-4 px-6 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-xl shadow-lg transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transform hover:-translate-y-0.5"
                        >
                            {isLoading ? (
                                <><Loader2 className="w-5 h-5 animate-spin" /> Connecting…</>
                            ) : (
                                <><Phone className="w-5 h-5" /> Start VoIP Call</>
                            )}
                        </button>
                    ) : (
                        <>
                            {/* Mute toggle */}
                            <button
                                onClick={toggleMute}
                                className={`p-4 rounded-xl border transition-all duration-200 ${isMuted
                                    ? "bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30"
                                    : "bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"
                                    }`}
                                title={isMuted ? "Unmute" : "Mute"}
                            >
                                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                            </button>

                            {/* End call */}
                            <button
                                onClick={endCall}
                                disabled={isEnding}
                                className="flex-1 py-4 px-6 bg-gradient-to-r from-red-700 to-red-600 hover:from-red-600 hover:to-red-500 text-white font-bold rounded-xl shadow-lg transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {isEnding ? (
                                    <><Loader2 className="w-5 h-5 animate-spin" /> Ending…</>
                                ) : (
                                    <><PhoneOff className="w-5 h-5" /> End Call</>
                                )}
                            </button>
                        </>
                    )}
                </div>

                {/* ── Info footer ─────────────────────────────────────────── */}
                <p className="text-xs text-gray-600 text-center">
                    <Sparkles className="inline w-3 h-3 mr-1" />
                    Direct WebRTC · No SIP Trunk · ~100–200ms latency
                </p>
            </div>
        </div>
    );
}
