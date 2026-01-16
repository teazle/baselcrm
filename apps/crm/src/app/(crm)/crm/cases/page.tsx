import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import CasesTable from "./ui/CasesTable";

export default function CasesPage() {
  return (
    <div>
      <PageHeader
        title="Cases"
        subtitle="Work injury cases — parent record for Visits."
        actions={
          <Link
            href="/crm/cases/new"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-95"
          >
            New Case
          </Link>
        }
      />
      <CasesTable />
    </div>
  );
}


