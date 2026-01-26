import { createBrowserSupabaseClient } from "./client";

let cached: ReturnType<typeof createBrowserSupabaseClient> | undefined;

export function supabaseBrowser() {
  if (cached === undefined) cached = createBrowserSupabaseClient();
  return cached ?? null;
}


