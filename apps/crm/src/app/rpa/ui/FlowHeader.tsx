import { cn } from "@/lib/cn";

const toneStyles: Record<string, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-red-200 bg-red-50 text-red-700",
  neutral: "border-border bg-muted/50 text-muted-foreground",
};

type FlowHeaderProps = {
  flow: string;
  title: string;
  description: string;
  accentClassName?: string;
  statusLabel?: string;
  statusTone?: keyof typeof toneStyles;
};

export default function FlowHeader({
  flow,
  title,
  description,
  accentClassName,
  statusLabel,
  statusTone = "neutral",
}: FlowHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "grid h-10 w-10 place-items-center rounded-2xl border text-sm font-semibold",
            accentClassName,
          )}
        >
          {flow}
        </div>
        <div>
          <div className="text-sm font-medium text-muted-foreground">Flow {flow}</div>
          <div className="text-2xl font-semibold">{title}</div>
          <div className="mt-2 text-sm text-muted-foreground">{description}</div>
        </div>
      </div>
      {statusLabel ? (
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
            toneStyles[statusTone],
          )}
        >
          {statusLabel}
        </span>
      ) : null}
    </div>
  );
}
