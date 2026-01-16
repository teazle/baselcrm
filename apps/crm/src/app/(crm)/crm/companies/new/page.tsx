import { PageHeader } from "@/components/ui/PageHeader";
import CompanyUpsertForm from "../ui/CompanyUpsertForm";

export default function NewCompanyPage() {
  return (
    <div>
      <PageHeader title="New Company" backHref="/crm/companies" />
      <CompanyUpsertForm mode="create" />
    </div>
  );
}


