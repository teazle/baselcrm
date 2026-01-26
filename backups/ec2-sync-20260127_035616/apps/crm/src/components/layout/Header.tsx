"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/components/layout/UserMenu";
import { MobileNav } from "@/components/layout/MobileNav";

const titleMap: Array<{ prefix: string; title: string; subtitle?: string }> = [
  { prefix: "/crm/contacts", title: "Contacts", subtitle: "Patients and stakeholders" },
  { prefix: "/crm/companies", title: "Companies", subtitle: "Accounts & statement-of-account" },
  { prefix: "/crm/projects", title: "Projects", subtitle: "Company programmes & automation lists" },
  { prefix: "/crm/cases", title: "Cases", subtitle: "Parent record for visits and billing" },
  { prefix: "/crm/visits", title: "Visits", subtitle: "Clinical records and line items" },
  { prefix: "/crm/receipts", title: "Receipts", subtitle: "Payments, credits, and offsets" },
  { prefix: "/crm/treatment-master", title: "Treatment Master", subtitle: "Items used for visit line billing" },
  { prefix: "/crm/tasks", title: "Tasks", subtitle: "Follow-ups and admin work" },
  { prefix: "/crm/reports", title: "Reports" },
  { prefix: "/crm/rpa", title: "RPA Automation", subtitle: "Automation monitoring and controls" },
  { prefix: "/crm/settings", title: "Settings" },
  { prefix: "/crm", title: "Dashboard", subtitle: "At-a-glance overview" },
];

export function Header() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const meta = useMemo(() => {
    const match = titleMap.find((x) =>
      x.prefix === "/crm" ? pathname === "/crm" : pathname.startsWith(x.prefix),
    );
    return match ?? { title: "CRM", subtitle: undefined };
  }, [pathname]);

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/70 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-6">
        <div className="flex flex-1 items-center gap-3">
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card/70 text-sm transition hover:bg-muted/70 md:hidden"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
          >
            ≡
          </button>

          <div>
            <div className="text-sm font-semibold leading-5">{meta.title}</div>
            {meta.subtitle ? (
              <div className="text-[11px] text-muted-foreground">{meta.subtitle}</div>
            ) : null}
          </div>
          <div className="flex-1" />
          <div className="hidden w-full max-w-md md:block">
            <div className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
              Search (coming soon)
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <UserMenu />
        </div>
      </div>
      <MobileNav open={mobileOpen} onClose={() => setMobileOpen(false)} />
    </header>
  );
}

