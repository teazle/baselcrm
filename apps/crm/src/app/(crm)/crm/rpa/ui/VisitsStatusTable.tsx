"use client";

import { useEffect, useMemo, useState } from "react";
import { DataTable, RowLink } from "@/components/ui/DataTable";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/cn";
import { StatusBadge, type Status } from "./StatusBadge";
import { formatDateTimeSingapore } from "@/lib/utils/date";

type VisitRow = {
  id: string;
  patient_name: string | null;
  visit_date: string | null;
  diagnosis_description: string | null;
  extraction_metadata: {
    pcno?: string | null;
    detailsExtractionStatus?: string | null;
    detailsExtractedAt?: string | null;
    detailsExtractionLastAttempt?: string | null;
    diagnosisCode?: string | null;
  } | null;
  updated_at: string | null;
};

type FilterKey =
  | "all"
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "with_pcno"
  | "without_pcno";

const filters: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
  { key: "with_pcno", label: "With PCNO" },
  { key: "without_pcno", label: "Without PCNO" },
];

function formatDateTime(value?: string | null) {
  return formatDateTimeSingapore(value);
}

function normalizeStatus(value?: string | null): Status {
  if (value === "completed") return "completed";
  if (value === "failed") return "failed";
  if (value === "in_progress") return "in_progress";
  return "pending";
}

export default function VisitsStatusTable() {
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

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

      const { data, error: queryError } = await supabase
        .from("visits")
        .select(
          "id,patient_name,visit_date,diagnosis_description,extraction_metadata,updated_at",
        )
        .eq("source", "Clinic Assist")
        .order("visit_date", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(200);

      if (cancelled) return;
      if (queryError) {
        const errorMessage = String(queryError.message ?? queryError);
        // Check for common RLS/permission errors
        if (errorMessage.includes('permission denied') || errorMessage.includes('row-level security') || errorMessage.includes('RLS')) {
          setError(`Database permission error: ${errorMessage}. Check RLS policies for 'visits' table. See docs/status/RPA_STATUS_AND_TROUBLESHOOTING.md`);
        } else {
          setError(errorMessage);
        }
        setRows([]);
        setLoading(false);
        return;
      }
      setRows((data ?? []) as VisitRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const metadata = row.extraction_metadata ?? {};
      const status = metadata.detailsExtractionStatus ?? null;
      const pcno = metadata.pcno;
      const hasPcno =
        typeof pcno === "string" ? pcno.trim() !== "" : Boolean(pcno);
      switch (filter) {
        case "pending":
          return status == null;
        case "in_progress":
          return status === "in_progress";
        case "completed":
          return status === "completed";
        case "failed":
          return status === "failed";
        case "with_pcno":
          return hasPcno;
        case "without_pcno":
          return !hasPcno;
        default:
          return true;
      }
    });
  }, [filter, rows]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-muted-foreground">
            Visits by Extraction Status
          </div>
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
            header: "Diagnosis",
            cell: (row) => {
              const text = row.diagnosis_description;
              const hasDiagnosis =
                typeof text === "string" &&
                text.trim() !== "" &&
                text.trim().toLowerCase() !== "missing diagnosis";
              return (
                <span
                  className={cn(
                    "inline-flex rounded-full border px-2.5 py-1 text-xs font-medium",
                    hasDiagnosis
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-border bg-muted/50 text-muted-foreground",
                  )}
                >
                  {hasDiagnosis ? "Present" : "Missing"}
                </span>
              );
            },
          },
          {
            header: "Diagnosis Code",
            cell: (row) => row.extraction_metadata?.diagnosisCode ?? "--",
          },
          {
            header: "Last Updated",
            cell: (row) => {
              const metadata = row.extraction_metadata ?? {};
              const lastUpdated =
                metadata.detailsExtractedAt ??
                metadata.detailsExtractionLastAttempt ??
                row.updated_at;
              return formatDateTime(lastUpdated);
            },
          },
        ]}
        empty="No visits match the current filter."
      />
    </div>
  );
}
