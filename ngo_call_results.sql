-- ============================================================
--  NGO Call Results Table
--  Team Lajja — Making the Difference NGO
--
--  Run this in your Supabase SQL editor (Dashboard → SQL Editor → New query)
--
--  Stores every completed/analysed call with:
--    • Call metadata      (room, phone, timestamp, duration, outcome, language)
--    • Student details    (name, age, school, city, state — from campaign_results)
--    • Full transcript    (JSONB array of {role, text, lang, ts_ms} turns)
--    • AI summary         (2-line plain-text summary)
--    • Sentiment analysis (overall score + 5 factor scores + LLM reasoning)
--    • Survey Q&A         (all 8 questions individually mapped)
--    • Key insights       (array of AI-generated insight strings)
-- ============================================================

create table if not exists public.ngo_call_results (

  -- ── Primary key ──────────────────────────────────────────────────────────
  id                      uuid primary key default gen_random_uuid(),

  -- ── Call metadata ─────────────────────────────────────────────────────────
  room_name               text,                        -- LiveKit room name
  phone_number            text,                        -- E.164 format e.g. +919876543210
  call_started_at         timestamptz,                 -- first turn timestamp (from transcript)
  call_ended_at           timestamptz,                 -- last turn timestamp (from transcript)
  call_duration_seconds   integer,                     -- derived: ended - started
  call_outcome            text check (call_outcome in (
                            'completed', 'partial', 'unavailable', 'hung_up_early'
                          )),
  total_turns             integer,                     -- number of student turns
  detected_language       text,                        -- e.g. hi-IN, en-IN, te-IN
  analyzed_at             timestamptz not null default now(),

  -- ── Student details ────────────────────────────────────────────────────────
  student_name            text,
  student_age             integer,
  school_name             text,
  school_city             text,

  -- ── Full transcript ────────────────────────────────────────────────────────
  -- Array of {role: "user"|"agent", text: string, lang: string, ts_ms: number}
  transcript              jsonb not null default '[]'::jsonb,

  -- ── AI-generated summary ──────────────────────────────────────────────────
  summary                 text,

  -- ── Sentiment — overall score (0–100 = sum of 5 factors) ─────────────────
  sentiment_overall       integer check (sentiment_overall between 0 and 100),

  -- ── Sentiment — 5 individual factor scores (0–20 each) ───────────────────
  sentiment_engagement        integer check (sentiment_engagement    between 0 and 20),
  sentiment_comfort           integer check (sentiment_comfort       between 0 and 20),
  sentiment_awareness_gain    integer check (sentiment_awareness_gain between 0 and 20),
  sentiment_product_adoption  integer check (sentiment_product_adoption between 0 and 20),
  sentiment_positivity        integer check (sentiment_positivity    between 0 and 20),

  -- ── Sentiment — LLM reasoning (one sentence per factor) ──────────────────
  sentiment_reasoning     jsonb,  -- {engagement, comfort, awareness_gain, product_adoption, positivity}

  -- ── Survey questionnaire answers ──────────────────────────────────────────
  q1_previous_product     text,   -- What did she use before the session?
  q2_received_book        text,   -- Did she receive & read the book? (yes/no/partial)
  q3_shared_knowledge     text,   -- Did she share with family/friends? (yes/no/partial)
  q4_using_kit            text,   -- Is she using the distributed sanitary kit? (yes/no)
  q5_cloth_pad_comfort    text,   -- Comfortable with cloth pad? (comfortable/uncomfortable/na)
  q6_will_continue        text,   -- Will she continue using hygienic products? (yes/no/maybe)
  q7_barrier              text,   -- What is stopping her? (cost/availability/family/other)
  q8_session_rating       text,   -- 1–5 session rating

  -- ── Key insights (AI-generated bullet points) ─────────────────────────────
  key_insights            jsonb,  -- string[]

  -- ── Call recording URL ─────────────────────────────────────────────────────
  recording_url           text,   -- public URL to MP3 in Supabase storage bucket

  -- ── Audit ─────────────────────────────────────────────────────────────────
  created_at              timestamptz not null default now()

);

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists idx_ngo_call_results_phone
  on public.ngo_call_results (phone_number);

-- Deduplication: same room + same call_started_at = same call
-- Prevents duplicate rows when React Strict Mode fires effects twice in dev
--
-- Step 1: Remove existing duplicates, keeping the earliest created_at row.
delete from public.ngo_call_results
where id in (
  select id from (
    select
      id,
      row_number() over (
        partition by room_name, call_started_at
        order by created_at asc
      ) as rn
    from public.ngo_call_results
    where room_name is not null
      and call_started_at is not null
  ) ranked
  where rn > 1
);

-- Step 2: Now safe to create the unique index.
create unique index if not exists idx_ngo_call_results_dedup
  on public.ngo_call_results (room_name, call_started_at)
  where room_name is not null and call_started_at is not null;

create index if not exists idx_ngo_call_results_analyzed_at
  on public.ngo_call_results (analyzed_at desc);

create index if not exists idx_ngo_call_results_outcome
  on public.ngo_call_results (call_outcome);

create index if not exists idx_ngo_call_results_school
  on public.ngo_call_results (school_name);

create index if not exists idx_ngo_call_results_sentiment
  on public.ngo_call_results (sentiment_overall desc);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Enable RLS so anonymous/public keys cannot read or write.
-- Only the service role key (used by the Next.js API route) can insert.
alter table public.ngo_call_results enable row level security;

-- Allow the service role to do everything (bypasses RLS anyway, but explicit is good)
-- Allow authenticated dashboard users to SELECT (read results in future admin UI)
create policy "Service role full access"
  on public.ngo_call_results
  for all
  to service_role
  using (true)
  with check (true);

create policy "Authenticated users can read"
  on public.ngo_call_results
  for select
  to authenticated
  using (true);

-- ── Comments ──────────────────────────────────────────────────────────────────
comment on table  public.ngo_call_results                  is 'One row per analysed NGO feedback call. Populated by /api/ngo-analyze after each call ends.';
comment on column public.ngo_call_results.transcript       is 'Full conversation: [{role,text,lang,ts_ms}, ...]';
comment on column public.ngo_call_results.sentiment_reasoning is '{engagement,comfort,awareness_gain,product_adoption,positivity} — one sentence each from LLM';
comment on column public.ngo_call_results.key_insights     is 'Array of 3 AI-generated insight strings about this call';
