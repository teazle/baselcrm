import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import ProjectsTable from "./ui/ProjectsTable";

export default function ProjectsPage() {
  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Per-company projects (holds auto-email/auto-SMS recipients)."
        actions={
          <Link
            href="/crm/projects/new"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-95"
          >
            New Project
          </Link>
        }
      />
      <ProjectsTable />
    </div>
  );
}


