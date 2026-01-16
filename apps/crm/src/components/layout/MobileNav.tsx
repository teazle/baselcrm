"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { crmNav } from "@/components/layout/nav";
import { cn } from "@/lib/cn";

export function MobileNav({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Close menu"
      />
      <div className="absolute left-4 top-4 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card/90 shadow-[0_24px_60px_rgba(2,6,23,0.25)] backdrop-blur">
        <div className="flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <span className="text-sm font-semibold">B</span>
            </div>
            <div>
              <div className="text-sm font-semibold leading-5">Baselrpa CRM</div>
              <div className="text-xs text-muted-foreground">Tiffany Edition</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-background/70 text-sm transition hover:bg-muted/70"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="border-t border-border p-2">
          {crmNav.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/crm" && pathname.startsWith(item.href + "/"));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "block rounded-xl px-3 py-2 text-sm transition hover:bg-muted/70",
                  active
                    ? "bg-muted/60 shadow-[inset_0_0_0_1px_rgba(10,186,181,0.22)]"
                    : "",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}


