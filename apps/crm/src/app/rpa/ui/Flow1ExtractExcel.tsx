"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { isDemoMode } from "@/lib/env";
import { mockGetTable } from "@/lib/mock/storage";
import { StatusBadge, type Status } from "./StatusBadge";
import { formatDateTimeSingapore } from "@/lib/utils/date";
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

function formatDateTime(value?: string | null) {
  return formatDateTimeSingapore(value);
}

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
        const demoRows = (mockGetTable("rpa_extraction_runs") as RunRow[]).filter(
          (row) => row.run_type === "queue_list"
        );
        if (cancelled) return;
        setRuns(demoRows.slice(0, 20));
        setLoading(false);
        return;
      }

      const { data, error: queryError } = await supabase
        .from("rpa_extraction_runs")
        .select("*")
        .eq("run_type", "queue_list")
        .order("started_at", { ascending: false })
        .limit(20);

      if (cancelled) return;
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
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const metrics = {
    total: runs.length,
    completed: runs.filter((r) => r.status === "completed").length,
    failed: runs.filter((r) => r.status === "failed").length,
    running: runs.filter((r) => r.status === "running").length,
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-medium text-muted-foreground">Flow 1</div>
        <div className="text-2xl font-semibold">Extract Excel from Clinic Assist</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Extract queue list data from Clinic Assist and save to database.
        </div>
      </div>

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
                cell: (row) => formatDateTime(row.started_at) || "--",
              },
              {
                header: "Status",
                cell: (row) => <StatusBadge status={normalizeStatus(row.status)} />,
              },
              {
                header: "Date",
                cell: (row) => {
                  const date = row.metadata?.date || row.started_at?.slice(0, 10) || "--";
                  return date;
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
                cell: (row) => formatDateTime(row.finished_at) || "--",
              },
            ]}
            empty="No extraction runs yet."
          />
        )}
      </Card>
    </div>
  );
}
