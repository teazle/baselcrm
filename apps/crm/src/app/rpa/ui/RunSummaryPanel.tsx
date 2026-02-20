"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { formatDateTimeDDMMYYYY } from "@/lib/utils/date";

type RunReportItem = {
  baseName: string;
  flowPrefix: string;
  stamp: string;
  mdFile: string | null;
  mdUrl: string | null;
  flowName: string | null;
  generatedAt: string | null;
  scope: Record<string, unknown> | null;
  totals: Record<string, unknown> | null;
  rowCount: number;
  rows: Array<{
    date: string;
    patientName: string;
    nric: string;
    payType: string;
    portal: string;
    status: string;
    diagnosisStatus: string;
    notes: string;
  }>;
};

type RunSummaryPanelProps = {
  flowPrefix: "flow1" | "flow2" | "flow3";
  title?: string;
  limit?: number;
};

const FLOW_LABELS: Record<string, string> = {
  flow1: "Flow 1 Queue Extraction",
  flow2: "Flow 2 Visit Details Extraction",
  flow3: "Flow 3 Claim Submission",
};

function stringifyScope(scope: Record<string, unknown> | null) {
  if (!scope) return "Scope not available";
  const from = String(scope.from || "").trim();
  const to = String(scope.to || "").trim();
  const date = String(scope.date || "").trim();
  const payType = String(scope.payType || "").trim();
  const portals = String(scope.portalTargets || "").trim();

  const bits: string[] = [];
  if (date) bits.push(`Date: ${date}`);
  if (from || to) bits.push(`Range: ${from || "-"} to ${to || "-"}`);
  if (payType) bits.push(`Pay Type: ${payType}`);
  if (portals) bits.push(`TPA: ${portals}`);
  return bits.length ? bits.join(" | ") : "Scope not available";
}

function summarizeTotals(totals: Record<string, unknown> | null) {
  if (!totals) return "No totals";
  const parts = Object.entries(totals).map(([key, value]) => `${key}=${String(value ?? "-")}`);
  return parts.length ? parts.join(" | ") : "No totals";
}

export default function RunSummaryPanel({
  flowPrefix,
  title = "Latest Run Reports",
  limit = 5,
}: RunSummaryPanelProps) {
  const [items, setItems] = useState<RunReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/rpa/run-reports?flow=${encodeURIComponent(flowPrefix)}&limit=${limit}`,
          { cache: "no-store" }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(String(data?.error || "Failed to load run reports"));
        }
        if (!cancelled) {
          setItems(Array.isArray(data?.items) ? (data.items as RunReportItem[]) : []);
        }
      } catch (err) {
        if (!cancelled) setError(String((err as Error)?.message || err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flowPrefix, limit]);

  const effectiveTitle = useMemo(
    () => `${title} (${FLOW_LABELS[flowPrefix] || flowPrefix})`,
    [flowPrefix, title]
  );

  return (
    <Card className="space-y-4 p-5">
      <div>
        <div className="text-xs font-medium text-muted-foreground">Reports</div>
        <div className="text-lg font-semibold">{effectiveTitle}</div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          Loading run reports...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          No run reports found yet.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.baseName}
              className="rounded-xl border border-border bg-card p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">
                  {formatDateTimeDDMMYYYY(item.generatedAt) || item.stamp}
                </div>
                <div className="flex items-center gap-2">
                  {item.mdUrl ? (
                    <a
                      href={item.mdUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-xs hover:bg-muted"
                    >
                      Open MD
                    </a>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {stringifyScope(item.scope)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Rows: {item.rowCount} | {summarizeTotals(item.totals)}
              </div>
              {item.rows.length > 0 ? (
                <details className="mt-3 rounded-lg border border-border bg-background/60 p-2">
                  <summary className="cursor-pointer text-xs font-medium text-foreground">
                    View per-patient rows ({item.rows.length})
                  </summary>
                  <div className="mt-2 overflow-x-auto">
                    <table className="min-w-[900px] text-xs">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="px-2 py-1">Date</th>
                          <th className="px-2 py-1">Patient Name</th>
                          <th className="px-2 py-1">NRIC</th>
                          <th className="px-2 py-1">Pay Type</th>
                          <th className="px-2 py-1">TPA/Portal</th>
                          <th className="px-2 py-1">Status</th>
                          <th className="px-2 py-1">Diagnosis Status</th>
                          <th className="px-2 py-1">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.rows.map((row, index) => (
                          <tr key={`${item.baseName}-${index}`} className="border-b border-border/60">
                            <td className="px-2 py-1 align-top">{row.date}</td>
                            <td className="px-2 py-1 align-top">{row.patientName}</td>
                            <td className="px-2 py-1 align-top font-mono">{row.nric}</td>
                            <td className="px-2 py-1 align-top">{row.payType}</td>
                            <td className="px-2 py-1 align-top">{row.portal}</td>
                            <td className="px-2 py-1 align-top">{row.status}</td>
                            <td className="px-2 py-1 align-top">{row.diagnosisStatus}</td>
                            <td className="px-2 py-1 align-top whitespace-pre-wrap">{row.notes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
