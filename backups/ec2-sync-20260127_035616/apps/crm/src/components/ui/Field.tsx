"use client";

import type { HTMLAttributes, LabelHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

export function Field({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid gap-1", className)} {...props} />;
}


