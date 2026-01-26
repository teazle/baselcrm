"use client";

import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Spinner({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
      {...props}
    />
  );
}
