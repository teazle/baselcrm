import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { RequireAuth } from "@/lib/auth/RequireAuth";
import { QuickCreateFab } from "@/components/crm/QuickCreateFab";
import { CrmShell } from "@/components/layout/CrmShell";

export default function CrmLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RequireAuth>
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex min-h-screen w-full">
          <Sidebar />
          <div className="min-w-0 flex-1">
            <Header />
            <main className="px-6 py-6">
              <CrmShell>{children}</CrmShell>
            </main>
          </div>
        </div>
      </div>
      <QuickCreateFab />
    </RequireAuth>
  );
}


