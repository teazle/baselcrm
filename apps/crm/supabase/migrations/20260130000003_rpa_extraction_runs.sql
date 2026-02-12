-- Creates public.rpa_extraction_runs table + indexes.
-- Supabase CLI migration: 20260130000003_rpa_extraction_runs

create extension if not exists pgcrypto;

create table if not exists public.rpa_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  total_records int not null default 0,
  completed_count int not null default 0,
  failed_count int not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists rpa_runs_started_at_idx on public.rpa_extraction_runs (started_at desc);
create index if not exists rpa_runs_status_idx on public.rpa_extraction_runs (status);
create index if not exists rpa_runs_type_started_idx on public.rpa_extraction_runs (run_type, started_at desc);
