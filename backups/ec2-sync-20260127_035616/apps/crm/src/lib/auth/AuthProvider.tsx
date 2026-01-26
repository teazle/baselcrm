"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { isDemoMode } from "@/lib/env";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  setDemoUserEmail?: (email: string) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [demoEmail, setDemoEmail] = useState<string | null>(null);

  useEffect(() => {
    if (isDemoMode() || !supabase) {
      const stored = localStorage.getItem("demo:userEmail");
      setDemoEmail(stored || "demo@baselrpa.local");
      setSession(null);
      setIsLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        // If env vars are missing, supabase client throws earlier.
        // If session fetch fails, treat as signed out.
        setSession(null);
      } else {
        setSession(data.session ?? null);
      }
      setIsLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        setIsLoading(false);
      },
    );

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabase]);

  const value: AuthContextValue = {
    user:
      isDemoMode() || !supabase
        ? (({
            id: "00000000-0000-0000-0000-000000000000",
            aud: "authenticated",
            role: "authenticated",
            email: demoEmail ?? "demo@baselrpa.local",
            app_metadata: {},
            user_metadata: {},
            created_at: new Date(0).toISOString(),
          } as unknown) as User)
        : session?.user ?? null,
    session,
    isLoading,
    signOut: async () => {
      if (isDemoMode() || !supabase) {
        localStorage.removeItem("demo:userEmail");
        setDemoEmail(null);
        return;
      }
      await supabase.auth.signOut();
    },
    setDemoUserEmail: (email: string) => {
      localStorage.setItem("demo:userEmail", email);
      setDemoEmail(email);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider />");
  return ctx;
}


