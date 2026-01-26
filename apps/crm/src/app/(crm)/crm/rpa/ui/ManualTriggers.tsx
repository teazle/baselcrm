"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { isDemoMode } from "@/lib/env";
import { mockGetTable } from "@/lib/mock/storage";
import { getTodaySingapore } from "@/lib/utils/date";

export default function ManualTriggers() {
  const [queueDate, setQueueDate] = useState(() => getTodaySingapore());
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [detailsBusy, setDetailsBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = supabaseBrowser();
      if (!supabase) {
        if (!isDemoMode()) return;
        const rows = (mockGetTable("visits") as Array<Record<string, any>>).filter(
          (row) => row?.source === "Clinic Assist",
        );
        const pendingRows = rows.filter(
          (row) => !row?.extraction_metadata?.detailsExtractionStatus,
        );
        if (!cancelled) setPendingCount(pendingRows.length);
        return;
      }

      const { count, error } = await supabase
        .from("visits")
        .select("id", { count: "exact", head: true })
        .eq("source", "Clinic Assist")
        .is("extraction_metadata->>detailsExtractionStatus", null);
      if (cancelled) return;
      if (!error) setPendingCount(count ?? 0);
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
    } catch (err) {
      setNotice(String((err as Error).message ?? err));
    } finally {
      setQueueBusy(false);
    }
  };

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
    } catch (err) {
      setNotice(String((err as Error).message ?? err));
    } finally {
      setDetailsBusy(false);
    }
  };

  return (
    <Card className="space-y-5">
      <div>
        <div className="text-xs font-medium text-muted-foreground">Manual Triggers</div>
        <div className="text-lg font-semibold">Run Extraction Tasks</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Starts the automation scripts on the server to run extractions.
        </div>
      </div>

      <div className="space-y-4">
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
      </div>

      {notice ? (
        <div className="rounded-2xl border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
          {notice}
        </div>
      ) : null}
    </Card>
  );
}
