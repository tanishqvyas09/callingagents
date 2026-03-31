/* ─── Shared types for the NGO Dashboard ──────────────────────────────────── */

// ── Call status for auto-dialer tracking ──────────────────────────────────────
export type CallStatus =
  | "pending"       // not yet called
  | "calling"       // currently being called
  | "completed"     // call finished successfully
  | "partial"       // partial survey
  | "call_later"    // student said call later
  | "failed"        // call failed (unreachable, etc.)
  | "hung_up_early" // student hung up early
  | "unavailable";  // student unavailable

// ── Student from student_answer_sheets (post campaign) ───────────────────────
export interface CampaignStudent {
  id: string;
  student_name: string;
  student_name_english: string | null;
  contact_number: string | null;
  age: number | null;
  school_id: string | null;
  school_name: string | null;  // from join with campaign_schools
  campaign_type: string | null;
  percentage: number | null;
  grade: string | null;
  date: string | null;
  project_id: string | null;
  // Derived / enriched
  contact_e164: string | null;
  school_city: string | null;
  school_state: string | null;
  // Call tracking
  call_status: CallStatus;
  last_call_at: string | null;
}

// ── Call result row from ngo_call_results ─────────────────────────────────────
export interface CallResult {
  id: string;
  room_name: string | null;
  phone_number: string | null;
  call_started_at: string | null;
  call_ended_at: string | null;
  call_duration_seconds: number | null;
  call_outcome: string | null;
  total_turns: number | null;
  detected_language: string | null;
  analyzed_at: string;
  student_name: string | null;
  student_age: number | null;
  school_name: string | null;
  school_city: string | null;
  transcript: unknown;
  summary: string | null;
  sentiment_overall: number | null;
  sentiment_engagement: number | null;
  sentiment_comfort: number | null;
  sentiment_awareness_gain: number | null;
  sentiment_product_adoption: number | null;
  sentiment_positivity: number | null;
  sentiment_reasoning: unknown;
  q1_previous_product: string | null;
  q2_received_book: string | null;
  q3_shared_knowledge: string | null;
  q4_using_kit: string | null;
  q5_cloth_pad_comfort: string | null;
  q6_will_continue: string | null;
  q7_barrier: string | null;
  q8_session_rating: string | null;
  key_insights: unknown;
  recording_url: string | null;
}

// ── Dashboard stats ──────────────────────────────────────────────────────────
export interface DashboardStats {
  // Campaign
  totalStudents: number;
  studentsWithPhone: number;
  // Calls
  totalCalls: number;
  completedCalls: number;
  partialCalls: number;
  failedCalls: number;
  hungUpEarlyCalls: number;
  // Progress
  studentsProcessed: number;       // unique phone numbers in ngo_call_results
  studentsRemaining: number;
  progressPercent: number;
  // Averages
  avgSentiment: number;
  avgDuration: number;
  avgTurns: number;
  // Outcomes distribution
  outcomeDistribution: { name: string; value: number; color: string }[];
  // Sentiment averages per factor
  sentimentFactors: { factor: string; avg: number; max: number }[];
  // Question stats
  questionStats: { question: string; key: string; answers: { answer: string; count: number }[] }[];
  // School breakdown
  schoolBreakdown: { school: string; total: number; called: number; avgSentiment: number }[];
  // Daily progress
  dailyProgress: { date: string; calls: number; completed: number }[];
  // Language distribution
  languageDistribution: { language: string; count: number }[];
  // Barrier analysis
  barrierAnalysis: { barrier: string; count: number }[];
}

// ── Campaign state (in-memory on server) ─────────────────────────────────────
export interface CampaignState {
  running: boolean;
  currentStudentId: string | null;
  currentStudentName: string | null;
  currentPhoneNumber: string | null;
  currentRoomName: string | null;
  totalInQueue: number;
  processedCount: number;
  startedAt: string | null;
  stoppedAt: string | null;
  stopRequested: boolean;         // stop after current call
}
