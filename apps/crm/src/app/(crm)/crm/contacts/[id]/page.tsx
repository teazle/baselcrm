import { PageHeader } from "@/components/ui/PageHeader";
import ContactUpsertForm from "../ui/ContactUpsertForm";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div>
      <PageHeader title="Contact" backHref="/crm/contacts" />
      <ContactUpsertForm mode="edit" id={id} />
    </div>
  );
}


