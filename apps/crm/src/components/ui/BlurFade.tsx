"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export function BlurFade({
  children,
  className,
  delayMs = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), delayMs);
    return () => window.clearTimeout(t);
  }, [delayMs]);

  return (
    <div
      className={cn(
        "transition-all duration-300 ease-out will-change-transform",
        mounted
          ? "opacity-100 translate-y-0 blur-0"
          : "opacity-0 translate-y-1 blur-[6px]",
        className,
      )}
    >
      {children}
    </div>
  );
}


