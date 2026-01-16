import { PageHeader } from "@/components/ui/PageHeader";
import ProjectUpsertForm from "../ui/ProjectUpsertForm";

export default function NewProjectPage() {
  return (
    <div>
      <PageHeader title="New Project" backHref="/crm/projects" />
      <ProjectUpsertForm mode="create" />
    </div>
  );
}


