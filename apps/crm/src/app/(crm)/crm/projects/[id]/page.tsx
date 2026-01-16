import { PageHeader } from "@/components/ui/PageHeader";
import ProjectUpsertForm from "../ui/ProjectUpsertForm";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div>
      <PageHeader title="Project" backHref="/crm/projects" />
      <ProjectUpsertForm mode="edit" id={id} />
    </div>
  );
}


