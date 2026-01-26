import { PageHeader } from "@/components/ui/PageHeader";
import TaskUpsertForm from "../ui/TaskUpsertForm";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;
  return (
    <div>
      <PageHeader title="Task" backHref="/crm/tasks" />
      <TaskUpsertForm mode="edit" id={resolvedParams.id} />
    </div>
  );
}


