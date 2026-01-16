import { PageHeader } from "@/components/ui/PageHeader";
import CaseUpsertForm from "../ui/CaseUpsertForm";

export default function NewCasePage() {
  return (
    <div>
      <PageHeader title="New Case" backHref="/crm/cases" />
      <CaseUpsertForm mode="create" />
    </div>
  );
}


