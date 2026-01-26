import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import VisitsTable from "./ui/VisitsTable";

export default function VisitsPage() {
  return (
    <div>
      <PageHeader
        title="Visits"
        subtitle="Clinical + billing visit record under a Case."
        actions={
          <Link
            href="/crm/visits/new"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-95"
          >
            New Visit
          </Link>
        }
      />
      <VisitsTable />
    </div>
  );
}


