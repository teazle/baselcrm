import { PageHeader } from "@/components/ui/PageHeader";
import CaseUpsertForm from "../ui/CaseUpsertForm";
import CaseVisitsList from "../ui/CaseVisitsList";

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="space-y-6">
      <PageHeader title="Case" backHref="/crm/cases" />
      <CaseUpsertForm mode="edit" id={id} />
      <CaseVisitsList caseId={id} />
    </div>
  );
}


