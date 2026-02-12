"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Progress";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { StatusBadge } from "./StatusBadge";
import { formatDateTimeDDMMYYYY } from "@/lib/utils/date";

type RunRow = {
  id: string;
  run_type: string | null;
  status: string | null;
  started_at: string | null;
  total_records: number | null;
  completed_count: number | null;
  failed_count: number | null;
};

function formatRunType(value?: string | null) {
  if (value === "queue_list") return "Queue List";
  if (value === "visit_details") return "Visit Details";
  return value ?? "--";
}

export default function RealTimeStatus() {
  const [activeRuns, setActiveRuns] = useState<RunRow[]>([]);
  const [recentRuns, setRecentRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
      const supabase = supabaseBrowser();
      if (!supabase) {
        setError("Supabase is not configured.");
        setLoading(false);
        return;
      }

      const [activeRes, recentRes] = await Promise.all([
        supabase
          .from("rpa_extraction_runs")
          .select(
            "id,run_type,status,started_at,total_records,completed_count,failed_count",
          )
          .in("status", ["running", "in_progress"])
          .order("started_at", { ascending: false }),
        supabase
          .from("rpa_extraction_runs")
          .select(
            "id,run_type,status,started_at,total_records,completed_count,failed_count",
          )
          .order("started_at", { ascending: false })
          .limit(8),
      ]);

      if (activeRes.error) {
        const errorMessage = String(activeRes.error.message ?? activeRes.error);
        if (errorMessage.includes('permission denied') || errorMessage.includes('row-level security') || errorMessage.includes('RLS')) {
          setError(`Database permission error: ${errorMessage}. Check RLS policies for 'rpa_extraction_runs' table. See docs/status/RPA_STATUS_AND_TROUBLESHOOTING.md`);
        } else {
          setError(errorMessage);
        }
        setLoading(false);
        return;
      }
      if (recentRes.error) {
        const errorMessage = String(recentRes.error.message ?? recentRes.error);
        if (errorMessage.includes('permission denied') || errorMessage.includes('row-level security') || errorMessage.includes('RLS')) {
          setError(`Database permission error: ${errorMessage}. Check RLS policies for 'rpa_extraction_runs' table. See docs/status/RPA_STATUS_AND_TROUBLESHOOTING.md`);
        } else {
          setError(errorMessage);
        }
        setLoading(false);
        return;
      }
      setError(null);
      setActiveRuns((activeRes.data ?? []) as RunRow[]);
      setRecentRuns((recentRes.data ?? []) as RunRow[]);
      setLoading(false);
    },
  []);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    load();
    intervalId = setInterval(load, 60000);
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [load, refreshTrigger]);

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
    } finally {
      setStoppingIds((prev) => {
        const next = new Set(prev);
        next.delete(runId);
        return next;
      });
    }
  };

  return (
    <Card className="space-y-5">
      <div>
        <div className="text-xs font-medium text-muted-foreground">Real-time Status</div>
        <div className="text-lg font-semibold">Active Extraction Runs</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Polling every 60 seconds for running jobs.
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : activeRuns.length === 0 ? (
        <div className="rounded-2xl border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
          No active extraction runs.
        </div>
      ) : (
        <div className="space-y-4">
          {activeRuns.map((run) => {
            const total = run.total_records ?? 0;
            const completed = run.completed_count ?? 0;
            const failed = run.failed_count ?? 0;
            const progress =
              total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;
            return (
              <div
                key={run.id}
                className="rounded-2xl border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">
                      {formatRunType(run.run_type)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Started {formatDateTimeDDMMYYYY(run.started_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status="in_progress" />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleStop(run.id)}
                      disabled={stoppingIds.has(run.id)}
                    >
                      {stoppingIds.has(run.id) ? "Stopping…" : "Stop"}
                    </Button>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  <Progress value={progress} />
                  <div className="text-xs text-muted-foreground">
                    {completed} completed, {failed} failed, {total} total
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-border pt-4">
        <div className="text-xs font-medium text-muted-foreground">Recent Runs</div>
        <div className="mt-2 space-y-2">
          {recentRuns.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No recent runs yet.
            </div>
          ) : (
            recentRuns.map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-medium">
                    {formatRunType(run.run_type)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDateTimeDDMMYYYY(run.started_at)}
                  </div>
                </div>
                <StatusBadge
                  status={
                    run.status === "completed"
                      ? "completed"
                      : run.status === "failed"
                        ? "failed"
                        : run.status === "running"
                          ? "in_progress"
                          : "pending"
                  }
                />
              </div>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}
