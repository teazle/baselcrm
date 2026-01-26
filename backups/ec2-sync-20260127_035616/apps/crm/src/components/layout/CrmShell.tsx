"use client";

import { usePathname } from "next/navigation";
import { BlurFade } from "@/components/ui/BlurFade";

export function CrmShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Keyed by pathname so it re-animates on navigation (subtle).
  return (
    <BlurFade key={pathname} className="min-w-0">
      {children}
    </BlurFade>
  );
}


