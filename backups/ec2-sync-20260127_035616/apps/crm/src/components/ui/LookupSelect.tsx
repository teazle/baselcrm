"use client";

import { useEffect, useState } from "react";
import { sbList } from "@/lib/supabase/table";
import type { UnknownRecord } from "@/lib/db/coerce";

type Option = { value: string; label: string };

export function LookupSelect({
  table,
  value,
  onChange,
  placeholder = "—",
  labelColumn = "name",
  filter,
}: {
  table: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  placeholder?: string;
  labelColumn?: string;
  filter?: { column: string; equals: string };
}) {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const select = `id,${labelColumn}`;
      const res = await sbList<UnknownRecord[]>(table, {
        select,
        order: { column: labelColumn, ascending: true },
        limit: 200,
      });
      if (cancelled) return;
      if (res.error) {
        setOptions([]);
        setLoading(false);
        return;
      }
      let rows: UnknownRecord[] = res.data ?? [];
      if (filter) {
        rows = rows.filter((r) => r?.[filter.column] === filter.equals);
      }
      setOptions(
        rows.map((r) => ({
          value: String(r.id),
          label: String(r[labelColumn]),
        })),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, labelColumn, table]);

  return (
    <select
      className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? e.target.value : null)}
      disabled={loading}
    >
      <option value="">{loading ? "Loading…" : placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}


