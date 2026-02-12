"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getSupportedPortals, getUnsupportedPortals } from "@/lib/rpa/portals";
import { cn } from "@/lib/cn";

type PortalRow = {
  id: string;
  portal_code: string;
  label: string | null;
  status: "supported" | "unsupported" | string;
};

const statusStyles: Record<string, string> = {
  supported: "border-emerald-200 bg-emerald-50 text-emerald-700",
  unsupported: "border-amber-200 bg-amber-50 text-amber-700",
};

function normalizePortal(value: string) {
  return value.trim().toUpperCase();
}

export default function PortalSettings() {
  const [rows, setRows] = useState<PortalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newPortal, setNewPortal] = useState("");
  const [newStatus, setNewStatus] = useState<"supported" | "unsupported">("unsupported");
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);

    const supabase = supabaseBrowser();
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const { data, error: queryError } = await supabase
      .from("rpa_portals")
      .select("id,portal_code,label,status")
      .order("portal_code", { ascending: true });

    if (queryError) {
      setError(String(queryError.message ?? queryError));
      setRows([]);
      setLoading(false);
      return;
    }

    setRows((data ?? []) as PortalRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async () => {
    const code = normalizePortal(newPortal);
    if (!code) return;
    setBusy(true);
    setNotice(null);

    const supabase = supabaseBrowser();
    if (!supabase) {
      setNotice("Supabase not configured.");
      setBusy(false);
      return;
    }

    const { error: upsertError } = await supabase
      .from("rpa_portals")
      .upsert({ portal_code: code, label: code, status: newStatus }, { onConflict: "portal_code" });

    if (upsertError) {
      setNotice(String(upsertError.message ?? upsertError));
    } else {
      setNotice(`Portal ${code} saved.`);
      setNewPortal("");
      await load();
    }
    setBusy(false);
  };

  const handleSyncFromVisits = async () => {
    setSyncBusy(true);
    setNotice(null);

    const supabase = supabaseBrowser();
    if (!supabase) {
      setNotice("Supabase not configured.");
      setSyncBusy(false);
      return;
    }

    const { data: visits, error: visitsError } = await supabase
      .from("visits")
      .select("pay_type")
      .eq("source", "Clinic Assist")
      .limit(5000);

    if (visitsError) {
      setNotice(String(visitsError.message ?? visitsError));
      setSyncBusy(false);
      return;
    }

    const codes = Array.from(
      new Set(
        (visits ?? [])
          .map((row) => normalizePortal(row.pay_type ?? ""))
          .filter(Boolean),
      ),
    );

    if (codes.length === 0) {
      setNotice("No pay types found on visits.");
      setSyncBusy(false);
      return;
    }

    const { data: existing, error: existingError } = await supabase
      .from("rpa_portals")
      .select("portal_code")
      .in("portal_code", codes);

    if (existingError) {
      setNotice(String(existingError.message ?? existingError));
      setSyncBusy(false);
      return;
    }

    const existingSet = new Set(
      (existing ?? [])
        .map((row) => normalizePortal(row.portal_code))
        .filter(Boolean),
    );
    const missing = codes.filter((code) => !existingSet.has(code));

    if (missing.length === 0) {
      setNotice("All visit pay types already exist in portal settings.");
      setSyncBusy(false);
      return;
    }

    const payload = missing.map((code) => ({
      portal_code: code,
      label: code,
      status: "unsupported",
    }));

    const { error: insertError } = await supabase
      .from("rpa_portals")
      .insert(payload);

    if (insertError) {
      setNotice(String(insertError.message ?? insertError));
      setSyncBusy(false);
      return;
    }

    setNotice(`Synced ${missing.length} portal(s) from visits (added as unsupported).`);
    await load();
    setSyncBusy(false);
  };

  const handleToggle = async (row: PortalRow) => {
    const supabase = supabaseBrowser();
    if (!supabase) return;
    const nextStatus = row.status === "supported" ? "unsupported" : "supported";
    setBusy(true);
    const { error: updateError } = await supabase
      .from("rpa_portals")
      .update({ status: nextStatus })
      .eq("id", row.id);

    if (updateError) {
      setNotice(String(updateError.message ?? updateError));
    }
    await load();
    setBusy(false);
  };

  const handleDelete = async (row: PortalRow) => {
    const supabase = supabaseBrowser();
    if (!supabase) return;
    setBusy(true);
    const { error: deleteError } = await supabase
      .from("rpa_portals")
      .delete()
      .eq("id", row.id);

    if (deleteError) {
      setNotice(String(deleteError.message ?? deleteError));
    } else {
      setNotice(`Portal ${row.portal_code} removed.`);
    }
    await load();
    setBusy(false);
  };

  const supportedCount = useMemo(() => rows.filter((r) => r.status === "supported").length, [rows]);
  const unsupportedCount = useMemo(() => rows.filter((r) => r.status === "unsupported").length, [rows]);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-medium text-muted-foreground">RPA Settings</div>
        <div className="text-2xl font-semibold">Portal Configuration</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Manage which portals are implemented (supported) vs not done yet (unsupported). New pay types from
          extracted Excel will be auto-added as unsupported.
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Total Portals</div>
          <div className="mt-2 text-2xl font-semibold">{rows.length}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Supported</div>
          <div className="mt-2 text-2xl font-semibold">{supportedCount}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Unsupported</div>
          <div className="mt-2 text-2xl font-semibold">{unsupportedCount}</div>
        </Card>
      </div>

      <Card className="space-y-4">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Add Portal</div>
          <div className="text-lg font-semibold">Add or Update Portal</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={newPortal}
            onChange={(event) => setNewPortal(event.target.value)}
            placeholder="e.g. ALLIANCE"
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
          />
          <select
            value={newStatus}
            onChange={(event) => setNewStatus(event.target.value as "supported" | "unsupported")}
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
          >
            <option value="supported">Supported</option>
            <option value="unsupported">Unsupported</option>
          </select>
          <Button type="button" onClick={handleAdd} disabled={busy || !newPortal.trim()}>
            {busy ? "Saving..." : "Save Portal"}
          </Button>
          <Button type="button" variant="outline" onClick={handleSyncFromVisits} disabled={syncBusy}>
            {syncBusy ? "Syncing..." : "Sync portals from visits"}
          </Button>
        </div>
        {notice ? (
          <div className="rounded-2xl border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
            {notice}
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="mb-4">
          <div className="text-xs font-medium text-muted-foreground">Current Portals</div>
          <div className="text-lg font-semibold">Supported vs Unsupported</div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
            Loading...
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-border bg-muted/50 p-6 text-sm text-muted-foreground">
            No portals configured yet.
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm"
              >
                <div>
                  <div className="font-medium">{row.portal_code}</div>
                  {row.label ? (
                    <div className="text-xs text-muted-foreground">{row.label}</div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2.5 py-1 text-xs font-medium",
                      statusStyles[row.status] || "border-border bg-muted/50 text-muted-foreground",
                    )}
                  >
                    {row.status === "supported" ? "Supported" : "Unsupported"}
                  </span>
                  <Button type="button" variant="outline" onClick={() => handleToggle(row)} disabled={busy}>
                    Toggle
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => handleDelete(row)} disabled={busy}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
