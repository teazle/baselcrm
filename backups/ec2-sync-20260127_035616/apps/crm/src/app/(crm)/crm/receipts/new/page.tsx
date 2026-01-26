import { PageHeader } from "@/components/ui/PageHeader";
import ReceiptUpsertForm from "../ui/ReceiptUpsertForm";

export default function NewReceiptPage() {
  return (
    <div>
      <PageHeader title="New Receipt" backHref="/crm/receipts" />
      <ReceiptUpsertForm mode="create" />
    </div>
  );
}


