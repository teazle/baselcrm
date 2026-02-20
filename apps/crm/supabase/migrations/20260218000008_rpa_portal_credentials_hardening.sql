-- Harden portal credential storage:
-- 1) add encrypted secret columns
-- 2) block direct browser access to credential rows (API-only)

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

-- Remove permissive browser policies. Portal credentials must be managed via backend API.
drop policy if exists "rpa_portal_credentials_select_own" on public.rpa_portal_credentials;
drop policy if exists "rpa_portal_credentials_insert_own" on public.rpa_portal_credentials;
drop policy if exists "rpa_portal_credentials_update_own" on public.rpa_portal_credentials;
drop policy if exists "rpa_portal_credentials_delete_own" on public.rpa_portal_credentials;
drop policy if exists "rpa_portal_credentials_block_direct" on public.rpa_portal_credentials;

create policy "rpa_portal_credentials_block_direct" on public.rpa_portal_credentials
  for all to authenticated using (false) with check (false);
