import { cn } from "@/lib/cn";

type StepStatus = "ready" | "running" | "pending" | "attention";

type Step = {
  id: string;
  title: string;
  subtitle: string;
  tone: string;
  status: StepStatus;
  statusLabel: string;
};

const statusStyles: Record<StepStatus, string> = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
  running: "border-amber-200 bg-amber-50 text-amber-700",
  pending: "border-slate-200 bg-slate-50 text-slate-600",
  attention: "border-red-200 bg-red-50 text-red-700",
};

const statusDots: Record<StepStatus, string> = {
  ready: "bg-emerald-500",
  running: "bg-amber-500",
  pending: "bg-slate-400",
  attention: "bg-red-500",
};

export default function FlowStepper({
  className,
  steps,
}: {
  className?: string;
  steps: Step[];
}) {
  return (
    <div className={cn("rounded-2xl border border-border bg-card p-4", className)}>
      <div className="text-xs font-medium text-muted-foreground">Process Flow</div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-2xl border text-sm font-semibold",
                step.tone,
              )}
            >
              {step.id}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className={cn("h-2 w-2 rounded-full", statusDots[step.status])} />
                {step.title}
              </div>
              <div className="text-xs text-muted-foreground">{step.subtitle}</div>
            </div>
            <span
              className={cn(
                "ml-auto hidden rounded-full border px-2 py-0.5 text-[10px] font-medium md:inline-flex",
                statusStyles[step.status],
              )}
            >
              {step.statusLabel}
            </span>
            {index < steps.length - 1 ? (
              <div className="hidden flex-1 items-center justify-center md:flex">
                <div className="h-px w-full bg-border" />
                <span className="-ml-2 text-xs text-muted-foreground">→</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
