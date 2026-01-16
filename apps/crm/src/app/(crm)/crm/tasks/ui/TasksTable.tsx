"use client";

import { useEffect, useState } from "react";
import { DataTable, RowLink } from "@/components/ui/DataTable";
import { sbList } from "@/lib/supabase/table";

type TaskRow = {
  id: string;
  subject: string | null;
  status?: string | null;
  priority?: string | null;
  due_date?: string | null;
  updated_at?: string;
};

export default function TasksTable() {
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await sbList<TaskRow[]>("tasks", {
        select: "id,subject,status,priority,due_date,updated_at",
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
          header: "Subject",
          cell: (r) => (
            <RowLink href={`/crm/tasks/${r.id}`}>{r.subject ?? "—"}</RowLink>
          ),
        },
        { header: "Status", cell: (r) => (r.status as string | null) ?? "—" },
        { header: "Priority", cell: (r) => (r.priority as string | null) ?? "—" },
        { header: "Due", cell: (r) => (r.due_date as string | null) ?? "—" },
      ]}
      empty="No tasks yet."
    />
  );
}


