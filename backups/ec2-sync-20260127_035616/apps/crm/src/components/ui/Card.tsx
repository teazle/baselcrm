"use client";

import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-6 shadow-sm shadow-black/5",
        className,
      )}
      {...props}
    />
  );
}


