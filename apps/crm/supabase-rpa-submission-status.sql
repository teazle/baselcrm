-- Migration: Add submission_status support for 'draft' status
-- Run in Supabase Dashboard -> SQL Editor

-- Ensure visits table has submission_status column (if not exists)
-- Note: This assumes submission_status already exists as text. If not, uncomment:
-- ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS submission_status text;

-- Add check constraint to ensure submission_status only accepts valid values
-- First, drop existing constraint if it exists
ALTER TABLE public.visits 
DROP CONSTRAINT IF EXISTS visits_submission_status_check;

-- Add constraint for valid submission_status values
ALTER TABLE public.visits 
ADD CONSTRAINT visits_submission_status_check 
CHECK (submission_status IS NULL OR submission_status IN ('draft', 'submitted', 'error'));

-- Ensure submission_metadata column exists (if not exists)
-- Note: This assumes submission_metadata already exists as jsonb. If not, uncomment:
-- ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS submission_metadata jsonb DEFAULT '{}'::jsonb;

-- Backfill: Update existing rows where savedAsDraft=true in metadata to have submission_status='draft'
-- This migrates any existing drafts that were incorrectly marked as 'submitted'
UPDATE public.visits
SET submission_status = 'draft',
    submission_metadata = jsonb_set(
      COALESCE(submission_metadata, '{}'::jsonb),
      '{drafted_at}',
      to_jsonb(submitted_at),
      true
    ),
    submitted_at = NULL
WHERE submission_status = 'submitted'
  AND submission_metadata->>'savedAsDraft' = 'true';

-- Add index for faster queries on submission_status
CREATE INDEX IF NOT EXISTS visits_submission_status_idx 
ON public.visits (submission_status) 
WHERE submission_status IS NOT NULL;

-- Add index for faster queries on pay_type (for Flow 3 filtering)
CREATE INDEX IF NOT EXISTS visits_pay_type_idx 
ON public.visits (pay_type) 
WHERE pay_type IS NOT NULL;

-- Add composite index for Flow 3 "Not started" queries (submission_status IS NULL AND pay_type in unsupported list)
CREATE INDEX IF NOT EXISTS visits_submission_pay_type_idx 
ON public.visits (submission_status, pay_type) 
WHERE source = 'Clinic Assist';

-- RLS Policies for RPA UI
-- The RPA UI needs to read submission_status, submission_metadata, and pay_type fields
-- Ensure existing RLS policies on visits table allow SELECT for these fields
-- If visits table has RLS enabled, ensure policies allow:
--   - SELECT for anon/authenticated users (for RPA UI)
--   - UPDATE for service_role (for claim submission updates)
--
-- Example policy for RPA UI (if needed):
--   CREATE POLICY "visits_select_rpa" ON public.visits
--   FOR SELECT
--   TO anon, authenticated
--   USING (source = 'Clinic Assist' OR true);  -- Adjust based on your security needs
