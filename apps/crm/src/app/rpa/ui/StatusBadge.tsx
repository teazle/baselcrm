"use client";

import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";

type Status = "completed" | "failed" | "in_progress" | "pending";

const labels: Record<Status, string> = {
  completed: "Completed",
  failed: "Failed",
  in_progress: "In progress",
  pending: "Pending",
};

const styles: Record<Status, string> = {
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  in_progress: "border-amber-200 bg-amber-50 text-amber-700",
  pending: "border-border bg-muted/50 text-muted-foreground",
};

export function StatusBadge({
  status,
  className,
}: {
  status: Status;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
        styles[status],
        className,
      )}
    >
      {status === "in_progress" ? <Spinner className="h-3 w-3" /> : null}
      {labels[status]}
    </span>
  );
}

export type { Status };
