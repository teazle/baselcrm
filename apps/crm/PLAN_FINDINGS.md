# Plan findings – how they were addressed

This file records how the listed plan findings were fixed in the codebase.

---

## High: RPA UI switched to Supabase but schema plan only covered CRM tables

**Finding:** If RPA components read/write separate tables (runs, logs, statuses), they would break unless those tables and policies exist.

**Addressed:**

- **RPA tables in schema:** Added `supabase-rpa-tables-user-id-rls.sql` which:
  - Adds `user_id` to `rpa_extraction_runs` and `rpa_portals` (with default `auth.uid()`)
  - Enables RLS on both tables
  - Defines SELECT (permissive for anon/authenticated) and INSERT/UPDATE/DELETE (own `user_id`) policies
- **Migrations:** RPA tables and RLS are included in `apps/crm/supabase/migrations/` in order: `20260130000003_rpa_extraction_runs.sql`, `20260130000004_rpa_portals.sql`, `20260130000005_rpa_tables_user_id_rls.sql`.

---

## High: “Move auto-number and denormalization into Supabase” underspecified

**Finding:** Moving auto-number/denormalization to Supabase without explicit triggers/defaults can change behavior (concurrency, formatting, backfill).

**Addressed:**

- **Current behavior documented:** `docs/SCHEMA_AND_RLS.md` states that:
  - Auto-number is **app-side** via `nextAutoNoSupabase` for `case_no` and `registration_no`; other numbers are set by the UI or left null.
  - Denormalized fields (e.g. `patient_name` on cases/visits) are **app-maintained**; no DB triggers.
- **No behavior change:** We did **not** add DB triggers or defaults for auto-number or denormalization. If you add them later, document format, concurrency, and backfill in the same doc.

---

## Medium: Migration location vague (“under apps/crm/”)

**Finding:** Supabase CLI expects a specific migrations directory; otherwise migrations are not applied automatically.

**Addressed:**

- **Fixed location:** Migrations live in **`apps/crm/supabase/migrations/`** with timestamped filenames (e.g. `20260130000001_tasks.sql`).
- **README:** `apps/crm/supabase/README.md` explains apply order, how to use Supabase CLI from this app, and how to apply manually via Dashboard or the root-level `.sql` files.

---

## Medium: RLS/policy must explicitly require user_id on all tables (including join tables)

**Finding:** Without `user_id` on all tables (including join tables like `receipt_visit_offsets`, `visit_treatments`), per-user RLS can fail or allow cross-user access.

**Addressed:**

- **Schema:** All CRM and RPA tables already have `user_id` and RLS policies (SELECT permissive, INSERT/UPDATE/DELETE restricted to `auth.uid() = user_id`). Join tables `receipt_visit_offsets` and `visit_treatments` are included.
- **Documentation:** `docs/SCHEMA_AND_RLS.md` explicitly requires `user_id` (or equivalent) on **all** tables subject to RLS, including join tables, and describes the policy pattern to use for new tables.

---

## Low: “Return errors if !supabase” – no UX plan for missing config

**Finding:** Worth calling out to avoid a blank page when Supabase is not configured.

**Addressed:**

- **Explicit error screen:** When Supabase is not configured, the app now shows a dedicated screen instead of a blank or generic error:
  - **Component:** `components/providers/SupabaseRequired.tsx` checks `isSupabaseConfigured()` and, if false, renders a full-page card with:
    - Title: “Supabase is not configured”
    - Instructions to set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (e.g. in `.env.local`)
    - Pointer to run migrations under `apps/crm/supabase/migrations/`
  - **Usage:** `SupabaseRequired` wraps the CRM layout (`(crm)/layout.tsx`) and the RPA layout (`rpa/layout.tsx`), so both `/crm/*` and `/rpa/*` show this screen when config is missing.
