"use client";

import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Progress({
  value,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { value: number }) {
  const safe = Math.min(100, Math.max(0, value));
  return (
    <div
      className={cn("h-2 w-full rounded-full bg-muted", className)}
      {...props}
    >
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${safe}%` }}
      />
    </div>
  );
}
