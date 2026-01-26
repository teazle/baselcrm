"use client";

import { useEffect, useState } from "react";
import { DataTable, RowLink } from "@/components/ui/DataTable";
import { sbList } from "@/lib/supabase/table";

type CaseRow = {
  id: string;
  case_no: string | null;
  case_date: string | null;
  patient_name: string | null;
  trigger_sms: boolean | null;
  updated_at: string;
};

export default function CasesTable() {
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await sbList<CaseRow[]>("cases", {
        select: "id,case_no,case_date,patient_name,trigger_sms,updated_at",
        order: { column: "updated_at", ascending: false },
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
          header: "Case No.",
          cell: (r) => (
            <RowLink href={`/crm/cases/${r.id}`}>{r.case_no ?? "—"}</RowLink>
          ),
        },
        { header: "Case Date", cell: (r) => r.case_date ?? "—" },
        { header: "Patient", cell: (r) => r.patient_name ?? "—" },
        { header: "Trigger SMS", cell: (r) => (r.trigger_sms ? "Yes" : "No") },
      ]}
      empty="No cases yet."
    />
  );
}


