-- RPA tables: add user_id and RLS so RPA UI (Supabase) works with single-user policies.
-- Run after supabase-rpa-extraction-runs.sql and supabase-rpa-portals.sql (or after
-- supabase-crm-tables.sql which does not create RPA tables).
-- Run in Supabase Dashboard -> SQL Editor.

-- =============================================================================
-- rpa_extraction_runs: add user_id, enable RLS, policies
-- =============================================================================
alter table public.rpa_extraction_runs
  add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();

create index if not exists rpa_extraction_runs_user_id_idx on public.rpa_extraction_runs (user_id);

alter table public.rpa_extraction_runs enable row level security;

drop policy if exists "rpa_extraction_runs_select" on public.rpa_extraction_runs;
create policy "rpa_extraction_runs_select" on public.rpa_extraction_runs
  for select to authenticated, anon using (true);

drop policy if exists "rpa_extraction_runs_insert_own" on public.rpa_extraction_runs;
create policy "rpa_extraction_runs_insert_own" on public.rpa_extraction_runs
  for insert with check (auth.uid() = user_id);

drop policy if exists "rpa_extraction_runs_update_own" on public.rpa_extraction_runs;
create policy "rpa_extraction_runs_update_own" on public.rpa_extraction_runs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "rpa_extraction_runs_delete_own" on public.rpa_extraction_runs;
create policy "rpa_extraction_runs_delete_own" on public.rpa_extraction_runs
  for delete using (auth.uid() = user_id);

-- Backfill: set user_id from created_by where null (optional)
update public.rpa_extraction_runs set user_id = created_by where user_id is null and created_by is not null;
update public.rpa_extraction_runs set user_id = (select id from auth.users limit 1) where user_id is null;

-- =============================================================================
-- rpa_portals: add user_id, use set_updated_at, enable RLS, policies
-- =============================================================================
alter table public.rpa_portals
  add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();

create index if not exists rpa_portals_user_id_idx on public.rpa_portals (user_id);

-- updated_at trigger already created in supabase-rpa-portals.sql (set_rpa_portals_updated_at)

alter table public.rpa_portals enable row level security;

drop policy if exists "rpa_portals_select" on public.rpa_portals;
create policy "rpa_portals_select" on public.rpa_portals
  for select to authenticated, anon using (true);

drop policy if exists "rpa_portals_insert_own" on public.rpa_portals;
create policy "rpa_portals_insert_own" on public.rpa_portals
  for insert with check (auth.uid() = user_id);

drop policy if exists "rpa_portals_update_own" on public.rpa_portals;
create policy "rpa_portals_update_own" on public.rpa_portals
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "rpa_portals_delete_own" on public.rpa_portals;
create policy "rpa_portals_delete_own" on public.rpa_portals
  for delete using (auth.uid() = user_id);

-- Backfill: assign first user where null (portals are shared config; one user can own)
update public.rpa_portals set user_id = (select id from auth.users limit 1) where user_id is null;
