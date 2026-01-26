"use client";

import { useEffect, useState } from "react";
import { DataTable, RowLink } from "@/components/ui/DataTable";
import type { Account } from "@/lib/db/models";
import { sbList } from "@/lib/supabase/table";

export default function CompaniesTable() {
  const [rows, setRows] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await sbList<Account[]>("accounts", {
        select:
          "id,name,company_code,phone,email_statement_of_account,active,updated_at",
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
          header: "Company Name",
          cell: (r) => <RowLink href={`/crm/companies/${r.id}`}>{r.name}</RowLink>,
        },
        { header: "Code", cell: (r) => r.company_code ?? "—" },
        { header: "Phone", cell: (r) => r.phone ?? "—" },
        {
          header: "SOA Email",
          cell: (r) => r.email_statement_of_account ?? "—",
        },
        { header: "Active", cell: (r) => (r.active ? "Yes" : "No") },
      ]}
      empty="No companies yet."
    />
  );
}


