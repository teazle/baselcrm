"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable, RowLink } from "@/components/ui/DataTable";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { isDemoMode } from "@/lib/env";
import { mockGetTable } from "@/lib/mock/storage";
import { formatDateTimeSingapore } from "@/lib/utils/date";
import { cn } from "@/lib/cn";
import { getSupportedPortals, getUnsupportedPortals, isSupportedPortal, isUnsupportedPortal } from "@/lib/rpa/portals";

type VisitRow = {
  id: string;
  patient_name: string | null;
  visit_date: string | null;
  pay_type: string | null;
  submission_status: string | null;
  submitted_at: string | null;
  submission_metadata: Record<string, any> | null;
  extraction_metadata: {
    nric?: string | null;
  } | null;
};

type FilterKey = "all" | "draft" | "submitted" | "not_started" | "error";

const filters: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "draft", label: "Processed (draft)" },
  { key: "submitted", label: "Processed (submitted)" },
  { key: "not_started", label: "Not started" },
  { key: "error", label: "Error" },
];

function formatDateTime(value?: string | null) {
  return formatDateTimeSingapore(value);
}

export default function Flow3FillForms() {
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [portalConfig, setPortalConfig] = useState<{
    supported: Set<string>;
    unsupported: Set<string>;
  } | null>(null);

  const normalizePortal = (value?: string | null) => {
    if (!value) return null;
    const code = String(value).trim().toUpperCase();
    return code.length > 0 ? code : null;
  };

  const isSupported = (payType?: string | null) => {
    const code = normalizePortal(payType);
    if (!code) return false;
    if (portalConfig) return portalConfig.supported.has(code);
    return isSupportedPortal(code);
  };

  const isUnsupported = (payType?: string | null) => {
    const code = normalizePortal(payType);
    if (!code) return false;
    if (portalConfig) return portalConfig.unsupported.has(code);
    return isUnsupportedPortal(code);
  };

  const getSubmissionStatus = (visit: VisitRow): "draft" | "submitted" | "error" | "not_started" => {
    const status = visit.submission_status;
    const payType = visit.pay_type;

    // Status precedence: error > submitted > draft > not_started
    if (status === "error") return "error";
    if (status === "submitted") return "submitted";
    if (status === "draft") return "draft";

    // Not started: status is null AND portal is unsupported
    if (!status && payType && isUnsupported(payType)) {
      return "not_started";
    }

    // Also not started if status is null (even for supported portals that haven't been processed)
    if (!status) return "not_started";

    return "not_started";
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);

      const supabase = supabaseBrowser();
      if (!supabase) {
        if (!isDemoMode()) {
          setError("Supabase is not configured.");
          setLoading(false);
          return;
        }

        const demoRows = (mockGetTable("visits") as Array<Record<string, any>>)
          .filter((row) => row?.source === "Clinic Assist")
          .slice(0, 200) as VisitRow[];
        setPortalConfig({
          supported: new Set(getSupportedPortals()),
          unsupported: new Set(getUnsupportedPortals()),
        });
        if (cancelled) return;
        setRows(demoRows);
        setLoading(false);
        return;
      }

      const [visitsRes, portalsRes] = await Promise.all([
        supabase
          .from("visits")
          .select("id,patient_name,visit_date,pay_type,submission_status,submitted_at,submission_metadata,extraction_metadata")
          .eq("source", "Clinic Assist")
          .order("visit_date", { ascending: false })
          .limit(200),
        supabase
          .from("rpa_portals")
          .select("portal_code,status"),
      ]);

      if (cancelled) return;
      if (visitsRes.error) {
        const errorMessage = String(visitsRes.error.message ?? visitsRes.error);
        if (errorMessage.includes('permission denied') || errorMessage.includes('row-level security') || errorMessage.includes('RLS')) {
          setError(`Database permission error: ${errorMessage}. Check RLS policies for 'visits' table.`);
        } else {
          setError(errorMessage);
        }
        setRows([]);
        setLoading(false);
        return;
      }
      if (!portalsRes.error && portalsRes.data) {
        if (portalsRes.data.length === 0) {
          setPortalConfig({
            supported: new Set(getSupportedPortals()),
            unsupported: new Set(getUnsupportedPortals()),
          });
        } else {
          const supported = new Set<string>();
          const unsupported = new Set<string>();
          portalsRes.data.forEach((row) => {
            const code = normalizePortal(row.portal_code);
            if (!code) return;
            if (row.status === "supported") {
              supported.add(code);
            } else {
              unsupported.add(code);
            }
          });
          setPortalConfig({ supported, unsupported });
        }
      } else {
        setPortalConfig({
          supported: new Set(getSupportedPortals()),
          unsupported: new Set(getUnsupportedPortals()),
        });
      }
      setRows((visitsRes.data ?? []) as VisitRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmitClaims = async (visitIds?: string[], saveAsDraft?: boolean) => {
    setSubmitBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/rpa/flow3/submit-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitIds, saveAsDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to start claim submission.");
      }
      setNotice(data?.message || "Claim submission started.");
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err) {
      setNotice(String((err as Error).message ?? err));
    } finally {
      setSubmitBusy(false);
    }
  };

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const status = getSubmissionStatus(row);
      switch (filter) {
        case "draft":
          return status === "draft";
        case "submitted":
          return status === "submitted";
        case "not_started":
          return status === "not_started";
        case "error":
          return status === "error";
        default:
          return true;
      }
    });
  }, [filter, rows, portalConfig]);

  const metrics = useMemo(() => {
    const draft = rows.filter((r) => getSubmissionStatus(r) === "draft").length;
    const submitted = rows.filter((r) => getSubmissionStatus(r) === "submitted").length;
    const notStarted = rows.filter((r) => getSubmissionStatus(r) === "not_started").length;
    const error = rows.filter((r) => getSubmissionStatus(r) === "error").length;
    return { draft, submitted, notStarted, error, total: rows.length };
  }, [rows, portalConfig]);

  const draftIds = useMemo(
    () => rows.filter((r) => getSubmissionStatus(r) === "draft").map((r) => r.id),
    [rows, portalConfig],
  );

  const errorIds = useMemo(
    () => rows.filter((r) => getSubmissionStatus(r) === "error").map((r) => r.id),
    [rows, portalConfig],
  );

  const getStatusLabel = (visit: VisitRow) => {
    const status = getSubmissionStatus(visit);
    if (status === "draft") return "Processed (draft)";
    if (status === "submitted") return "Processed (submitted)";
    if (status === "error") return "Error";
    return "Not started";
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-medium text-muted-foreground">Flow 3</div>
        <div className="text-2xl font-semibold">Fill Claim Forms</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Submit claim forms to respective portals (MHC, Alliance, Fullerton, etc.).
        </div>
      </div>

      {portalConfig && portalConfig.supported.size === 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          No supported portals are configured. Configure supported portals in{" "}
          <Link href="/rpa/settings" className="underline underline-offset-2">
            RPA Settings
          </Link>{" "}
          before submitting claims.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-5">
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Total Claims</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.total}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Processed (draft)</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.draft}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Processed (submitted)</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.submitted}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Not started</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.notStarted}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Error</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.error}</div>
        </Card>
      </div>

      <Card className="space-y-5">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Manual Trigger</div>
          <div className="text-lg font-semibold">Submit Claims</div>
          <div className="mt-2 text-sm text-muted-foreground">
            Submit claims to respective portals. Select specific visits or submit all pending.
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="text-sm font-medium">Submit Claims</div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => handleSubmitClaims(undefined, false)}
              disabled={submitBusy}
            >
              {submitBusy ? "Starting..." : "Submit All Pending"}
            </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleSubmitClaims(undefined, true)}
                disabled={submitBusy}
              >
                Save All as Draft
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleSubmitClaims(draftIds, false)}
                disabled={submitBusy || draftIds.length === 0}
              >
                Submit Drafts ({draftIds.length})
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleSubmitClaims(errorIds, false)}
                disabled={submitBusy || errorIds.length === 0}
              >
                Retry Errors ({errorIds.length})
              </Button>
            </div>
          </div>

        {notice ? (
          <div className="rounded-2xl border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
            {notice}
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-muted-foreground">Claim Submission Status</div>
            <div className="text-lg font-semibold">All Portals</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {filters.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  filter === tab.key
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:bg-muted",
                )}
                onClick={() => setFilter(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
            Loading...
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <DataTable
            rows={filtered}
            rowKey={(row) => row.id}
            columns={[
              {
                header: "Patient",
                cell: (row) => (
                  <RowLink href={`/crm/visits/${row.id}`}>
                    {row.patient_name ?? "--"}
                  </RowLink>
                ),
              },
              { header: "Visit Date", cell: (row) => row.visit_date ?? "--" },
              {
                header: "Portal",
                cell: (row) => {
                  const payType = row.pay_type || "--";
                  const supported = payType !== "--" && isSupported(payType);
                  const unsupported = payType !== "--" && isUnsupported(payType);
                  return (
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2.5 py-1 text-xs font-medium",
                        supported
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : unsupported
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-border bg-muted/50 text-muted-foreground",
                      )}
                    >
                      {payType}
                    </span>
                  );
                },
              },
              {
                header: "Status",
                cell: (row) => {
                  const status = getSubmissionStatus(row);
                  const label = getStatusLabel(row);
                  return (
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2.5 py-1 text-xs font-medium",
                        status === "submitted"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : status === "draft"
                            ? "border-blue-200 bg-blue-50 text-blue-700"
                            : status === "error"
                              ? "border-red-200 bg-red-50 text-red-700"
                              : "border-border bg-muted/50 text-muted-foreground",
                      )}
                    >
                      {label}
                    </span>
                  );
                },
              },
              {
                header: "Processed At",
                cell: (row) => {
                  const status = getSubmissionStatus(row);
                  const draftedAt = row.submission_metadata?.drafted_at;
                  const processedAt = status === "draft" ? (draftedAt || row.submitted_at) : row.submitted_at;
                  return formatDateTime(processedAt) || "--";
                },
              },
              {
                header: "Metadata",
                cell: (row) => {
                  const metadata = row.submission_metadata;
                  if (!metadata) return "--";
                  const portal = metadata.portal || "--";
                  const savedAsDraft = metadata.savedAsDraft;
                  return (
                    <div className="text-xs space-y-1">
                      <div>Portal: {portal}</div>
                      {savedAsDraft && <div className="text-muted-foreground">Saved as draft</div>}
                    </div>
                  );
                },
              },
            ]}
            empty="No claims match the current filter."
          />
        )}
      </Card>
    </div>
  );
}
