"use client";

import { useCallback, useEffect, useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { supabaseBrowser } from "@/lib/supabase/browser";
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
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [cleanupBusy, setCleanupBusy] = useState(false);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);

    const supabase = supabaseBrowser();
    if (!supabase) {
      setError("Supabase is not configured.");
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

    if (queryError) {
      const errorMessage = String(queryError.message ?? queryError);
      if (errorMessage.includes("permission denied") || errorMessage.includes("row-level security") || errorMessage.includes("RLS")) {
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
  }, []);

  useEffect(() => {
    loadRows();
  }, [loadRows, refreshTrigger]);

  const handleStop = async (runId: string) => {
    setStoppingIds((prev) => new Set(prev).add(runId));
    try {
      const supabase = supabaseBrowser();
      if (supabase) {
        const res = await fetch("/api/rpa/cancel-runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runIds: [runId] }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "Failed to stop run.");
      }
      setRefreshTrigger((t) => t + 1);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setStoppingIds((prev) => {
        const next = new Set(prev);
        next.delete(runId);
        return next;
      });
    }
  };

  const handleDelete = async (runId: string) => {
    setDeletingIds((prev) => new Set(prev).add(runId));
    try {
      const supabase = supabaseBrowser();
      if (supabase) {
        const res = await fetch("/api/rpa/delete-runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runIds: [runId] }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "Failed to delete run.");
      }
      setRefreshTrigger((t) => t + 1);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(runId);
        return next;
      });
    }
  };

  const handleCleanup = async () => {
    setCleanupBusy(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      if (supabase) {
        const res = await fetch("/api/rpa/cleanup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clearVisitExtraction: false }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "Cleanup failed.");
        setRefreshTrigger((t) => t + 1);
      }
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setCleanupBusy(false);
    }
  };

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
          <div className="text-xs font-medium text-muted-foreground">Activity Log</div>
          <div className="text-lg font-semibold">Extraction Runs</div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCleanup}
          disabled={cleanupBusy || rows.length === 0}
        >
          {cleanupBusy ? "Cleaning…" : "Clean up all runs"}
        </Button>
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
            cell: (row) => {
              const isRunning = row.status === "running" || row.status === "in_progress";
              const isStopping = stoppingIds.has(row.id);
              const isDeleting = deletingIds.has(row.id);
              return (
                <div className="flex flex-wrap gap-2">
                  {isRunning ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleStop(row.id)}
                      disabled={isStopping}
                    >
                      {isStopping ? "Stopping…" : "Stop"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDelete(row.id)}
                    disabled={isDeleting}
                  >
                    {isDeleting ? "Deleting…" : "Delete"}
                  </Button>
                </div>
              );
            },
          },
        ]}
        empty="No extraction runs yet."
      />
    </div>
  );
}
