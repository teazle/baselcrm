import { RequireAuth } from "@/lib/auth/RequireAuth";
import { SupabaseRequired } from "@/components/providers/SupabaseRequired";
import Link from "next/link";
import Breadcrumbs from "./ui/Breadcrumbs";

export default function RpaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SupabaseRequired>
    <RequireAuth>
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-10 border-b border-border bg-background/70 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-6">
            <div className="flex flex-1 items-center gap-3">
              <Link
                href="/rpa"
                className="flex items-center gap-3 hover:opacity-80 transition"
              >
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                  <span className="text-sm font-semibold">R</span>
                </div>
                <div>
                  <div className="text-sm font-semibold leading-5">RPA Automation</div>
                  <div className="text-[11px] text-muted-foreground">Workflow automation</div>
                </div>
              </Link>
              <div className="flex-1" />
              <nav className="flex items-center gap-4">
                <Link
                  href="/rpa"
                  className="text-sm text-muted-foreground hover:text-foreground transition"
                >
                  Overview
                </Link>
                <Link
                  href="/rpa/settings"
                  className="text-sm text-muted-foreground hover:text-foreground transition"
                >
                  Settings
                </Link>
                <Link
                  href="/crm"
                  className="text-sm text-muted-foreground hover:text-foreground transition"
                >
                  Go to CRM →
                </Link>
              </nav>
            </div>
          </div>
        </header>
        <main className="px-6 py-6">
          <Breadcrumbs className="mb-4" />
          {children}
        </main>
      </div>
    </RequireAuth>
    </SupabaseRequired>
  );
}
