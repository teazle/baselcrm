import { PageHeader } from "@/components/ui/PageHeader";
import TreatmentMasterUpsertForm from "../ui/TreatmentMasterUpsertForm";

export default async function TreatmentMasterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;
  return (
    <div>
      <PageHeader title="Treatment" backHref="/crm/treatment-master" />
      <TreatmentMasterUpsertForm mode="edit" id={resolvedParams.id} />
    </div>
  );
}


