# CRM testing checklist (after removing demo mode)

Run this after applying the plan: demo mode removed, Supabase-only CRUD, and `supabase-crm-tables.sql` (and optionally `supabase-permissive-rls-single-user.sql`) applied in Supabase.

## Prerequisites

- Supabase project created; `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set in env.
- All SQL migrations run in Supabase (Dashboard → SQL Editor): `supabase-tasks.sql`, `supabase-crm-tables.sql`, and optionally `supabase-permissive-rls-single-user.sql`.
- No `NEXT_PUBLIC_DEMO_MODE`; app uses Supabase only.

## Auth

- **Sign up:** New user can register; email confirmation required if enabled in Supabase.
- **Sign in:** Existing user can log in; invalid credentials show a clear error.
- **Sign out:** User can sign out; protected CRM routes redirect to login when not authenticated.
- **Protected routes:** `/crm/*` and RPA routes are inaccessible without auth (or redirect to login).

## CRM CRUD (per entity)

For **Contacts, Companies, Projects, Cases, Visits, Receipts, Treatment Master, Tasks**:

- **List:** Open list page (e.g. `/crm/contacts`). Table loads without error; rows appear if any exist; empty state when no rows.
- **Create:** Click "New …", fill required fields, submit. Redirect to detail or list; new row appears; data matches input.
- **Read/Edit:** Open a row (detail page). Form loads existing data; change fields and save; list/detail shows updated data.
- **Delete:** On detail page, use Delete button; confirm if applicable. Row is removed; list no longer shows it.
- **Validation:** Submit with invalid or missing required fields; expect validation messages and no create/update.

## Relations and integrity

- **Cases:** Create case with contact and project; visit list on case shows visits for that case.
- **Visits:** Create visit linked to case; treatment lines and receipt offsets behave as implemented.
- **Receipts / receipt_visit_offsets:** Create receipt and offset to visit; receipt balance and visit outstanding update per current logic.

## RPA (if in scope)

- RPA dashboards and flows load; data comes from Supabase (visits, extraction runs, etc.); no reliance on localStorage.

## Smoke test

1. Log in.
2. Open each CRM section: contacts, companies, projects, cases, visits, receipts, treatment-master, tasks.
3. Open one "New" and one existing record (edit); save.
4. Delete one record (where safe).
