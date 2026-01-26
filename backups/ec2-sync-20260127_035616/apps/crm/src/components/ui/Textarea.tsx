"use client";

import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none ring-0 focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]",
        className,
      )}
      {...props}
    />
  );
}


