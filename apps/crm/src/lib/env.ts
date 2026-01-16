export function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(url && anonKey);
}

export function isDemoMode() {
  // Explicit toggle or implicit when Supabase is not configured.
  const flag = process.env.NEXT_PUBLIC_DEMO_MODE;
  if (flag === "1" || flag === "true") return true;
  return !isSupabaseConfigured();
}


