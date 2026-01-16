import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import TasksTable from "./ui/TasksTable";

export default function TasksPage() {
  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle="Follow-ups and admin work."
        actions={
          <Link
            href="/crm/tasks/new"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-95"
          >
            New Task
          </Link>
        }
      />
      <TasksTable />
    </div>
  );
}


