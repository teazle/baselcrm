"use client";

import { useEffect, useState } from "react";
import { DataTable, RowLink } from "@/components/ui/DataTable";
import { sbList } from "@/lib/supabase/table";

type ReceiptRow = {
  id: string;
  receipt_no: string | null;
  receipt_date: string | null;
  transaction_type: string | null;
  receipt_amount: number | null;
  balance: number | null;
  updated_at: string;
};

export default function ReceiptsTable() {
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await sbList<ReceiptRow[]>("receipts", {
        select:
          "id,receipt_no,receipt_date,transaction_type,receipt_amount,balance,updated_at",
        order: { column: "receipt_date", ascending: false },
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
          header: "Receipt No.",
          cell: (r) => (
            <RowLink href={`/crm/receipts/${r.id}`}>{r.receipt_no ?? "—"}</RowLink>
          ),
        },
        { header: "Date", cell: (r) => r.receipt_date ?? "—" },
        { header: "Type", cell: (r) => r.transaction_type ?? "—" },
        {
          header: "Amount",
          cell: (r) =>
            r.receipt_amount != null ? `$${Number(r.receipt_amount).toFixed(2)}` : "—",
        },
        {
          header: "Balance",
          cell: (r) => (r.balance != null ? `$${Number(r.balance).toFixed(2)}` : "—"),
        },
      ]}
      empty="No receipts yet."
    />
  );
}


