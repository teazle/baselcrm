-- Migration: Create rpa_portals table for Flow 3 portal settings
-- Run in Supabase Dashboard -> SQL Editor

create extension if not exists pgcrypto;

create table if not exists public.rpa_portals (
  id uuid primary key default gen_random_uuid(),
  portal_code text not null unique,
  label text,
  status text not null default 'unsupported',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Valid status values
alter table public.rpa_portals
  drop constraint if exists rpa_portals_status_check;

alter table public.rpa_portals
  add constraint rpa_portals_status_check
  check (status in ('supported', 'unsupported'));

-- Trigger to keep updated_at current
create or replace function public.set_rpa_portals_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'rpa_portals_updated_at'
  ) then
    create trigger rpa_portals_updated_at
    before update on public.rpa_portals
    for each row
    execute procedure public.set_rpa_portals_updated_at();
  end if;
end;
$$;

-- Seed with default supported/unsupported portals if table is empty
insert into public.rpa_portals (portal_code, label, status)
select v.portal_code, v.label, v.status
from (
  values
    ('MHC', 'MHC', 'supported'),
    ('AIA', 'AIA', 'supported'),
    ('AIACLIENT', 'AIACLIENT', 'supported'),
    ('IHP', 'IHP', 'unsupported'),
    ('GE', 'GE', 'unsupported'),
    ('FULLERT', 'FULLERT', 'unsupported'),
    ('ALLIMED', 'ALLIMED', 'unsupported'),
    ('ALL', 'ALL', 'unsupported'),
    ('ALLIANCE', 'ALLIANCE', 'unsupported')
) as v(portal_code, label, status)
where not exists (select 1 from public.rpa_portals);

-- RLS Policies (adjust to your needs)
-- If RLS is enabled, allow read/update from anon/authenticated for the RPA UI
-- create policy "rpa_portals_select" on public.rpa_portals for select to anon, authenticated using (true);
-- create policy "rpa_portals_upsert" on public.rpa_portals for insert to anon, authenticated with check (true);
-- create policy "rpa_portals_update" on public.rpa_portals for update to anon, authenticated using (true);
-- create policy "rpa_portals_delete" on public.rpa_portals for delete to anon, authenticated using (true);
