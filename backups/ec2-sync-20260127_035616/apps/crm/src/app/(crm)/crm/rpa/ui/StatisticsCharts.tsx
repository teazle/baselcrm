"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Progress } from "@/components/ui/Progress";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { isDemoMode } from "@/lib/env";
import { mockGetTable } from "@/lib/mock/storage";
import { StatusBadge } from "./StatusBadge";
import { formatDateSingapore } from "@/lib/utils/date";

type RunRow = {
  started_at: string | null;
  total_records: number | null;
  completed_count: number | null;
  failed_count: number | null;
  status: string | null;
};

const numberFormatter = new Intl.NumberFormat();

function formatDayLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  // Format date in Singapore timezone
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    month: "short",
    day: "numeric"
  }).format(date);
}

export default function StatisticsCharts() {
  const [runs, setRuns] = useState<RunRow[]>([]);
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
        const demoRows = mockGetTable("rpa_extraction_runs") as RunRow[];
        if (cancelled) return;
        setRuns(demoRows);
        setLoading(false);
        return;
      }

      const since = new Date();
      since.setDate(since.getDate() - 30);

      const { data, error: queryError } = await supabase
        .from("rpa_extraction_runs")
        .select("started_at,total_records,completed_count,failed_count,status")
        .gte("started_at", since.toISOString())
        .order("started_at", { ascending: false })
        .limit(500);

      if (cancelled) return;
      if (queryError) {
        const errorMessage = String(queryError.message ?? queryError);
        if (errorMessage.includes('permission denied') || errorMessage.includes('row-level security') || errorMessage.includes('RLS')) {
          setError(`Database permission error: ${errorMessage}. Check RLS policies for 'rpa_extraction_runs' table. See docs/RPA_STATUS_AND_TROUBLESHOOTING.md`);
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

  const dailySeries = useMemo(() => {
    const map = new Map<
      string,
      { day: string; total: number; completed: number; failed: number }
    >();
    runs.forEach((run) => {
      if (!run.started_at) return;
      const day = run.started_at.slice(0, 10);
      const entry = map.get(day) ?? {
        day,
        total: 0,
        completed: 0,
        failed: 0,
      };
      entry.total += run.total_records ?? 0;
      entry.completed += run.completed_count ?? 0;
      entry.failed += run.failed_count ?? 0;
      map.set(day, entry);
    });
    return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [runs]);

  const summary = useMemo(() => {
    return dailySeries.reduce(
      (acc, day) => {
        acc.total += day.total;
        acc.completed += day.completed;
        acc.failed += day.failed;
        return acc;
      },
      { total: 0, completed: 0, failed: 0 },
    );
  }, [dailySeries]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    runs.forEach((run) => {
      const status = run.status ?? "pending";
      counts.set(status, (counts.get(status) ?? 0) + 1);
    });
    return Array.from(counts.entries());
  }, [runs]);

  const successRate =
    summary.completed + summary.failed > 0
      ? Math.round(
          (summary.completed / (summary.completed + summary.failed)) * 100,
        )
      : null;

  const bars = dailySeries.slice(-14);
  const maxTotal = Math.max(0, ...bars.map((day) => day.total));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <div className="text-xs font-medium text-muted-foreground">
          Extraction Trends
        </div>
        <div className="mt-1 text-lg font-semibold">Last 14 Days</div>

        {loading ? (
          <div className="mt-6 text-sm text-muted-foreground">Loading...</div>
        ) : error ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : bars.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
            No run data yet.
          </div>
        ) : (
          <div className="mt-6 flex items-end gap-2">
            {bars.map((day) => {
              const height =
                maxTotal > 0
                  ? Math.max(6, Math.round((day.total / maxTotal) * 90))
                  : 6;
              return (
                <div key={day.day} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    className="w-full rounded-md bg-primary/80"
                    style={{ height }}
                    title={`${day.total} records`}
                  />
                  <div className="text-[10px] text-muted-foreground">
                    {formatDayLabel(day.day)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">Total Records</div>
            <div className="mt-2 text-lg font-semibold">
              {numberFormatter.format(summary.total)}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">Success Rate</div>
            <div className="mt-2 text-lg font-semibold">
              {successRate != null ? `${successRate}%` : "--"}
            </div>
            <div className="mt-3">
              <Progress value={successRate ?? 0} />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="text-xs font-medium text-muted-foreground">
          Status Distribution
        </div>
        <div className="mt-1 text-lg font-semibold">Run Outcomes</div>

        {loading ? (
          <div className="mt-6 text-sm text-muted-foreground">Loading...</div>
        ) : error ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : statusCounts.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
            No run data yet.
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {statusCounts.map(([status, count]) => (
              <div
                key={status}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2 text-sm"
              >
                <StatusBadge
                  status={
                    status === "completed"
                      ? "completed"
                      : status === "failed"
                        ? "failed"
                        : status === "running"
                          ? "in_progress"
                          : "pending"
                  }
                />
                <span className="font-medium">{numberFormatter.format(count)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
