"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth/AuthProvider";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getSupportedPortals, getUnsupportedPortals } from "@/lib/rpa/portals";
import { cn } from "@/lib/cn";

type PortalRow = {
  id: string;
  portal_code: string;
  label: string | null;
  status: "supported" | "unsupported" | string;
};

type PortalCredentialApiRow = {
  portal_target: string;
  label: string | null;
  portal_url: string | null;
  is_active: boolean;
  has_username: boolean;
  has_password: boolean;
  updated_at: string | null;
};

type CredentialDraft = {
  label: string;
  portal_url: string;
  username: string;
  password: string;
  is_active: boolean;
  has_username: boolean;
  has_password: boolean;
  updated_at: string | null;
};

const serviceTargets: Array<{ target: string; label: string; defaultUrl: string }> = [
  { target: "MHC", label: "MHC / AIA / AVIVA / SINGLIFE / MHCAXA", defaultUrl: "https://www.mhcasia.net/mhc/" },
  {
    target: "ALLIANCE_MEDINET",
    label: "Alliance Medinet",
    defaultUrl: "https://connect.alliancemedinet.com/login",
  },
  {
    target: "ALLIANZ",
    label: "Allianz Worldwide Care",
    defaultUrl: "https://my.allianzworldwidecare.com/sol/login.do",
  },
  {
    target: "FULLERTON",
    label: "Fullerton Health",
    defaultUrl: "https://doctor.fhn3.com/app_index",
  },
  { target: "IHP", label: "IHP eClaim", defaultUrl: "https://eclaim.ihp.com.sg/eclaim/login.asp" },
  { target: "IXCHANGE", label: "IXCHANGE SPOS", defaultUrl: "https://spos.o2ixchange.com/login" },
  { target: "GE_NTUC", label: "GE / NTUC IM", defaultUrl: "" },
];

const statusStyles: Record<string, string> = {
  supported: "border-emerald-200 bg-emerald-50 text-emerald-700",
  unsupported: "border-amber-200 bg-amber-50 text-amber-700",
};

function normalizePortal(value: string) {
  return value.trim().toUpperCase();
}

function defaultDraftForTarget(target: string): CredentialDraft {
  const cfg = serviceTargets.find((item) => item.target === target);
  return {
    label: cfg?.label || target,
    portal_url: cfg?.defaultUrl || "",
    username: "",
    password: "",
    is_active: true,
    has_username: false,
    has_password: false,
    updated_at: null,
  };
}

async function callPortalCredentialApi<T>(
  accessToken: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("/api/rpa/portal-credentials", {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const json = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    throw new Error(String(json?.error || `Request failed (${response.status})`));
  }
  return json;
}

export default function PortalSettings() {
  const { session, isLoading: authLoading } = useAuth();
  const accessToken = session?.access_token || null;

  const [rows, setRows] = useState<PortalRow[]>([]);
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, CredentialDraft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credentialNotice, setCredentialNotice] = useState<string | null>(null);
  const [credentialTableError, setCredentialTableError] = useState<string | null>(null);
  const [newPortal, setNewPortal] = useState("");
  const [newStatus, setNewStatus] = useState<"supported" | "unsupported">("unsupported");
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [credentialBusyTarget, setCredentialBusyTarget] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    setCredentialTableError(null);

    const supabase = supabaseBrowser();
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const portalRes = await supabase
      .from("rpa_portals")
      .select("id,portal_code,label,status")
      .order("portal_code", { ascending: true });

    if (portalRes.error) {
      setError(String(portalRes.error.message ?? portalRes.error));
      setRows([]);
      setLoading(false);
      return;
    }

    setRows((portalRes.data ?? []) as PortalRow[]);

    if (!accessToken) {
      const fallback: Record<string, CredentialDraft> = {};
      for (const target of serviceTargets) {
        fallback[target.target] = defaultDraftForTarget(target.target);
      }
      setCredentialDrafts(fallback);
      setCredentialTableError("No login session found for credential API.");
      setLoading(false);
      return;
    }

    try {
      const result = await callPortalCredentialApi<{ rows: PortalCredentialApiRow[] }>(accessToken, "GET");
      const loadedRows = Array.isArray(result?.rows) ? result.rows : [];
      const nextDrafts: Record<string, CredentialDraft> = {};

      for (const target of serviceTargets) {
        const row = loadedRows.find((item) => item.portal_target === target.target);
        nextDrafts[target.target] = {
          label: row?.label || target.label,
          portal_url: row?.portal_url || target.defaultUrl,
          username: "",
          password: "",
          is_active: row?.is_active !== false,
          has_username: row?.has_username === true,
          has_password: row?.has_password === true,
          updated_at: row?.updated_at || null,
        };
      }
      setCredentialDrafts(nextDrafts);
    } catch (apiError) {
      const fallback: Record<string, CredentialDraft> = {};
      for (const target of serviceTargets) {
        fallback[target.target] = defaultDraftForTarget(target.target);
      }
      setCredentialDrafts(fallback);
      setCredentialTableError(String((apiError as Error).message || apiError));
    }

    setLoading(false);
  };

  useEffect(() => {
    if (authLoading) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, accessToken]);

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
      new Set((visits ?? []).map((row) => normalizePortal(row.pay_type ?? "")).filter(Boolean)),
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

    const existingSet = new Set((existing ?? []).map((row) => normalizePortal(row.portal_code)).filter(Boolean));
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

    const { error: insertError } = await supabase.from("rpa_portals").insert(payload);

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
    const { error: updateError } = await supabase.from("rpa_portals").update({ status: nextStatus }).eq("id", row.id);

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
    const { error: deleteError } = await supabase.from("rpa_portals").delete().eq("id", row.id);

    if (deleteError) {
      setNotice(String(deleteError.message ?? deleteError));
    } else {
      setNotice(`Portal ${row.portal_code} removed.`);
    }
    await load();
    setBusy(false);
  };

  const handleCredentialChange = (target: string, field: keyof CredentialDraft, value: string | boolean | null) => {
    setCredentialDrafts((prev) => {
      const current = prev[target] || defaultDraftForTarget(target);
      return {
        ...prev,
        [target]: {
          ...current,
          [field]: value,
        },
      };
    });
  };

  const handleSaveCredential = async (target: string) => {
    if (!accessToken) {
      setCredentialNotice("Missing login token. Please refresh and log in again.");
      return;
    }

    const draft = credentialDrafts[target] || defaultDraftForTarget(target);

    setCredentialBusyTarget(target);
    setCredentialNotice(null);

    try {
      await callPortalCredentialApi<{ ok: boolean }>(accessToken, "POST", {
        portal_target: target,
        label: String(draft.label || target).trim() || target,
        portal_url: String(draft.portal_url || "").trim() || null,
        is_active: Boolean(draft.is_active),
        ...(String(draft.username || "").trim() ? { username: String(draft.username).trim() } : {}),
        ...(String(draft.password || "").trim() ? { password: String(draft.password).trim() } : {}),
      });

      setCredentialNotice(`Saved credentials for ${target}.`);
      await load();
    } catch (saveError) {
      setCredentialNotice(String((saveError as Error).message || saveError));
    }

    setCredentialBusyTarget(null);
  };

  const handleClearCredentialSecret = async (target: string, field: "username" | "password") => {
    if (!accessToken) {
      setCredentialNotice("Missing login token. Please refresh and log in again.");
      return;
    }

    setCredentialBusyTarget(target);
    setCredentialNotice(null);

    try {
      await callPortalCredentialApi<{ ok: boolean }>(accessToken, "POST", {
        portal_target: target,
        ...(field === "username" ? { clearUsername: true } : {}),
        ...(field === "password" ? { clearPassword: true } : {}),
      });
      setCredentialNotice(
        field === "username"
          ? `Cleared saved username for ${target}.`
          : `Cleared saved password for ${target}.`,
      );
      await load();
    } catch (clearError) {
      setCredentialNotice(String((clearError as Error).message || clearError));
    }

    setCredentialBusyTarget(null);
  };

  const supportedCount = useMemo(() => rows.filter((r) => r.status === "supported").length, [rows]);
  const unsupportedCount = useMemo(() => rows.filter((r) => r.status === "unsupported").length, [rows]);

  const fallbackSupportedCount = useMemo(() => getSupportedPortals().length, []);
  const fallbackUnsupportedCount = useMemo(() => getUnsupportedPortals().length, []);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-medium text-muted-foreground">RPA Settings</div>
        <div className="text-2xl font-semibold">Portal Configuration</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Manage implemented portal tags and configure per-TPA portal credentials for Flow 3 runtime.
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Total Portals</div>
          <div className="mt-2 text-2xl font-semibold">{rows.length || fallbackSupportedCount + fallbackUnsupportedCount}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Supported</div>
          <div className="mt-2 text-2xl font-semibold">{supportedCount || fallbackSupportedCount}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Unsupported</div>
          <div className="mt-2 text-2xl font-semibold">{unsupportedCount || fallbackUnsupportedCount}</div>
        </Card>
      </div>

      <Card className="space-y-4">
        <div>
          <div className="text-xs font-medium text-muted-foreground">TPA Credentials</div>
          <div className="text-lg font-semibold">Portal URL / Username / Password</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Credentials are managed through a backend API and stored encrypted when key is configured.
          </div>
        </div>

        {credentialTableError ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Credential service not ready: {credentialTableError}. Check migration and server env.
          </div>
        ) : (
          <div className="space-y-3">
            {serviceTargets.map((service) => {
              const draft = credentialDrafts[service.target] || defaultDraftForTarget(service.target);
              return (
                <div
                  key={service.target}
                  className="space-y-3 rounded-xl border border-border bg-card px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">{service.target}</div>
                      <div className="text-xs text-muted-foreground">{service.label}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Username: {draft.has_username ? "Configured" : "Not set"} | Password: {draft.has_password ? "Configured" : "Not set"}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={draft.is_active}
                        onChange={(event) => handleCredentialChange(service.target, "is_active", event.target.checked)}
                        className="h-4 w-4 rounded border border-border"
                      />
                      Active
                    </label>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <input
                      type="text"
                      value={draft.portal_url}
                      onChange={(event) => handleCredentialChange(service.target, "portal_url", event.target.value)}
                      placeholder="Portal URL"
                      className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
                    />
                    <input
                      type="text"
                      value={draft.username}
                      onChange={(event) => handleCredentialChange(service.target, "username", event.target.value)}
                      placeholder="Set new username (leave blank to keep)"
                      className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
                    />
                    <input
                      type="password"
                      value={draft.password}
                      onChange={(event) => handleCredentialChange(service.target, "password", event.target.value)}
                      placeholder="Set new password (leave blank to keep)"
                      className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
                    />
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleClearCredentialSecret(service.target, "username")}
                      disabled={credentialBusyTarget === service.target || !draft.has_username}
                    >
                      Clear Username
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleClearCredentialSecret(service.target, "password")}
                      disabled={credentialBusyTarget === service.target || !draft.has_password}
                    >
                      Clear Password
                    </Button>
                    <Button
                      type="button"
                      onClick={() => handleSaveCredential(service.target)}
                      disabled={credentialBusyTarget === service.target}
                    >
                      {credentialBusyTarget === service.target ? "Saving..." : "Save Credentials"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {credentialNotice ? (
          <div className="rounded-2xl border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
            {credentialNotice}
          </div>
        ) : null}
      </Card>

      <Card className="space-y-4">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Add Portal Tag</div>
          <div className="text-lg font-semibold">Add or Update Portal Tag Status</div>
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
          <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Loading...</div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
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
                  {row.label ? <div className="text-xs text-muted-foreground">{row.label}</div> : null}
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
