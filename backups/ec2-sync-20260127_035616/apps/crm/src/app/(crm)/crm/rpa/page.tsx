import { PageHeader } from "@/components/ui/PageHeader";
import RpaDashboard from "./ui/RpaDashboard";
import ExtractionActivityLog from "./ui/ExtractionActivityLog";
import VisitsStatusTable from "./ui/VisitsStatusTable";
import ManualTriggers from "./ui/ManualTriggers";
import RealTimeStatus from "./ui/RealTimeStatus";
import StatisticsCharts from "./ui/StatisticsCharts";

export default function RpaPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="RPA Automation"
        subtitle="Monitor Clinic Assist queue and visit details extraction runs."
      />

      <RpaDashboard />

      <div className="grid gap-6 lg:grid-cols-2">
        <RealTimeStatus />
        <ManualTriggers />
      </div>

      <ExtractionActivityLog />
      <VisitsStatusTable />
      <StatisticsCharts />
    </div>
  );
}
