import { PageHeader } from "@/components/ui/PageHeader";
import Flow1ExtractExcel from "./ui/Flow1ExtractExcel";
import Flow2EnhanceData from "./ui/Flow2EnhanceData";
import Flow3FillForms from "./ui/Flow3FillForms";

export default function RpaPage() {
  return (
    <div className="space-y-12">
      <PageHeader
        title="RPA Automation"
        subtitle="Three-step workflow: Extract → Enhance → Submit"
      />

      <div className="space-y-8">
        <section className="rounded-2xl border border-border bg-card p-6">
          <Flow1ExtractExcel />
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <Flow2EnhanceData />
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <Flow3FillForms />
        </section>
      </div>
    </div>
  );
}
