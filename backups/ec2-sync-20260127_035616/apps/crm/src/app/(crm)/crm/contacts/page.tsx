import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import ContactsTable from "./ui/ContactsTable";

export default function ContactsPage() {
  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle="Patients, SSOC staff, and referral sources."
        actions={
          <Link
            href="/crm/contacts/new"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-95"
          >
            New Contact
          </Link>
        }
      />
      <ContactsTable />
    </div>
  );
}


