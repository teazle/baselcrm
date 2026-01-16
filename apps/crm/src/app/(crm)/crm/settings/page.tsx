"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { isDemoMode } from "@/lib/env";

export default function SettingsPage() {
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      {isDemoMode() ? (
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="text-sm font-medium">Demo tools</div>
          <div className="mt-1 text-sm text-muted-foreground">
            You’re in Demo mode (localStorage). Use this to re-seed sample data after we adjust
            fields/relationships.
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                // Clear demo tables + demo auth
                const keys: string[] = [];
                for (let i = 0; i < localStorage.length; i++) {
                  const k = localStorage.key(i);
                  if (!k) continue;
                  if (k.startsWith("demo:table:") || k === "demo:userEmail") keys.push(k);
                }
                keys.forEach((k) => localStorage.removeItem(k));
                window.location.reload();
              }}
            >
              Reset demo data
            </Button>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Placeholder: Settings (users, roles, templates, branding) will go here.
      </div>
    </div>
  );
}


