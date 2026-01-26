"use client";

import { useEffect, useState } from "react";
import { DataTable, RowLink } from "@/components/ui/DataTable";
import { sbList } from "@/lib/supabase/table";

type ProjectRow = {
  id: string;
  name: string;
  active: boolean | null;
  category_1: string | null;
  category_2: string | null;
  updated_at: string;
  account_id: string | null;
};

export default function ProjectsTable() {
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await sbList<ProjectRow[]>("projects", {
        select: "id,name,active,category_1,category_2,account_id,updated_at",
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
          header: "Project Name",
          cell: (r) => <RowLink href={`/crm/projects/${r.id}`}>{r.name}</RowLink>,
        },
        { header: "Active", cell: (r) => (r.active ? "Yes" : "No") },
        { header: "Category 1", cell: (r) => r.category_1 ?? "—" },
        { header: "Category 2", cell: (r) => r.category_2 ?? "—" },
      ]}
      empty="No projects yet."
    />
  );
}


