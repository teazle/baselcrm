"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getTodaySingapore, toSingaporeDateString } from "@/lib/utils/date";

type Metrics = {
  totalVisits: number;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
  pcnoCount: number;
  todayCount: number;
};

const numberFormatter = new Intl.NumberFormat();

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function formatCount(value: number) {
  return numberFormatter.format(value);
}

export default function RpaDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

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

      const countVisits = async (apply?: (query: any) => any) => {
        let query = supabase
          .from("visits")
          .select("id", { count: "exact", head: true })
          .eq("source", "Clinic Assist");
        if (apply) query = apply(query);
        const { count, error: queryError } = await query;
        if (queryError) throw queryError;
        return count ?? 0;
      };

      try {
        // Get start and end of today in Singapore timezone
        const today = getTodaySingapore(); // YYYY-MM-DD in Singapore timezone
        const [year, month, day] = today.split('-').map(Number);
        const start = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+08:00`);
        const end = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T23:59:59+08:00`);

        const [
          totalVisits,
          completedCount,
          failedCount,
          pendingCount,
          pcnoCount,
          todayCount,
        ] = await Promise.all([
          countVisits(),
          countVisits((q) =>
            q.eq("extraction_metadata->>detailsExtractionStatus", "completed"),
          ),
          countVisits((q) =>
            q.eq("extraction_metadata->>detailsExtractionStatus", "failed"),
          ),
          countVisits((q) =>
            q.is("extraction_metadata->>detailsExtractionStatus", null),
          ),
          countVisits((q) =>
            q
              .not("extraction_metadata->>pcno", "is", null)
              .neq("extraction_metadata->>pcno", ""),
          ),
          countVisits((q) =>
            q
              .gte("extraction_metadata->>detailsExtractedAt", start.toISOString())
              .lt("extraction_metadata->>detailsExtractedAt", end.toISOString()),
          ),
        ]);

        if (cancelled) return;
        setMetrics({
          totalVisits,
          completedCount,
          failedCount,
          pendingCount,
          pcnoCount,
          todayCount,
        });
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const errorMessage = String((err as Error).message ?? err);
        // Check for common RLS/permission errors
        if (errorMessage.includes('permission denied') || errorMessage.includes('row-level security') || errorMessage.includes('RLS')) {
          setError(`Database permission error: ${errorMessage}. Check RLS policies for 'visits' table. See docs/status/RPA_STATUS_AND_TROUBLESHOOTING.md`);
        } else {
          setError(errorMessage);
        }
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const successRate = useMemo(() => {
    if (!metrics) return null;
    const denom = metrics.completedCount + metrics.failedCount;
    if (denom === 0) return null;
    return Math.round((metrics.completedCount / denom) * 100);
  }, [metrics]);

  const pcnoCoverage = useMemo(() => {
    if (!metrics || metrics.totalVisits === 0) return null;
    return Math.round((metrics.pcnoCount / metrics.totalVisits) * 100);
  }, [metrics]);

  const cards = [
    {
      label: "Total Visits (Clinic Assist)",
      value: metrics ? formatCount(metrics.totalVisits) : "--",
    },
    {
      label: "Details Success Rate",
      value: successRate != null ? `${successRate}%` : "--",
    },
    {
      label: "PCNO Coverage",
      value: pcnoCoverage != null ? `${pcnoCoverage}%` : "--",
    },
    {
      label: "Pending Details",
      value: metrics ? formatCount(metrics.pendingCount) : "--",
    },
    {
      label: "Failed Details",
      value: metrics ? formatCount(metrics.failedCount) : "--",
    },
    {
      label: "Today's Details",
      value: metrics ? formatCount(metrics.todayCount) : "--",
    },
  ];

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <MetricCard key={card.label} label={card.label} value="Loading..." />
        ))}
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
    <div className="grid gap-4 md:grid-cols-3">
      {cards.map((card) => (
        <MetricCard key={card.label} label={card.label} value={card.value} />
      ))}
    </div>
  );
}
