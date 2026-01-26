"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { crmNav } from "@/components/layout/nav";

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "hidden w-64 shrink-0 border-r border-border bg-card/70 backdrop-blur md:block",
        className,
      )}
    >
      <div className="px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <span className="text-sm font-semibold">B</span>
          </div>
          <div>
            <div className="text-sm font-semibold leading-5">Baselrpa CRM</div>
            <div className="text-xs text-muted-foreground">Tiffany Edition</div>
          </div>
        </div>
      </div>

      <nav className="px-3 pb-5">
        <div className="px-2 pb-2 text-xs font-medium text-muted-foreground">
          Workspace
        </div>
        <ul className="space-y-1">
          {crmNav.map((item) => (
            <li key={item.href}>
              {(() => {
                const active =
                  pathname === item.href ||
                  (item.href !== "/crm" && pathname.startsWith(item.href + "/"));
                return (
              <Link
                href={item.href}
                    className={cn(
                      "relative block rounded-xl px-3 py-2 text-sm transition",
                      "hover:bg-muted/70",
                      active
                        ? "bg-muted/60 text-foreground shadow-[inset_0_0_0_1px_rgba(10,186,181,0.22)]"
                        : "text-foreground",
                    )}
              >
                    {active ? (
                      <span className="absolute left-1 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
                    ) : null}
                {item.label}
              </Link>
                );
              })()}
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}


