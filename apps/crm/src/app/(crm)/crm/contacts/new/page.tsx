import { PageHeader } from "@/components/ui/PageHeader";
import ContactUpsertForm from "../ui/ContactUpsertForm";

export default function NewContactPage() {
  return (
    <div>
      <PageHeader title="New Contact" backHref="/crm/contacts" />
      <ContactUpsertForm mode="create" />
    </div>
  );
}


