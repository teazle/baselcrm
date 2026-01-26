"use client";

import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { cn } from "@/lib/cn";

export type ShimmerButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  shimmerColor?: string;
  shimmerSize?: string;
  shimmerDuration?: string;
  borderRadius?: string;
  background?: string;
};

/**
 * MagicUI-inspired shimmer button, implemented without extra deps.
 * Requires CSS keyframes/classes in `globals.css`:
 * - `.animate-shimmer-slide`
 * - `.animate-spin-around`
 */
export function ShimmerButton({
  className,
  children,
  shimmerColor = "rgba(255,255,255,0.85)",
  shimmerSize = "0.06em",
  shimmerDuration = "2.8s",
  borderRadius = "14px",
  background = "var(--primary)",
  ...props
}: ShimmerButtonProps) {
  return (
    <button
      style={
        {
          "--spread": "90deg",
          "--shimmer-color": shimmerColor,
          "--radius": borderRadius,
          "--speed": shimmerDuration,
          "--cut": shimmerSize,
          "--bg": background,
        } as CSSProperties
      }
      className={cn(
        "group relative z-0 inline-flex h-11 items-center justify-center overflow-hidden whitespace-nowrap px-4 text-sm font-semibold",
        "text-primary-foreground shadow-sm transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60",
        "[border-radius:var(--radius)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)]",
        "border border-white/10 [background:var(--bg)]",
        className,
      )}
      {...props}
    >
      {/* shimmer ring */}
      <span className="-z-30 absolute inset-0 blur-[2px] [container-type:size]">
        <span className="animate-shimmer-slide absolute inset-0 h-[100cqh] [aspect-ratio:1]">
          <span className="animate-spin-around absolute -inset-full w-auto rotate-0 [background:conic-gradient(from_calc(270deg-(var(--spread)*0.5)),transparent_0,var(--shimmer-color)_var(--spread),transparent_var(--spread))]" />
        </span>
      </span>

      {/* glossy highlight */}
      <span
        className={cn(
          "pointer-events-none absolute inset-0 -z-10",
          "shadow-[inset_0_-10px_14px_rgba(255,255,255,0.16)]",
          "transition group-hover:shadow-[inset_0_-8px_14px_rgba(255,255,255,0.24)]",
        )}
      />

      {/* backdrop cut */}
      <span className="absolute -z-20 [inset:var(--cut)] [border-radius:calc(var(--radius)-2px)] [background:var(--bg)]" />

      <span className="relative z-10">{children}</span>
    </button>
  );
}


