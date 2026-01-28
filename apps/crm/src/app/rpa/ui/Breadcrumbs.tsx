"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";

const tabLabels: Record<string, string> = {
  overview: "Overview",
  flow1: "Flow 1: Extract Excel",
  flow2: "Flow 2: Enhance Data",
  flow3: "Flow 3: Fill Forms",
  activity: "Activity Log",
};

export default function Breadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") || "overview";

  const crumbs: Array<{ label: string; href?: string }> = [
    { label: "RPA", href: "/rpa" },
  ];

  if (pathname?.includes("/rpa/settings")) {
    crumbs.push({ label: "Settings" });
  } else {
    crumbs.push({ label: tabLabels[tab] ?? "Overview" });
  }

  return (
    <div className={cn("text-xs text-muted-foreground", className)}>
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        return (
          <span key={`${crumb.label}-${index}`}>
            {crumb.href && !isLast ? (
              <Link href={crumb.href} className="hover:text-foreground transition">
                {crumb.label}
              </Link>
            ) : (
              <span className="text-foreground">{crumb.label}</span>
            )}
            {!isLast ? " / " : null}
          </span>
        );
      })}
    </div>
  );
}
