"use client";

import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none ring-0 focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]",
        className,
      )}
      {...props}
    />
  );
}


