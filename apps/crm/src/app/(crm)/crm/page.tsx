export default function CrmHome() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="text-xs font-medium text-muted-foreground">
          Baselrpa CRM
        </div>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">
          Dashboard
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This is the CRM shell. Next we’ll build list/detail pages for Contacts,
          Companies, Projects, Cases, Visits, and Receipts.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: "Open Cases", value: "—" },
          { label: "Visits Today", value: "—" },
          { label: "Outstanding Amount", value: "—" },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-2xl border border-border bg-card p-5"
          >
            <div className="text-xs text-muted-foreground">{kpi.label}</div>
            <div className="mt-2 text-2xl font-semibold">{kpi.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}


