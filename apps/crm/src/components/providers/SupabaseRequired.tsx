"use client";

import { isSupabaseConfigured } from "@/lib/env";

/**
 * When Supabase is not configured, show an explicit error screen instead of
 * a blank page or generic errors. Call out env vars and setup steps.
 */
export function SupabaseRequired({ children }: { children: React.ReactNode }) {
  if (isSupabaseConfigured()) return <>{children}</>;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6">
      <div className="max-w-lg w-full rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-foreground mb-2">
          Supabase is not configured
        </h1>
        <p className="text-muted-foreground text-sm mb-4">
          This app requires a Supabase project. Set the following environment
          variables (e.g. in <code className="rounded bg-muted px-1">.env.local</code>)
          and restart the dev server:
        </p>
        <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-4 font-mono">
          <li><code>NEXT_PUBLIC_SUPABASE_URL</code></li>
          <li><code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code></li>
        </ul>
        <p className="text-muted-foreground text-sm">
          Then run the SQL migrations under{" "}
          <code className="rounded bg-muted px-1">apps/crm/supabase/migrations/</code>{" "}
          in your Supabase project (Dashboard → SQL Editor or Supabase CLI).
        </p>
      </div>
    </div>
  );
}
