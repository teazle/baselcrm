"use client";

import { useEffect, useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { isDemoMode } from "@/lib/env";
import { mockGetTable } from "@/lib/mock/storage";
import { StatusBadge, type Status } from "./StatusBadge";
import { formatDateTimeDDMMYYYY } from "@/lib/utils/date";

type RunRow = {
  id: string;
  run_type: string | null;
  status: string | null;
  started_at: string | null;
  finished_at: string | null;
  total_records: number | null;
  completed_count: number | null;
  failed_count: number | null;
  error_message: string | null;
};

function formatRunType(value?: string | null) {
  if (value === "queue_list") return "Queue List";
  if (value === "visit_details") return "Visit Details";
  return value ?? "--";
}

function normalizeStatus(value?: string | null): Status {
  if (value === "completed") return "completed";
  if (value === "failed") return "failed";
  if (value === "in_progress" || value === "running") return "in_progress";
  return "pending";
}

export default function ExtractionActivityLog() {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        const demoRows = mockGetTable("rpa_extraction_runs").slice(0, 50) as RunRow[];
        if (cancelled) return;
        setRows(demoRows);
        setLoading(false);
        return;
      }

      const { data, error: queryError } = await supabase
        .from("rpa_extraction_runs")
        .select(
          "id,run_type,status,started_at,finished_at,total_records,completed_count,failed_count,error_message",
        )
        .order("started_at", { ascending: false })
        .limit(30);

      if (cancelled) return;
      if (queryError) {
        const errorMessage = String(queryError.message ?? queryError);
        // Check for common RLS/permission errors
        if (errorMessage.includes('permission denied') || errorMessage.includes('row-level security') || errorMessage.includes('RLS')) {
          setError(`Database permission error: ${errorMessage}. Check RLS policies for 'rpa_extraction_runs' table. See docs/status/RPA_STATUS_AND_TROUBLESHOOTING.md`);
        } else {
          setError(errorMessage);
        }
        setRows([]);
        setLoading(false);
        return;
      }
      setRows((data ?? []) as RunRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      <div>
        <div className="text-xs font-medium text-muted-foreground">Activity Log</div>
        <div className="text-lg font-semibold">Extraction Runs</div>
      </div>
      <DataTable
        rows={rows}
        rowKey={(row) => row.id}
        columns={[
          { header: "Type", cell: (row) => formatRunType(row.run_type) },
          {
            header: "Status",
            cell: (row) => <StatusBadge status={normalizeStatus(row.status)} />,
          },
          { header: "Started", cell: (row) => formatDateTimeDDMMYYYY(row.started_at) },
          { header: "Finished", cell: (row) => formatDateTimeDDMMYYYY(row.finished_at) },
          {
            header: "Counts",
            cell: (row) => {
              const total = row.total_records ?? 0;
              const completed = row.completed_count ?? 0;
              const failed = row.failed_count ?? 0;
              return `${completed} completed / ${failed} failed / ${total} total`;
            },
          },
          {
            header: "Actions",
            cell: () => (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" disabled>
                  View
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled>
                  Retry
                </Button>
              </div>
            ),
          },
        ]}
        empty="No extraction runs yet."
      />
    </div>
  );
}
