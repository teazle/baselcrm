"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { DataTable, RowLink } from "@/components/ui/DataTable";
import { sbList } from "@/lib/supabase/table";

type VisitRow = {
  id: string;
  visit_record_no: string | null;
  visit_date: string | null;
  total_amount: number | null;
  amount_outstanding: number | null;
  case_id?: string | null;
};

export default function CaseVisitsList({ caseId }: { caseId: string }) {
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await sbList<VisitRow[]>("visits", {
        select:
          "id,visit_record_no,visit_date,total_amount,amount_outstanding,case_id,updated_at",
        order: { column: "visit_date", ascending: false },
        limit: 100,
      });
      if (cancelled) return;
      if (res.error) {
        setRows([]);
        setLoading(false);
        return;
      }
      // filter client-side (simple, avoids needing a custom helper)
      setRows((res.data ?? []).filter((v) => (v.case_id ?? null) === caseId));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between px-6 py-5">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Related</div>
          <div className="mt-1 text-lg font-semibold">Visits</div>
        </div>
        <Link
          href={`/crm/visits/new?caseId=${encodeURIComponent(caseId)}`}
          className="inline-flex h-9 items-center justify-center rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-95"
        >
          New Visit
        </Link>
      </div>

      <div className="px-6 pb-6">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              {
                header: "Visit Record No.",
                cell: (r) => (
                  <RowLink href={`/crm/visits/${r.id}`}>
                    {r.visit_record_no ?? "—"}
                  </RowLink>
                ),
              },
              { header: "Visit Date", cell: (r) => r.visit_date ?? "—" },
              {
                header: "Total",
                cell: (r) =>
                  r.total_amount != null ? `$${Number(r.total_amount).toFixed(2)}` : "—",
              },
              {
                header: "Outstanding",
                cell: (r) =>
                  r.amount_outstanding != null
                    ? `$${Number(r.amount_outstanding).toFixed(2)}`
                    : "—",
              },
            ]}
            empty="No visits for this case."
          />
        )}
      </div>
    </Card>
  );
}


