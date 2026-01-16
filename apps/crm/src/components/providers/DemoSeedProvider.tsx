"use client";

import { useEffect } from "react";
import { isDemoMode } from "@/lib/env";
import { ensureDemoSeeded } from "@/lib/mock/seed";

export function DemoSeedProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!isDemoMode()) return;
    ensureDemoSeeded();
  }, []);

  return <>{children}</>;
}


