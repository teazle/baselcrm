"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { StatusBadge, type Status } from "./StatusBadge";
import FlowHeader from "./FlowHeader";
import { formatDateDDMMYYYY, formatDateTimeDDMMYYYY } from "@/lib/utils/date";
import { getTodaySingapore } from "@/lib/utils/date";

type RunRow = {
  id: string;
  run_type: string | null;
  status: string | null;
  started_at: string | null;
  finished_at: string | null;
  total_records: number | null;
  completed_count: number | null;
  failed_count: number | null;
  metadata: Record<string, any> | null;
};

function normalizeStatus(value?: string | null): Status {
  if (value === "completed") return "completed";
  if (value === "failed") return "failed";
  if (value === "in_progress" || value === "running") return "in_progress";
  return "pending";
}

export default function Flow1ExtractExcel() {
  const [queueDate, setQueueDate] = useState(() => getTodaySingapore());
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const loadRuns = useCallback(async () => {
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
      .select("*")
      .eq("run_type", "queue_list")
      .order("started_at", { ascending: false })
      .limit(20);

    if (queryError) {
      const errorMessage = String(queryError.message ?? queryError);
      if (errorMessage.includes('permission denied') || errorMessage.includes('row-level security') || errorMessage.includes('RLS')) {
        setError(`Database permission error: ${errorMessage}. Check RLS policies for 'rpa_extraction_runs' table.`);
      } else {
        setError(errorMessage);
      }
      setRuns([]);
      setLoading(false);
      return;
    }
    setRuns((data ?? []) as RunRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadRuns();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRuns]);

  const handleQueueExtract = async () => {
    setQueueBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/rpa/extract-queue-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: queueDate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to start queue extraction.");
      }
      setNotice(data?.message || "Queue list extraction started.");
      // Reload runs after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err) {
      setNotice(String((err as Error).message ?? err));
    } finally {
      setQueueBusy(false);
    }
  };

  const handleCancelRun = async (runId: string) => {
    setCancellingIds((prev) => new Set(prev).add(runId));
    try {
      const supabase = supabaseBrowser();
      if (supabase) {
        const res = await fetch("/api/rpa/cancel-runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runIds: [runId] }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Failed to cancel run.");
        setNotice(data?.message || "Run cancelled successfully.");
      }
      setRuns((prevRuns) =>
        prevRuns.map((run) =>
          run.id === runId
            ? { ...run, status: "failed", finished_at: new Date().toISOString(), error_message: "Cancelled by user" }
            : run
        )
      );
      await loadRuns();
    } catch (err) {
      setNotice(String((err as Error).message ?? err));
    } finally {
      setCancellingIds((prev) => {
        const next = new Set(prev);
        next.delete(runId);
        return next;
      });
    }
  };

  const handleDeleteRun = async (runId: string) => {
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
        if (!res.ok) throw new Error(data?.error || "Failed to delete run.");
        setNotice(data?.message || "Run deleted.");
      }
      setRuns((prev) => prev.filter((r) => r.id !== runId));
    } catch (err) {
      setNotice(String((err as Error).message ?? err));
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(runId);
        return next;
      });
    }
  };

  const metrics = {
    total: runs.length,
    completed: runs.filter((r) => r.status === "completed").length,
    failed: runs.filter((r) => r.status === "failed").length,
    running: runs.filter((r) => r.status === "running").length,
  };

  const flowStatus =
    metrics.running > 0
      ? { label: "Running", tone: "warning" as const }
      : metrics.failed > 0
        ? { label: "Needs attention", tone: "danger" as const }
        : { label: "Ready", tone: "success" as const };

  return (
    <div className="space-y-6">
      <FlowHeader
        flow="1"
        title="Extract Excel from Clinic Assist"
        description="Extract queue list data from Clinic Assist and save to database."
        accentClassName="border-blue-200 bg-blue-50 text-blue-700"
        statusLabel={flowStatus.label}
        statusTone={flowStatus.tone}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Total Runs</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.total}</div>
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
          <div className="text-xs text-muted-foreground">Running</div>
          <div className="mt-2 text-2xl font-semibold">{metrics.running}</div>
        </Card>
      </div>

      <Card className="space-y-5">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Manual Trigger</div>
          <div className="text-lg font-semibold">Extract Queue List</div>
          <div className="mt-2 text-sm text-muted-foreground">
            Starts the automation script to extract queue list data for the selected date.
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-sm font-medium">Extract Queue List</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <input
              type="date"
              value={queueDate}
              onChange={(event) => setQueueDate(event.target.value)}
              className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
            />
            <Button
              type="button"
              onClick={handleQueueExtract}
              disabled={queueBusy}
            >
              {queueBusy ? "Starting..." : "Extract Queue List"}
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
        <div className="mb-4">
          <div className="text-xs font-medium text-muted-foreground">Activity Log</div>
          <div className="text-lg font-semibold">Extraction Runs</div>
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
            rows={runs}
            rowKey={(row) => row.id}
            columns={[
              {
                header: "Extraction Time",
                cell: (row) => formatDateTimeDDMMYYYY(row.started_at) || "--",
              },
              {
                header: "Status",
                cell: (row) => <StatusBadge status={normalizeStatus(row.status)} />,
              },
              {
                header: "Date",
                cell: (row) => {
                  const dateStr = row.metadata?.date || row.started_at;
                  return dateStr ? formatDateDDMMYYYY(dateStr) : "--";
                },
              },
              {
                header: "Records",
                cell: (row) => {
                  const total = row.total_records ?? 0;
                  const completed = row.completed_count ?? 0;
                  const failed = row.failed_count ?? 0;
                  return `${completed} / ${failed} / ${total}`;
                },
              },
              {
                header: "Finished",
                cell: (row) => formatDateTimeDDMMYYYY(row.finished_at) || "--",
              },
              {
                header: "Actions",
                cell: (row) => {
                  const isInProgress = row.status === "in_progress" || row.status === "running";
                  const isCancelling = cancellingIds.has(row.id);
                  const isDeleting = deletingIds.has(row.id);
                  if (isInProgress) {
                    return (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleCancelRun(row.id)}
                        disabled={isCancelling}
                        className="h-8 px-3 text-xs"
                      >
                        {isCancelling ? "Cancelling…" : "Stop"}
                      </Button>
                    );
                  }
                  return (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 px-3 text-xs text-destructive hover:text-destructive"
                      onClick={() => handleDeleteRun(row.id)}
                      disabled={isDeleting}
                    >
                      {isDeleting ? "Deleting…" : "Delete"}
                    </Button>
                  );
                },
              },
            ]}
            empty="No extraction runs yet."
          />
        )}
      </Card>
    </div>
  );
}
