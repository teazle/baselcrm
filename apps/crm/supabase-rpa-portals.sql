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
    ('AVIVA', 'AVIVA', 'supported'),
    ('SINGLIFE', 'SINGLIFE', 'supported'),
    ('MHCAXA', 'MHCAXA', 'supported'),
    ('TOKIOM', 'TOKIOM', 'supported'),
    ('ALLIANC', 'ALLIANC', 'supported'),
    ('ALLSING', 'ALLSING', 'supported'),
    ('AXAMED', 'AXAMED', 'supported'),
    ('PRUDEN', 'PRUDEN', 'supported'),
    ('ALLIANZ', 'ALLIANZ', 'unsupported'),
    ('ALLIANCE', 'ALLIANCE', 'unsupported'),
    ('PARKWAY', 'PARKWAY', 'unsupported'),
    ('NTUC_IM', 'NTUC_IM', 'unsupported'),
    ('IHP', 'IHP', 'unsupported'),
    ('GE', 'GE', 'unsupported'),
    ('FULLERT', 'FULLERT', 'unsupported'),
    ('ALLIMED', 'ALLIMED', 'unsupported'),
    ('ALL', 'ALL', 'unsupported')
) as v(portal_code, label, status)
where not exists (select 1 from public.rpa_portals);

-- RLS Policies (adjust to your needs)
-- If RLS is enabled, allow read/update from anon/authenticated for the RPA UI
-- create policy "rpa_portals_select" on public.rpa_portals for select to anon, authenticated using (true);
-- create policy "rpa_portals_upsert" on public.rpa_portals for insert to anon, authenticated with check (true);
-- create policy "rpa_portals_update" on public.rpa_portals for update to anon, authenticated using (true);
-- create policy "rpa_portals_delete" on public.rpa_portals for delete to anon, authenticated using (true);

-- ---------------------------------------------------------------------
-- Optional: Per-service portal credentials managed from /rpa/settings
-- ---------------------------------------------------------------------

create table if not exists public.rpa_portal_credentials (
  id uuid primary key default gen_random_uuid(),
  portal_target text not null unique,
  label text,
  portal_url text,
  username text,
  password text,
  is_active boolean not null default true,
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rpa_portal_credentials
  drop constraint if exists rpa_portal_credentials_target_check;

alter table public.rpa_portal_credentials
  add constraint rpa_portal_credentials_target_check
  check (portal_target in ('MHC', 'ALLIANCE_MEDINET', 'ALLIANZ', 'FULLERTON', 'IHP', 'IXCHANGE', 'GE_NTUC'));

create or replace function public.set_rpa_portal_credentials_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'rpa_portal_credentials_updated_at'
  ) then
    create trigger rpa_portal_credentials_updated_at
    before update on public.rpa_portal_credentials
    for each row
    execute procedure public.set_rpa_portal_credentials_updated_at();
  end if;
end;
$$;

insert into public.rpa_portal_credentials (portal_target, label, portal_url, is_active)
values
  ('MHC', 'MHC / AIA / AVIVA / SINGLIFE / MHCAXA', 'https://www.mhcasia.net/mhc/', true),
  ('ALLIANCE_MEDINET', 'Alliance Medinet', 'https://connect.alliancemedinet.com/login', true),
  ('ALLIANZ', 'Allianz Worldwide Care', 'https://my.allianzworldwidecare.com/sol/login.do', true),
  ('FULLERTON', 'Fullerton Health', 'https://doctor.fhn3.com/app_index', true),
  ('IHP', 'IHP eClaim', 'https://eclaim.ihp.com.sg/eclaim/login.asp', true),
  ('IXCHANGE', 'IXCHANGE SPOS', 'https://spos.o2ixchange.com/login', true),
  ('GE_NTUC', 'GE / NTUC IM', null, true)
on conflict (portal_target)
do update set
  label = excluded.label,
  portal_url = coalesce(excluded.portal_url, public.rpa_portal_credentials.portal_url),
  is_active = excluded.is_active,
  updated_at = now();

create index if not exists rpa_portal_credentials_user_id_idx on public.rpa_portal_credentials (user_id);

alter table public.rpa_portal_credentials enable row level security;

drop policy if exists "rpa_portal_credentials_select_own" on public.rpa_portal_credentials;
create policy "rpa_portal_credentials_select_own" on public.rpa_portal_credentials
  for select to authenticated using (true);

drop policy if exists "rpa_portal_credentials_insert_own" on public.rpa_portal_credentials;
create policy "rpa_portal_credentials_insert_own" on public.rpa_portal_credentials
  for insert to authenticated with check (true);

drop policy if exists "rpa_portal_credentials_update_own" on public.rpa_portal_credentials;
create policy "rpa_portal_credentials_update_own" on public.rpa_portal_credentials
  for update to authenticated using (true) with check (true);

drop policy if exists "rpa_portal_credentials_delete_own" on public.rpa_portal_credentials;
create policy "rpa_portal_credentials_delete_own" on public.rpa_portal_credentials
  for delete to authenticated using (true);

update public.rpa_portal_credentials
set user_id = (select id from auth.users limit 1)
where user_id is null;

-- ---------------------------------------------------------------------
-- Hardening patch: encrypted columns + API-only access for credentials
-- ---------------------------------------------------------------------

alter table if exists public.rpa_portal_credentials
  add column if not exists username_encrypted text,
  add column if not exists password_encrypted text,
  add column if not exists crypto_version text;

update public.rpa_portal_credentials
set crypto_version = 'v1'
where coalesce(crypto_version, '') = ''
  and (
    coalesce(username_encrypted, '') like 'v1:%'
    or coalesce(password_encrypted, '') like 'v1:%'
  );

drop policy if exists "rpa_portal_credentials_select_own" on public.rpa_portal_credentials;
drop policy if exists "rpa_portal_credentials_insert_own" on public.rpa_portal_credentials;
drop policy if exists "rpa_portal_credentials_update_own" on public.rpa_portal_credentials;
drop policy if exists "rpa_portal_credentials_delete_own" on public.rpa_portal_credentials;
drop policy if exists "rpa_portal_credentials_block_direct" on public.rpa_portal_credentials;

create policy "rpa_portal_credentials_block_direct" on public.rpa_portal_credentials
  for all to authenticated using (false) with check (false);
