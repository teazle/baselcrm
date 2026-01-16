import { PageHeader } from "@/components/ui/PageHeader";
import TreatmentMasterUpsertForm from "../ui/TreatmentMasterUpsertForm";

export default function NewTreatmentMasterPage() {
  return (
    <div>
      <PageHeader title="New Treatment" backHref="/crm/treatment-master" />
      <TreatmentMasterUpsertForm mode="create" />
    </div>
  );
}


