# Schema and RLS

## user_id on all tables (including join tables)

Every table that is subject to RLS **must** have a `user_id` column (or equivalent) so that policies can restrict access by `auth.uid()`. This includes:

- **Main entities**: accounts, contacts, projects, cases, visits, receipts, treatment_master, tasks
- **Join / child tables**: `receipt_visit_offsets`, `visit_treatments`
- **RPA tables**: `rpa_extraction_runs`, `rpa_portals`

Without `user_id` on join tables, per-user RLS will either block access (if RLS is restrictive) or allow cross-user access (if SELECT is permissive and INSERT/UPDATE/DELETE are missing). All migrations in `supabase/migrations/` create tables with `user_id uuid references auth.users(id) on delete cascade default auth.uid()` and policies:

- **SELECT**: `to authenticated, anon using (true)` (single-user/team: everyone sees all rows)
- **INSERT**: `with check (auth.uid() = user_id)`
- **UPDATE**: `using (auth.uid() = user_id) with check (auth.uid() = user_id)`
- **DELETE**: `using (auth.uid() = user_id)`

When adding new tables (including join tables), add `user_id` and the same policy pattern.

---

## Auto-number and denormalization

### Auto-number (current behavior)

Auto-numbering is **handled in the app**, not by database triggers:

- **`case_no`** (cases): generated in `lib/supabase/table.ts` via `nextAutoNoSupabase(supabase, 'cases', 'case_no', 'C-')` when inserting a case with empty or missing `case_no`.
- **`registration_no`** (contacts): same helper with prefix `REG-`.

Other human-readable numbers (`visit_record_no`, `receipt_no`, `treatment_record_no`, `rvo_record_no`) are set by the UI when creating records or left null; there is no app-side auto-generation for them today.

**If you move auto-number to Supabase**: use explicit triggers or defaults (e.g. a sequence + trigger per table/prefix) and document format (e.g. `C-` + 6-digit padding). Consider concurrency (e.g. `nextval` + lock) and backfill for existing rows. Until then, keep using the current app logic to avoid behavior changes.

### Denormalization (current behavior)

- **`patient_name`** on `cases` and `visits`: maintained by the app (e.g. copied from contact or case when creating/editing). There are no DB triggers that sync these. If you add triggers, document them and ensure they run on INSERT/UPDATE of the source (e.g. contact or case).

---

## Migrations location

Migrations live in **`apps/crm/supabase/migrations/`**. Supabase CLI expects a `supabase/migrations` directory; see `apps/crm/supabase/README.md` for apply order and how to run from CLI or manually.
