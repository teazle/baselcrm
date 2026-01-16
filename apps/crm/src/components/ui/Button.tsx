"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type Size = "sm" | "md";

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  const base =
    "inline-flex items-center justify-center font-medium transition disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  const sizes: Record<Size, string> = {
    sm: "h-9 rounded-xl px-3 text-sm",
    md: "h-11 rounded-xl px-4 text-sm",
  };
  const variants: Record<Variant, string> = {
    primary: "bg-primary text-primary-foreground shadow-sm hover:opacity-95",
    secondary:
      "bg-secondary text-secondary-foreground shadow-sm hover:opacity-95",
    ghost: "bg-transparent text-foreground hover:bg-muted",
    outline: "border border-border bg-card text-foreground hover:bg-muted",
    danger: "bg-red-600 text-white shadow-sm hover:bg-red-700",
  };

  return (
    <button
      className={cn(base, sizes[size], variants[variant], className)}
      {...props}
    />
  );
}


