import { PageHeader } from "@/components/ui/PageHeader";
import TaskUpsertForm from "../ui/TaskUpsertForm";

export default function NewTaskPage() {
  return (
    <div>
      <PageHeader title="New Task" backHref="/crm/tasks" />
      <TaskUpsertForm mode="create" />
    </div>
  );
}


