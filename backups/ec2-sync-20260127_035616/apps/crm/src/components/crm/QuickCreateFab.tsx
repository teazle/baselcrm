"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

const items = [
  { href: "/crm/contacts/new", label: "New Contact" },
  { href: "/crm/companies/new", label: "New Company" },
  { href: "/crm/projects/new", label: "New Project" },
  { href: "/crm/cases/new", label: "New Case" },
  { href: "/crm/visits/new", label: "New Visit" },
  { href: "/crm/receipts/new", label: "New Receipt" },
  { href: "/crm/treatment-master/new", label: "New Treatment Master" },
  { href: "/crm/tasks/new", label: "New Task" },
];

export function QuickCreateFab() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {open ? (
        <div className="mb-3 w-60 overflow-hidden rounded-2xl border border-border bg-card/85 shadow-[0_18px_50px_rgba(2,6,23,0.18)] backdrop-blur">
          <div className="px-4 py-3 text-xs font-medium text-muted-foreground">
            Quick Create
          </div>
          <div className="border-t border-border">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm transition hover:bg-muted/70"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground",
          "shadow-[0_14px_40px_rgba(10,186,181,0.30)] transition hover:opacity-95",
        )}
        aria-label="Quick create"
      >
        {open ? "×" : "+"}
      </button>
    </div>
  );
}


