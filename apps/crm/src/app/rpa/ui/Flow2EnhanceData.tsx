"use client";

import { useEffect, useState, useMemo } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable, RowLink } from "@/components/ui/DataTable";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { StatusBadge, type Status } from "./StatusBadge";
import {
  formatDateDDMMYYYY,
  formatDateTimeDDMMYYYY,
  formatDateSingapore,
  getTodaySingapore,
  parseDateSingapore,
} from "@/lib/utils/date";
import { cn } from "@/lib/cn";
import FlowHeader from "./FlowHeader";

type VisitRow = {
  id: string;
  patient_name: string | null;
  visit_date: string | null;
  pay_type: string | null;
  nric: string | null;
  diagnosis_description: string | null;
  treatment_detail: string | null;
  extraction_metadata: {
    pcno?: string | null;
    detailsExtractionStatus?: string | null;
    detailsExtractedAt?: string | null;
    detailsExtractionLastAttempt?: string | null;
    diagnosisCode?: string | null;
    chargeType?: string | null;
    mcDays?: number | null;
    mcStartDate?: string | null;
    medicines?: Array<{ name?: string | null; quantity?: number | null }> | null;
  } | null;
  updated_at: string | null;
};

type FilterKey =
  | "all"
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "mhc"
  | "singlife"
  | "alliance"
  | "fullerton";

const filters: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
  { key: "mhc", label: "MHC" },
  { key: "singlife", label: "Singlife/Aviva" },
  { key: "alliance", label: "Alliance" },
  { key: "fullerton", label: "Fullerton" },
];

function normalizeStatus(value?: string | null): Status {
  if (value === "completed") return "completed";
  if (value === "failed") return "failed";
  if (value === "in_progress") return "in_progress";
  return "pending";
}

function shiftSingaporeDate(dateString: string, days: number): string {
  const d = parseDateSingapore(dateString);
  d.setDate(d.getDate() + days);
  return formatDateSingapore(d);
}

export default function Flow2EnhanceData() {
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [fromDate, setFromDate] = useState(() => shiftSingaporeDate(getTodaySingapore(), -6));
  const [toDate, setToDate] = useState(() => getTodaySingapore());
  const [portalOnly, setPortalOnly] = useState(true);
  const [queryKey, setQueryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);

      const supabase = supabaseBrowser();
      if (!supabase) {
        setError("Supabase is not configured.");
        setLoading(false);
        return;
      }

      const portalPayTypes = ["MHC", "FULLERT", "IHP", "ALL", "ALLIANZ", "AIA", "GE", "AIACLIENT", "AVIVA", "SINGLIFE"];

      let visitsQuery = supabase
        .from("visits")
        .select("id,patient_name,visit_date,pay_type,nric,diagnosis_description,treatment_detail,extraction_metadata,updated_at")
        .eq("source", "Clinic Assist")
        .order("visit_date", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(1000);

      if (fromDate) visitsQuery = visitsQuery.gte("visit_date", fromDate);
      if (toDate) visitsQuery = visitsQuery.lte("visit_date", toDate);
      if (portalOnly) visitsQuery = visitsQuery.in("pay_type", portalPayTypes);

      let pendingQuery = supabase
        .from("visits")
        .select("id", { count: "exact", head: true })
        .eq("source", "Clinic Assist")
        .is("extraction_metadata->>detailsExtractionStatus", null);
      if (fromDate) pendingQuery = pendingQuery.gte("visit_date", fromDate);
      if (toDate) pendingQuery = pendingQuery.lte("visit_date", toDate);
      if (portalOnly) pendingQuery = pendingQuery.in("pay_type", portalPayTypes);

      const [visitsRes, pendingRes] = await Promise.all([
        visitsQuery,
        pendingQuery,
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
      setRows((visitsRes.data ?? []) as VisitRow[]);
      if (!pendingRes.error) setPendingCount(pendingRes.count ?? 0);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fromDate, portalOnly, queryKey, toDate]);

  const handleDetailsExtract = async (retryFailed: boolean) => {
    setDetailsBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/rpa/extract-visit-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retryFailed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to start visit details extraction.");
      }
      setNotice(data?.message || "Visit details extraction started.");
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err) {
      setNotice(String((err as Error).message ?? err));
    } finally {
      setDetailsBusy(false);
    }
  };

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const metadata = row.extraction_metadata ?? {};
      const status = metadata.detailsExtractionStatus ?? null;
      const payType = (row.pay_type || "").toUpperCase();

      switch (filter) {
        case "pending":
          return status == null;
        case "in_progress":
          return status === "in_progress";
        case "completed":
          return status === "completed";
        case "failed":
          return status === "failed";
        case "mhc":
          return payType.includes("MHC");
        case "singlife":
          return payType.includes("SINGLIFE") || payType.includes("AVIVA");
        case "alliance":
          return payType.includes("ALLIANCE");
        case "fullerton":
          return payType.includes("FULLERT");
        default:
          return true;
      }
    });
  }, [filter, rows]);

  const metrics = {
    total: rows.length,
    pending: rows.filter((r) => !r.extraction_metadata?.detailsExtractionStatus).length,
    completed: rows.filter((r) => r.extraction_metadata?.detailsExtractionStatus === "completed").length,
    failed: rows.filter((r) => r.extraction_metadata?.detailsExtractionStatus === "failed").length,
    withPcno: rows.filter((r) => {
      const pcno = r.extraction_metadata?.pcno;
      return typeof pcno === "string" ? pcno.trim() !== "" : Boolean(pcno);
    }).length,
  };

  const flowStatus =
    metrics.failed > 0
      ? { label: "Needs attention", tone: "danger" as const }
      : metrics.pending > 0
        ? { label: "Pending", tone: "warning" as const }
        : { label: "Ready", tone: "success" as const };

  return (
    <div className="space-y-6">
      <FlowHeader
        flow="2"
        title="Enhance Data for Contract Organizations"
        description="Extract visit details (diagnosis, PCNO) for patients with contract organizations."
        accentClassName="border-emerald-200 bg-emerald-50 text-emerald-700"
        statusLabel={flowStatus.label}
        statusTone={flowStatus.tone}
      />

      <Card className="p-5">
        <div className="text-xs font-medium text-muted-foreground">Scope</div>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <div className="text-xs text-muted-foreground">From</div>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
            />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-muted-foreground">To</div>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 pb-1 text-sm">
            <input
              type="checkbox"
              checked={portalOnly}
              onChange={(e) => setPortalOnly(e.target.checked)}
              className="h-4 w-4 rounded border border-border"
            />
            <span className="text-sm">Portal pay types only</span>
          </label>
          <Button type="button" variant="outline" onClick={() => setQueryKey((k) => k + 1)}>
            Refresh
          </Button>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          Showing {portalOnly ? "portal-tagged visits" : "all visits"} between {fromDate} and {toDate}.
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-5">
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Total Visits</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.total}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Pending</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.pending}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Completed</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.completed}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Failed</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.failed}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">With PCNO</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.withPcno}</div>
        </Card>
      </div>

      <Card className="space-y-5">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Manual Trigger</div>
          <div className="text-lg font-semibold">Extract Visit Details</div>
          <div className="mt-2 text-sm text-muted-foreground">
            Starts the automation script to extract visit details (diagnosis, PCNO) from Clinic Assist.
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-sm font-medium">Extract Visit Details</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Pending visits: {pendingCount != null ? pendingCount : "--"}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => handleDetailsExtract(false)}
              disabled={detailsBusy}
            >
              {detailsBusy ? "Starting..." : "Start Extraction"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleDetailsExtract(true)}
              disabled={detailsBusy}
            >
              Retry Failed Only
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
            <div className="text-xs font-medium text-muted-foreground">Visits by Extraction Status</div>
            <div className="text-lg font-semibold">Clinic Assist Details</div>
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
              { header: "Visit Date", cell: (row) => formatDateDDMMYYYY(row.visit_date) ?? "--" },
              {
                header: "Pay Type",
                cell: (row) => row.pay_type ?? "--",
              },
              {
                header: "NRIC",
                cell: (row) => {
                  const nric = row.nric;
                  if (!nric) return <span className="text-red-700">Missing</span>;
                  return <span className="font-mono text-xs">{nric}</span>;
                },
              },
              {
                header: "PCNO",
                cell: (row) => row.extraction_metadata?.pcno ?? "--",
              },
              {
                header: "Status",
                cell: (row) => (
                  <StatusBadge
                    status={normalizeStatus(
                      row.extraction_metadata?.detailsExtractionStatus,
                    )}
                  />
                ),
              },
              {
                header: "Diagnosis Code",
                cell: (row) => {
                  const text = row.extraction_metadata?.diagnosisCode;
                  const hasDiagnosis = typeof text === "string" && text.trim() !== "";
                  return (
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2.5 py-1 text-xs font-medium",
                        hasDiagnosis
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-border bg-muted/50 text-muted-foreground",
                      )}
                      title={hasDiagnosis ? text : "Missing"}
                    >
                      {hasDiagnosis ? text : "Missing"}
                    </span>
                  );
                },
              },
              {
                header: "Diagnosis (Text)",
                cell: (row) => {
                  const text = row.diagnosis_description || "";
                  const cleaned = text.trim();
                  if (!cleaned) return <span className="text-muted-foreground">--</span>;
                  if (cleaned.toLowerCase() === "missing diagnosis") {
                    return <span className="text-muted-foreground">Missing</span>;
                  }
                  return (
                    <span title={cleaned} className="max-w-[320px] truncate">
                      {cleaned}
                    </span>
                  );
                },
              },
              {
                header: "Meds",
                cell: (row) => {
                  const meds = row.extraction_metadata?.medicines;
                  const fromArray = Array.isArray(meds) ? meds.filter((m) => (m?.name || "").toString().trim()).length : 0;
                  const fromText = (row.treatment_detail || "")
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean).length;
                  const count = Math.max(fromArray, fromText);
                  if (!count) return <span className="text-muted-foreground">--</span>;
                  return (
                    <span title={row.treatment_detail ?? undefined} className="text-sm">
                      {count}
                    </span>
                  );
                },
              },
              {
                header: "MC",
                cell: (row) => {
                  const days = row.extraction_metadata?.mcDays;
                  const start = row.extraction_metadata?.mcStartDate;
                  if (days == null) return <span className="text-muted-foreground">--</span>;
                  if (!days) return <span className="text-muted-foreground">0</span>;
                  return (
                    <span title={start ? `Start: ${start}` : undefined}>
                      {days}
                    </span>
                  );
                },
              },
              {
                header: "Charge",
                cell: (row) => {
                  const v = row.extraction_metadata?.chargeType;
                  if (!v) return <span className="text-muted-foreground">--</span>;
                  return <span className="uppercase">{v}</span>;
                },
              },
              {
                header: "Last Updated",
                cell: (row) => {
                  const metadata = row.extraction_metadata ?? {};
                  const lastUpdated =
                    metadata.detailsExtractedAt ??
                    metadata.detailsExtractionLastAttempt ??
                    row.updated_at;
                  return formatDateTimeDDMMYYYY(lastUpdated);
                },
              },
            ]}
            empty="No visits match the current filter."
          />
        )}
      </Card>
    </div>
  );
}
