"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
}: {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-sm">
        <div className="text-sm font-medium text-foreground">Nothing here yet</div>
        <div className="mt-1 text-muted-foreground">{empty ?? "No records."}</div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            {columns.map((c) => (
              <th key={c.header} className={"px-4 py-3 " + (c.className ?? "")}>
                {c.header}
              </th>
            ))}
          </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={rowKey(row)}
                className={[
                  "border-b border-border last:border-b-0",
                  "transition-colors hover:bg-muted/35",
                  idx % 2 === 1 ? "bg-muted/10" : "",
                ].join(" ")}
              >
                {columns.map((c) => (
                  <td
                    key={c.header}
                    className={"px-4 py-3 align-top " + (c.className ?? "")}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RowLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className="font-medium hover:underline">
      {children}
    </Link>
  );
}


