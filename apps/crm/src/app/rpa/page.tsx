"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Tabs, TabPanel } from "@/components/ui/Tabs";
import Flow1ExtractExcel from "./ui/Flow1ExtractExcel";
import Flow2EnhanceData from "./ui/Flow2EnhanceData";
import Flow3FillForms from "./ui/Flow3FillForms";
import RpaOverview from "./ui/RpaOverview";
import ExtractionActivityLog from "./ui/ExtractionActivityLog";

const tabs = [
  { id: "overview", label: "Overview", icon: <span className="text-xs" aria-hidden>◎</span> },
  { id: "flow1", label: "Flow 1: Extract Excel", icon: <span className="text-xs text-blue-600" aria-hidden>①</span> },
  { id: "flow2", label: "Flow 2: Enhance Data", icon: <span className="text-xs text-emerald-600" aria-hidden>②</span> },
  { id: "flow3", label: "Flow 3: Fill Forms", icon: <span className="text-xs text-violet-600" aria-hidden>③</span> },
  { id: "activity", label: "Activity Log", icon: <span className="text-xs text-amber-600" aria-hidden>▦</span> },
];

function RpaPageContent() {
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") || "overview";

  return (
    <div className="space-y-6">
      <PageHeader
        title="RPA Automation"
        subtitle="Three-step workflow: Extract → Enhance → Submit"
      />

      <Tabs tabs={tabs} defaultTab="overview" />

      <div className="mt-6">
        <TabPanel id="overview" activeTab={activeTab}>
          <RpaOverview />
        </TabPanel>

        <TabPanel id="flow1" activeTab={activeTab}>
          <div className="rounded-2xl border border-border bg-card p-6">
            <Flow1ExtractExcel />
          </div>
        </TabPanel>

        <TabPanel id="flow2" activeTab={activeTab}>
          <div className="rounded-2xl border border-border bg-card p-6">
            <Flow2EnhanceData />
          </div>
        </TabPanel>

        <TabPanel id="flow3" activeTab={activeTab}>
          <div className="rounded-2xl border border-border bg-card p-6">
            <Flow3FillForms />
          </div>
        </TabPanel>

        <TabPanel id="activity" activeTab={activeTab}>
          <div className="rounded-2xl border border-border bg-card p-6">
            <ExtractionActivityLog />
          </div>
        </TabPanel>
      </div>
    </div>
  );
}

export default function RpaPage() {
  return (
    <Suspense fallback={
      <div className="space-y-6">
        <PageHeader
          title="RPA Automation"
          subtitle="Three-step workflow: Extract → Enhance → Submit"
        />
        <div className="h-10 w-full animate-pulse rounded bg-muted" />
        <div className="mt-6 h-96 w-full animate-pulse rounded-2xl bg-muted" />
      </div>
    }>
      <RpaPageContent />
    </Suspense>
  );
}
