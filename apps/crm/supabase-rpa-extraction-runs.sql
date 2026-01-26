-- Creates public.rpa_extraction_runs table + indexes.
-- Run in Supabase Dashboard -> SQL Editor.

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

-- If RLS is enabled on this table, the RPA UI (anon key) needs SELECT. Run in SQL Editor:
--   drop policy if exists "rpa_extraction_runs_select_anon" on public.rpa_extraction_runs;
--   create policy "rpa_extraction_runs_select_anon" on public.rpa_extraction_runs for select to anon using (true);
