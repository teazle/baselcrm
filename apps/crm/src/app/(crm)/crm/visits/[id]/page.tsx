import { PageHeader } from "@/components/ui/PageHeader";
import VisitUpsertForm from "../ui/VisitUpsertForm";
import VisitTreatmentsList from "../ui/VisitTreatmentsList";
import VisitRpaPanel from "../ui/VisitRpaPanel";

export default async function VisitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="space-y-6">
      <PageHeader title="Visit" backHref="/crm/visits" />
      <VisitRpaPanel visitId={id} />
      <VisitUpsertForm mode="edit" id={id} />
      <VisitTreatmentsList visitId={id} />
    </div>
  );
}

