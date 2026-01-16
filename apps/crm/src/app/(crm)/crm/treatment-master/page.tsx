import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import TreatmentMasterTable from "./ui/TreatmentMasterTable";

export default function TreatmentMasterPage() {
  return (
    <div>
      <PageHeader
        title="Treatment Master"
        subtitle="Manage items used for visit line items."
        actions={
          <Link
            href="/crm/treatment-master/new"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-95"
          >
            New Treatment
          </Link>
        }
      />
      <TreatmentMasterTable />
    </div>
  );
}


