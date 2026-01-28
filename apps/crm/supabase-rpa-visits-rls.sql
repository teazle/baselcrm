-- Update RLS policies for visits table to allow viewing RPA visits
-- This allows all authenticated users (and anon in development) to view visits with source = 'Clinic Assist'
-- Run in Supabase Dashboard -> SQL Editor.

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "visits_select" ON public.visits;
DROP POLICY IF EXISTS "visits_select_own" ON public.visits;

-- Create new SELECT policy that allows:
-- 1. Users to see their own visits (user_id = auth.uid())
-- 2. All authenticated users to see RPA visits (source = 'Clinic Assist')
-- 3. In development: allow anon to see RPA visits (for demo mode)
CREATE POLICY "visits_select"
ON public.visits
FOR SELECT
USING (
  -- Allow users to see their own visits
  (user_id = auth.uid())
  OR
  -- Allow viewing RPA visits (source = 'Clinic Assist')
  (source = 'Clinic Assist')
);

-- Keep the existing INSERT, UPDATE, DELETE policies as they are (users can only modify their own visits)
-- These policies remain unchanged:
-- - visits_insert / visits_insert_own
-- - visits_update / visits_update_own  
-- - visits_delete / visits_delete_own
