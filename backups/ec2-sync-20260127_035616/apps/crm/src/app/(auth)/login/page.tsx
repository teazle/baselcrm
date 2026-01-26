import { Suspense } from "react";
import LoginHero from "./ui/LoginHero";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
          Loading…
        </div>
      }
    >
      <LoginHero />
    </Suspense>
  );
}
