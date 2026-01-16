"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";

export function UserMenu() {
  const { user, isLoading, signOut } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const next = searchParams.get("next");

  if (isLoading) {
    return (
      <div className="h-9 w-28 animate-pulse rounded-xl border border-border bg-card" />
    );
  }

  if (!user) {
    return (
      <Link
        href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
        className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-muted"
      >
        Login
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={async () => {
        await signOut();
        router.replace("/login");
      }}
      className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-muted"
      title={user.email ?? "Signed in"}
    >
      Sign out
    </button>
  );
}


