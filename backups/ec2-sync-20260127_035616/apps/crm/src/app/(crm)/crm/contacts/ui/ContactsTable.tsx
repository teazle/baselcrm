"use client";

import { useEffect, useState } from "react";
import { DataTable, RowLink } from "@/components/ui/DataTable";
import type { Contact } from "@/lib/db/models";
import { sbList } from "@/lib/supabase/table";

export default function ContactsTable() {
  const [rows, setRows] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await sbList<Contact[]>("contacts", {
        select:
          "id,first_name,last_name,record_type,registration_no,ic_passport_no,mobile,email,updated_at",
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
            <RowLink href={`/crm/contacts/${r.id}`}>
              {[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}
            </RowLink>
          ),
        },
        { header: "Record Type", cell: (r) => r.record_type ?? "—" },
        { header: "Mobile", cell: (r) => r.mobile ?? "—" },
        { header: "Email", cell: (r) => r.email ?? "—" },
        { header: "Reg No.", cell: (r) => r.registration_no ?? "—" },
        { header: "IC/Passport", cell: (r) => r.ic_passport_no ?? "—" },
      ]}
      empty="No contacts yet."
    />
  );
}


