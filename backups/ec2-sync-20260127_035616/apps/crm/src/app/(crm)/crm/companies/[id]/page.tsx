import { PageHeader } from "@/components/ui/PageHeader";
import CompanyUpsertForm from "../ui/CompanyUpsertForm";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div>
      <PageHeader title="Company" backHref="/crm/companies" />
      <CompanyUpsertForm mode="edit" id={id} />
    </div>
  );
}


