import { createClient } from '@supabase/supabase-js';
import { logger } from './logger.js';

/**
 * Creates a Supabase client for server-side use
 * Uses service role key for admin operations (if available) or anon key
 */
export function createSupabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    logger.warn('[Supabase] Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY');
    return null;
  }

  return createClient(url, key);
}

