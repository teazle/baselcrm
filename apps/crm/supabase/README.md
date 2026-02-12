# Supabase migrations (CRM app)

Migrations for the CRM app live in **`apps/crm/supabase/migrations/`**. Supabase CLI expects a `supabase/migrations` directory; when using the CLI with this app, point it at this folder (e.g. run from `apps/crm` with `supabase link` and ensure migrations path is `supabase/migrations`).

## Apply order

Apply in filename order (lexicographic = chronological):

1. **20260130000001_tasks.sql** – `set_updated_at()`, `tasks` table + RLS  
2. **20260130000002_crm_tables.sql** – CRM tables: accounts, contacts, projects, cases, visits, treatment_master, visit_treatments, receipts, receipt_visit_offsets + RLS  
3. **20260130000003_rpa_extraction_runs.sql** – `rpa_extraction_runs` table  
4. **20260130000004_rpa_portals.sql** – `rpa_portals` table + seed  
5. **20260130000005_rpa_tables_user_id_rls.sql** – add `user_id` and RLS to RPA tables  

## Using Supabase CLI

- From **repo root**: if your Supabase project is linked at root, either add a second config under `apps/crm/supabase/` or run migrations from root and include this path in your config.  
- From **apps/crm**: run `supabase link` (if you have a project for this app), then `supabase db push` so migrations in `supabase/migrations/` are applied automatically.

## Manual apply

If you don’t use the CLI, run the SQL in the same order in **Supabase Dashboard → SQL Editor**, or run the equivalent `.sql` files in `apps/crm/` (e.g. `supabase-tasks.sql`, `supabase-crm-tables.sql`, etc.) in the order listed above.
