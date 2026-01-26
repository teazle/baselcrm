"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      const next = encodeURIComponent(pathname || "/crm");
      router.replace(`/login?next=${next}`);
    }
  }, [isLoading, pathname, router, user]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6">
          <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
            Loading…
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;
  return <>{children}</>;
}


