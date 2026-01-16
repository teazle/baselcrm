import { PageHeader } from "@/components/ui/PageHeader";
import ReportsPanel from "./ui/ReportsPanel";

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        subtitle="Exports and print templates (placeholders for now)."
      />
      <ReportsPanel />
    </div>
  );
}


