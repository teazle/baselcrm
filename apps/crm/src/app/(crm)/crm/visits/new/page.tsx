import { PageHeader } from "@/components/ui/PageHeader";
import VisitUpsertForm from "../ui/VisitUpsertForm";

export default async function NewVisitPage({
  searchParams,
}: {
  searchParams?: Promise<{ caseId?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  return (
    <div>
      <PageHeader title="New Visit" backHref="/crm/visits" />
      <VisitUpsertForm mode="create" initialCaseId={sp.caseId} />
    </div>
  );
}


