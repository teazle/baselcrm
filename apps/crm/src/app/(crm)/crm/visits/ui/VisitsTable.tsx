"use client";

import { useEffect, useState } from "react";
import { DataTable, RowLink } from "@/components/ui/DataTable";
import { sbList } from "@/lib/supabase/table";

type VisitRow = {
  id: string;
  visit_record_no: string | null;
  visit_date: string | null;
  patient_name: string | null;
  total_amount: number | null;
  amount_outstanding: number | null;
  updated_at: string;
};

export default function VisitsTable() {
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await sbList<VisitRow[]>("visits", {
        select:
          "id,visit_record_no,visit_date,patient_name,total_amount,amount_outstanding,updated_at",
        order: { column: "visit_date", ascending: false },
        limit: 50,
      });
      if (cancelled) return;
      if (res.error) {
        setError(String(res.error.message ?? res.error));
        setRows([]);
        setLoading(false);
        return;
      }
      setRows(res.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Loading…
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
        { header: "Patient", cell: (r) => r.patient_name ?? "—" },
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
      empty="No visits yet."
    />
  );
}


