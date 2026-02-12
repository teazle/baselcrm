-- Creates CRM tables: contacts, accounts, projects, cases, visits, receipts,
-- treatment_master, receipt_visit_offsets, visit_treatments.
-- Run after supabase-tasks.sql (uses set_updated_at). Then run
-- supabase-permissive-rls-single-user.sql to allow SELECT for all authenticated.
-- Run in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================================
-- ACCOUNTS (Companies)
-- =============================================================================
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  company_code text,
  phone text,
  email_statement_of_account text,
  billing_street text,
  active boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists accounts_user_id_idx on public.accounts (user_id);
create index if not exists accounts_updated_at_idx on public.accounts (updated_at desc);
drop trigger if exists set_accounts_updated_at on public.accounts;
create trigger set_accounts_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();
alter table public.accounts enable row level security;
drop policy if exists "accounts_select" on public.accounts;
create policy "accounts_select" on public.accounts for select to authenticated, anon using (true);
drop policy if exists "accounts_insert_own" on public.accounts;
create policy "accounts_insert_own" on public.accounts for insert with check (auth.uid() = user_id);
drop policy if exists "accounts_update_own" on public.accounts;
create policy "accounts_update_own" on public.accounts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "accounts_delete_own" on public.accounts;
create policy "accounts_delete_own" on public.accounts for delete using (auth.uid() = user_id);

-- =============================================================================
-- CONTACTS
-- =============================================================================
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  first_name text,
  last_name text,
  email text,
  mobile text,
  record_type text,
  account_id uuid references public.accounts(id) on delete set null,
  registration_no text,
  registration_date date,
  ic_passport_no text,
  nationality text,
  sex text,
  date_of_birth date,
  age int,
  marital_status text,
  language text,
  race text,
  home_phone text,
  other_phone text,
  next_of_kin text,
  relationship text,
  contact_no_next_of_kin text,
  special_remarks_contact text,
  mailing_address text,
  other_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contacts_user_id_idx on public.contacts (user_id);
create index if not exists contacts_account_id_idx on public.contacts (account_id);
create index if not exists contacts_updated_at_idx on public.contacts (updated_at desc);
drop trigger if exists set_contacts_updated_at on public.contacts;
create trigger set_contacts_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();
alter table public.contacts enable row level security;
drop policy if exists "contacts_select" on public.contacts;
create policy "contacts_select" on public.contacts for select to authenticated, anon using (true);
drop policy if exists "contacts_insert_own" on public.contacts;
create policy "contacts_insert_own" on public.contacts for insert with check (auth.uid() = user_id);
drop policy if exists "contacts_update_own" on public.contacts;
create policy "contacts_update_own" on public.contacts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "contacts_delete_own" on public.contacts;
create policy "contacts_delete_own" on public.contacts for delete using (auth.uid() = user_id);

-- =============================================================================
-- PROJECTS
-- =============================================================================
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  name text,
  account_id uuid references public.accounts(id) on delete set null,
  active boolean,
  category_1 text,
  category_2 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_id_idx on public.projects (user_id);
create index if not exists projects_updated_at_idx on public.projects (updated_at desc);
drop trigger if exists set_projects_updated_at on public.projects;
create trigger set_projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
alter table public.projects enable row level security;
drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects for select to authenticated, anon using (true);
drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects for insert with check (auth.uid() = user_id);
drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects for delete using (auth.uid() = user_id);

-- =============================================================================
-- CASES
-- =============================================================================
create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  case_no text,
  case_date date,
  patient_name text,
  contact_id uuid references public.contacts(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  bill_to_company_id uuid references public.accounts(id) on delete set null,
  type_of_case text,
  trigger_sms boolean,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cases_user_id_idx on public.cases (user_id);
create index if not exists cases_updated_at_idx on public.cases (updated_at desc);
drop trigger if exists set_cases_updated_at on public.cases;
create trigger set_cases_updated_at before update on public.cases
  for each row execute function public.set_updated_at();
alter table public.cases enable row level security;
drop policy if exists "cases_select" on public.cases;
create policy "cases_select" on public.cases for select to authenticated, anon using (true);
drop policy if exists "cases_insert_own" on public.cases;
create policy "cases_insert_own" on public.cases for insert with check (auth.uid() = user_id);
drop policy if exists "cases_update_own" on public.cases;
create policy "cases_update_own" on public.cases for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "cases_delete_own" on public.cases;
create policy "cases_delete_own" on public.cases for delete using (auth.uid() = user_id);

-- =============================================================================
-- VISITS
-- =============================================================================
create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  visit_record_no text,
  case_id uuid references public.cases(id) on delete set null,
  visit_date date,
  patient_name text,
  total_amount numeric,
  amount_outstanding numeric,
  amount_applied numeric,
  symptoms text,
  treatment_detail text,
  source text,
  extraction_metadata jsonb,
  submission_status text,
  submission_metadata jsonb,
  submitted_at timestamptz,
  pay_type text,
  diagnosis_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists visits_user_id_idx on public.visits (user_id);
create index if not exists visits_case_id_idx on public.visits (case_id);
create index if not exists visits_updated_at_idx on public.visits (updated_at desc);
drop trigger if exists set_visits_updated_at on public.visits;
create trigger set_visits_updated_at before update on public.visits
  for each row execute function public.set_updated_at();
alter table public.visits enable row level security;
drop policy if exists "visits_select" on public.visits;
create policy "visits_select" on public.visits for select to authenticated, anon using (true);
drop policy if exists "visits_insert_own" on public.visits;
create policy "visits_insert_own" on public.visits for insert with check (auth.uid() = user_id);
drop policy if exists "visits_update_own" on public.visits;
create policy "visits_update_own" on public.visits for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "visits_delete_own" on public.visits;
create policy "visits_delete_own" on public.visits for delete using (auth.uid() = user_id);

-- =============================================================================
-- TREATMENT_MASTER
-- =============================================================================
create table if not exists public.treatment_master (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  code text,
  name text,
  unit_price numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists treatment_master_user_id_idx on public.treatment_master (user_id);
create index if not exists treatment_master_updated_at_idx on public.treatment_master (updated_at desc);
drop trigger if exists set_treatment_master_updated_at on public.treatment_master;
create trigger set_treatment_master_updated_at before update on public.treatment_master
  for each row execute function public.set_updated_at();
alter table public.treatment_master enable row level security;
drop policy if exists "treatment_master_select" on public.treatment_master;
create policy "treatment_master_select" on public.treatment_master for select to authenticated, anon using (true);
drop policy if exists "treatment_master_insert_own" on public.treatment_master;
create policy "treatment_master_insert_own" on public.treatment_master for insert with check (auth.uid() = user_id);
drop policy if exists "treatment_master_update_own" on public.treatment_master;
create policy "treatment_master_update_own" on public.treatment_master for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "treatment_master_delete_own" on public.treatment_master;
create policy "treatment_master_delete_own" on public.treatment_master for delete using (auth.uid() = user_id);

-- =============================================================================
-- VISIT_TREATMENTS
-- =============================================================================
create table if not exists public.visit_treatments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  visit_id uuid references public.visits(id) on delete cascade,
  treatment_record_no text,
  treatment_master_id uuid references public.treatment_master(id) on delete set null,
  quantity numeric,
  cost_per_unit numeric,
  line_cost numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists visit_treatments_user_id_idx on public.visit_treatments (user_id);
create index if not exists visit_treatments_visit_id_idx on public.visit_treatments (visit_id);
drop trigger if exists set_visit_treatments_updated_at on public.visit_treatments;
create trigger set_visit_treatments_updated_at before update on public.visit_treatments
  for each row execute function public.set_updated_at();
alter table public.visit_treatments enable row level security;
drop policy if exists "visit_treatments_select" on public.visit_treatments;
create policy "visit_treatments_select" on public.visit_treatments for select to authenticated, anon using (true);
drop policy if exists "visit_treatments_insert_own" on public.visit_treatments;
create policy "visit_treatments_insert_own" on public.visit_treatments for insert with check (auth.uid() = user_id);
drop policy if exists "visit_treatments_update_own" on public.visit_treatments;
create policy "visit_treatments_update_own" on public.visit_treatments for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "visit_treatments_delete_own" on public.visit_treatments;
create policy "visit_treatments_delete_own" on public.visit_treatments for delete using (auth.uid() = user_id);

-- =============================================================================
-- RECEIPTS
-- =============================================================================
create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  receipt_no text,
  receipt_date date,
  transaction_type text,
  receipt_from_account_id uuid references public.accounts(id) on delete set null,
  receipt_amount numeric,
  amount_applied numeric,
  balance numeric,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists receipts_user_id_idx on public.receipts (user_id);
create index if not exists receipts_updated_at_idx on public.receipts (updated_at desc);
drop trigger if exists set_receipts_updated_at on public.receipts;
create trigger set_receipts_updated_at before update on public.receipts
  for each row execute function public.set_updated_at();
alter table public.receipts enable row level security;
drop policy if exists "receipts_select" on public.receipts;
create policy "receipts_select" on public.receipts for select to authenticated, anon using (true);
drop policy if exists "receipts_insert_own" on public.receipts;
create policy "receipts_insert_own" on public.receipts for insert with check (auth.uid() = user_id);
drop policy if exists "receipts_update_own" on public.receipts;
create policy "receipts_update_own" on public.receipts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "receipts_delete_own" on public.receipts;
create policy "receipts_delete_own" on public.receipts for delete using (auth.uid() = user_id);

-- =============================================================================
-- RECEIPT_VISIT_OFFSETS
-- =============================================================================
create table if not exists public.receipt_visit_offsets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  receipt_id uuid references public.receipts(id) on delete cascade,
  visit_id uuid references public.visits(id) on delete cascade,
  rvo_record_no text,
  amount_applied numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists receipt_visit_offsets_user_id_idx on public.receipt_visit_offsets (user_id);
create index if not exists receipt_visit_offsets_receipt_id_idx on public.receipt_visit_offsets (receipt_id);
create index if not exists receipt_visit_offsets_visit_id_idx on public.receipt_visit_offsets (visit_id);
drop trigger if exists set_receipt_visit_offsets_updated_at on public.receipt_visit_offsets;
create trigger set_receipt_visit_offsets_updated_at before update on public.receipt_visit_offsets
  for each row execute function public.set_updated_at();
alter table public.receipt_visit_offsets enable row level security;
drop policy if exists "receipt_visit_offsets_select" on public.receipt_visit_offsets;
create policy "receipt_visit_offsets_select" on public.receipt_visit_offsets for select to authenticated, anon using (true);
drop policy if exists "receipt_visit_offsets_insert_own" on public.receipt_visit_offsets;
create policy "receipt_visit_offsets_insert_own" on public.receipt_visit_offsets for insert with check (auth.uid() = user_id);
drop policy if exists "receipt_visit_offsets_update_own" on public.receipt_visit_offsets;
create policy "receipt_visit_offsets_update_own" on public.receipt_visit_offsets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "receipt_visit_offsets_delete_own" on public.receipt_visit_offsets;
create policy "receipt_visit_offsets_delete_own" on public.receipt_visit_offsets for delete using (auth.uid() = user_id);
