import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import ReceiptsTable from "./ui/ReceiptsTable";

export default function ReceiptsPage() {
  return (
    <div>
      <PageHeader
        title="Receipts"
        subtitle="Payments / credit notes. Apply to visits via Offsets."
        actions={
          <Link
            href="/crm/receipts/new"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-95"
          >
            New Receipt
          </Link>
        }
      />
      <ReceiptsTable />
    </div>
  );
}


