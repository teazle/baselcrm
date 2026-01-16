import { PageHeader } from "@/components/ui/PageHeader";
import ReceiptUpsertForm from "../ui/ReceiptUpsertForm";
import ReceiptOffsetsList from "../ui/ReceiptOffsetsList";

export default async function ReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="space-y-6">
      <PageHeader title="Receipt" backHref="/crm/receipts" />
      <ReceiptUpsertForm mode="edit" id={id} />
      <ReceiptOffsetsList receiptId={id} />
    </div>
  );
}


