-- ============================================================
--  Test Student Sheets Table
--  Mirrors student_answer_sheets with just the columns needed
--  by the NGO dashboard APIs. Contains 5 test records for dev.
--
--  Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================

-- Drop if exists (safe to re-run)
drop table if exists public.test_student_sheets;

create table public.test_student_sheets (
  id                    uuid primary key default gen_random_uuid(),
  student_name          text,
  student_name_english  text,
  contact_number        text,
  age                   integer,
  school_id             uuid,
  school_name           text,
  campaign_type         text default 'post',
  project_id            uuid,
  percentage            numeric,
  grade                 text,
  date                  text,
  is_deleted            boolean default false,
  created_at            timestamptz not null default now()
);

-- ── Insert 5 test students ──────────────────────────────────────────────────
insert into public.test_student_sheets
  (student_name, student_name_english, contact_number, age, school_name, campaign_type, percentage, grade, date)
values
  ('ध्रुव',        'Dhruv',           '8989528422',       19, 'Test Engineering College',  'post', 78.5, 'B',  '2026-03-15'),
  ('तनीष्क',       'Tanishq',         '+91 70455 99298',  20, 'Test Engineering College',  'post', 85.2, 'A',  '2026-03-15'),
  ('हंज़ला सैफ़ी',   'Hanzala Saify',   '+91 88786 01555',  19, 'Test Science Academy',      'post', 72.0, 'B',  '2026-03-16'),
  ('आदित्य दुबे',   'Aditya Dubey',    '+91 91113 51000',  21, 'Test Science Academy',      'post', 90.1, 'A+', '2026-03-16'),
  ('दीप जैन',      'Deep Jain',       '+91 7709 494 643', 20, 'Test Public School',        'post', 65.3, 'C',  '2026-03-17');

-- Verify
select id, student_name_english, contact_number, school_name, campaign_type from public.test_student_sheets;
