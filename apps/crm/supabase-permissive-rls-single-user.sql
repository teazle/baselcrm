-- Migration: Make all RLS policies permissive for single-user/team setup
-- This allows all authenticated users to see all data (SELECT)
-- INSERT/UPDATE/DELETE remain restrictive (users can only modify their own data)
-- Run in Supabase Dashboard -> SQL Editor.

-- List of tables with user_id-based RLS policies
-- We'll update SELECT policies to allow all authenticated users to see all data

-- ============================================================================
-- VISITS TABLE
-- ============================================================================
DROP POLICY IF EXISTS "visits_select" ON public.visits;
DROP POLICY IF EXISTS "visits_select_own" ON public.visits;

-- Allow all authenticated users to see all visits
CREATE POLICY "visits_select"
ON public.visits
FOR SELECT
TO authenticated, anon
USING (true);

-- ============================================================================
-- ACCOUNTS TABLE
-- ============================================================================
DROP POLICY IF EXISTS "accounts_select" ON public.accounts;
DROP POLICY IF EXISTS "accounts_select_own" ON public.accounts;

CREATE POLICY "accounts_select"
ON public.accounts
FOR SELECT
TO authenticated, anon
USING (true);

-- ============================================================================
-- CASES TABLE
-- ============================================================================
DROP POLICY IF EXISTS "cases_select" ON public.cases;
DROP POLICY IF EXISTS "cases_select_own" ON public.cases;

CREATE POLICY "cases_select"
ON public.cases
FOR SELECT
TO authenticated, anon
USING (true);

-- ============================================================================
-- CONTACTS TABLE
-- ============================================================================
DROP POLICY IF EXISTS "contacts_select" ON public.contacts;
DROP POLICY IF EXISTS "contacts_select_own" ON public.contacts;

CREATE POLICY "contacts_select"
ON public.contacts
FOR SELECT
TO authenticated, anon
USING (true);

-- ============================================================================
-- PROJECTS TABLE
-- ============================================================================
DROP POLICY IF EXISTS "projects_select" ON public.projects;
DROP POLICY IF EXISTS "projects_select_own" ON public.projects;

CREATE POLICY "projects_select"
ON public.projects
FOR SELECT
TO authenticated, anon
USING (true);

-- ============================================================================
-- RECEIPTS TABLE
-- ============================================================================
DROP POLICY IF EXISTS "receipts_select" ON public.receipts;
DROP POLICY IF EXISTS "receipts_select_own" ON public.receipts;

CREATE POLICY "receipts_select"
ON public.receipts
FOR SELECT
TO authenticated, anon
USING (true);

-- ============================================================================
-- RECEIPT_VISIT_OFFSETS TABLE
-- ============================================================================
DROP POLICY IF EXISTS "receipt_visit_offsets_select" ON public.receipt_visit_offsets;
DROP POLICY IF EXISTS "receipt_visit_offsets_select_own" ON public.receipt_visit_offsets;

CREATE POLICY "receipt_visit_offsets_select"
ON public.receipt_visit_offsets
FOR SELECT
TO authenticated, anon
USING (true);

-- ============================================================================
-- TREATMENT_MASTER TABLE
-- ============================================================================
DROP POLICY IF EXISTS "treatment_master_select" ON public.treatment_master;
DROP POLICY IF EXISTS "treatment_master_select_own" ON public.treatment_master;

CREATE POLICY "treatment_master_select"
ON public.treatment_master
FOR SELECT
TO authenticated, anon
USING (true);

-- ============================================================================
-- VISIT_TREATMENTS TABLE
-- ============================================================================
DROP POLICY IF EXISTS "visit_treatments_select" ON public.visit_treatments;
DROP POLICY IF EXISTS "visit_treatments_select_own" ON public.visit_treatments;

CREATE POLICY "visit_treatments_select"
ON public.visit_treatments
FOR SELECT
TO authenticated, anon
USING (true);

-- ============================================================================
-- TASKS TABLE
-- ============================================================================
DROP POLICY IF EXISTS "tasks_select_own" ON public.tasks;

CREATE POLICY "tasks_select"
ON public.tasks
FOR SELECT
TO authenticated, anon
USING (true);

-- ============================================================================
-- NOTES:
-- ============================================================================
-- 1. INSERT/UPDATE/DELETE policies remain restrictive (users can only modify their own data)
--    If you want to make these permissive too, you can run similar DROP/CREATE statements
--    but change the USING clause to `true` for those operations.
--
-- 2. RPA tables:
--    - rpa_extraction_runs: RLS is disabled (no policies needed)
--    - rpa_portals: Already has permissive policy (qual: "true")
--
-- 3. To make INSERT/UPDATE/DELETE permissive too, uncomment and run:
--    (Example for visits table)
--    DROP POLICY IF EXISTS "visits_insert" ON public.visits;
--    DROP POLICY IF EXISTS "visits_insert_own" ON public.visits;
--    CREATE POLICY "visits_insert" ON public.visits FOR INSERT TO authenticated, anon WITH CHECK (true);
--
--    DROP POLICY IF EXISTS "visits_update" ON public.visits;
--    DROP POLICY IF EXISTS "visits_update_own" ON public.visits;
--    CREATE POLICY "visits_update" ON public.visits FOR UPDATE TO authenticated, anon USING (true) WITH CHECK (true);
--
--    DROP POLICY IF EXISTS "visits_delete" ON public.visits;
--    DROP POLICY IF EXISTS "visits_delete_own" ON public.visits;
--    CREATE POLICY "visits_delete" ON public.visits FOR DELETE TO authenticated, anon USING (true);
