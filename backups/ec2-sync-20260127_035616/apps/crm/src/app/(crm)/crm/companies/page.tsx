import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import CompaniesTable from "./ui/CompaniesTable";

export default function CompaniesPage() {
  return (
    <div>
      <PageHeader
        title="Companies"
        subtitle="Employer / contractor accounts (Statement of Account lives here)."
        actions={
          <Link
            href="/crm/companies/new"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-95"
          >
            New Company
          </Link>
        }
      />
      <CompaniesTable />
    </div>
  );
}


