"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import RealTimeStatus from "./RealTimeStatus";
import { supabaseBrowser } from "@/lib/supabase/browser";
import FlowStepper from "./FlowStepper";

type RunSummary = {
  total: number;
  completed: number;
  failed: number;
  running: number;
};

type VisitSummary = {
  total: number;
  pending: number;
  completed: number;
  failed: number;
};

type ClaimSummary = {
  total: number;
  draft: number;
  submitted: number;
  notStarted: number;
  error: number;
};

export default function RpaOverview() {
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [visitSummary, setVisitSummary] = useState<VisitSummary | null>(null);
  const [claimSummary, setClaimSummary] = useState<ClaimSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadSummary = async () => {
      setLoading(true);
      setError(null);

      const supabase = supabaseBrowser();
      if (!supabase) {
        setError("Supabase is not configured.");
        setLoading(false);
        return;
      }

      try {
        const [runsRes, visitsRes] = await Promise.all([
          supabase
            .from("rpa_extraction_runs")
            .select("status")
            .order("started_at", { ascending: false })
            .limit(100),
          supabase
            .from("visits")
            .select("extraction_metadata,submission_status")
            .eq("source", "Clinic Assist")
            .limit(1000),
        ]);

        if (cancelled) return;

        if (runsRes.error) {
          throw runsRes.error;
        }
        if (visitsRes.error) {
          throw visitsRes.error;
        }

        const runs = runsRes.data ?? [];
        const visits = visitsRes.data ?? [];

        setRunSummary({
          total: runs.length,
          completed: runs.filter((r) => r.status === "completed").length,
          failed: runs.filter((r) => r.status === "failed").length,
          running: runs.filter((r) => r.status === "running" || r.status === "in_progress")
            .length,
        });

        setVisitSummary({
          total: visits.length,
          pending: visits.filter(
            (v) => !v?.extraction_metadata?.detailsExtractionStatus,
          ).length,
          completed: visits.filter(
            (v) => v?.extraction_metadata?.detailsExtractionStatus === "completed",
          ).length,
          failed: visits.filter(
            (v) => v?.extraction_metadata?.detailsExtractionStatus === "failed",
          ).length,
        });

        setClaimSummary({
          total: visits.length,
          draft: visits.filter((v) => v?.submission_status === "draft").length,
          submitted: visits.filter((v) => v?.submission_status === "submitted").length,
          notStarted: visits.filter((v) => !v?.submission_status).length,
          error: visits.filter((v) => v?.submission_status === "error").length,
        });

        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const errorMessage = String((err as Error).message ?? err);
        setError(errorMessage);
        setLoading(false);
      }
    };

    loadSummary();
    const interval = setInterval(loadSummary, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshTrigger]);

  const handleCleanup = async () => {
    setCleanupBusy(true);
    setError(null);
    setCleanupMessage(null);
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
        setCleanupMessage(data?.message ?? "RPA data cleaned. Start a run from Flow 1 (e.g. date 2023-01-23).");
        setTimeout(() => setCleanupMessage(null), 8000);
      }
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setCleanupBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-5">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-8 w-16 animate-pulse rounded bg-muted" />
            </Card>
          ))}
        </div>
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
    <div className="space-y-6">
      <div>
        <div className="text-xs font-medium text-muted-foreground">Overview</div>
        <div className="text-2xl font-semibold">RPA Automation Status</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Quick overview of all automation flows and their current status.
        </div>
      </div>

      <FlowStepper
        steps={[
          {
            id: "1",
            title: "Extract Excel",
            subtitle: "Clinic Assist queue list",
            tone: "border-blue-200 bg-blue-50 text-blue-700",
            status:
              (runSummary?.running ?? 0) > 0
                ? "running"
                : (runSummary?.failed ?? 0) > 0
                  ? "attention"
                  : "ready",
            statusLabel:
              (runSummary?.running ?? 0) > 0
                ? "Running"
                : (runSummary?.failed ?? 0) > 0
                  ? "Needs attention"
                  : "Ready",
          },
          {
            id: "2",
            title: "Enhance Data",
            subtitle: "Diagnosis, PCNO, details",
            tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
            status:
              (visitSummary?.failed ?? 0) > 0
                ? "attention"
                : (visitSummary?.pending ?? 0) > 0
                  ? "pending"
                  : "ready",
            statusLabel:
              (visitSummary?.failed ?? 0) > 0
                ? "Needs attention"
                : (visitSummary?.pending ?? 0) > 0
                  ? "Pending"
                  : "Ready",
          },
          {
            id: "3",
            title: "Fill Forms",
            subtitle: "Submit or draft claims",
            tone: "border-violet-200 bg-violet-50 text-violet-700",
            status:
              (claimSummary?.error ?? 0) > 0
                ? "attention"
                : (claimSummary?.notStarted ?? 0) > 0
                  ? "pending"
                  : "ready",
            statusLabel:
              (claimSummary?.error ?? 0) > 0
                ? "Needs attention"
                : (claimSummary?.notStarted ?? 0) > 0
                  ? "Pending"
                  : "Ready",
          },
        ]}
      />

      {cleanupMessage ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {cleanupMessage}
        </div>
      ) : null}

      <RealTimeStatus />

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Flow 1: Extraction Runs</div>
          <div className="mt-2 text-2xl font-semibold">
            {runSummary?.total ?? "--"}
          </div>
          <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
            <span>{runSummary?.completed ?? 0} completed</span>
            <span>{runSummary?.failed ?? 0} failed</span>
            {runSummary && runSummary.running > 0 && (
              <span className="text-amber-600">{runSummary.running} running</span>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Flow 2: Visit Details</div>
          <div className="mt-2 text-2xl font-semibold">
            {visitSummary?.total ?? "--"}
          </div>
          <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
            <span>{visitSummary?.completed ?? 0} completed</span>
            <span>{visitSummary?.pending ?? 0} pending</span>
            <span>{visitSummary?.failed ?? 0} failed</span>
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Flow 3: Claim Submissions</div>
          <div className="mt-2 text-2xl font-semibold">
            {claimSummary?.total ?? "--"}
          </div>
          <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
            <span>{claimSummary?.submitted ?? 0} submitted</span>
            <span>{claimSummary?.draft ?? 0} draft</span>
            <span>{claimSummary?.notStarted ?? 0} pending</span>
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <div className="mb-4">
          <div className="text-xs font-medium text-muted-foreground">Quick Actions</div>
          <div className="text-lg font-semibold">Start Automation</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleCleanup}
            disabled={cleanupBusy || (runSummary?.total ?? 0) === 0}
          >
            {cleanupBusy ? "Cleaning…" : "Clean up RPA data"}
          </Button>
          <Link href="/rpa?tab=flow1">
            <Button type="button" variant="outline">
              Flow 1: Extract Excel
            </Button>
          </Link>
          <Link href="/rpa?tab=flow2">
            <Button type="button" variant="outline">
              Flow 2: Enhance Data
            </Button>
          </Link>
          <Link href="/rpa?tab=flow3">
            <Button type="button" variant="outline">
              Flow 3: Fill Forms
            </Button>
          </Link>
          <Link href="/rpa?tab=activity">
            <Button type="button" variant="ghost">
              View Activity Log
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
