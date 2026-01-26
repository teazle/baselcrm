"use client";

import { useEffect, useState } from "react";
import { DataTable, RowLink } from "@/components/ui/DataTable";
import { sbList } from "@/lib/supabase/table";

type TreatmentMasterRow = {
  id: string;
  name: string | null;
  code?: string | null;
  unit_price?: number | null;
  updated_at?: string;
};

export default function TreatmentMasterTable() {
  const [rows, setRows] = useState<TreatmentMasterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      // Keep select conservative: name is required for visit lookups.
      const res = await sbList<TreatmentMasterRow[]>("treatment_master", {
        select: "id,name,code,unit_price,updated_at",
        order: { column: "updated_at", ascending: false },
        limit: 200,
      });
      if (cancelled) return;
      if (res.error) {
        setError(String(res.error.message ?? res.error));
        setRows([]);
        setLoading(false);
        return;
      }
      setRows(res.data ?? []);
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
          header: "Name",
          cell: (r) => (
            <RowLink href={`/crm/treatment-master/${r.id}`}>
              {r.name ?? "—"}
            </RowLink>
          ),
        },
        { header: "Code", cell: (r) => (r.code as string | null) ?? "—" },
        {
          header: "Unit Price",
          cell: (r) =>
            r.unit_price != null ? `$${Number(r.unit_price).toFixed(2)}` : "—",
        },
      ]}
      empty="No treatment items yet."
    />
  );
}


