"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { isDemoMode } from "@/lib/env";
import { useAuth } from "@/lib/auth/AuthProvider";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

type FormValues = z.infer<typeof schema>;

export default function SignupForm() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();
  const { setDemoUserEmail } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  return (
    <form
      className="mt-6 space-y-3"
      onSubmit={form.handleSubmit(async (values) => {
        setServerError(null);
        setInfo(null);
        if (isDemoMode() || !supabase) {
          setDemoUserEmail?.(values.email);
        } else {
          const { data, error } = await supabase.auth.signUp(values);
          if (error) return setServerError(error.message);
          // If email confirmations are enabled in Supabase, session can be null.
          if (!data.session) {
            setInfo(
              "Account created. Please check your email to confirm before signing in.",
            );
            return;
          }
        }
        router.replace("/crm");
      })}
    >
      <label className="block">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          Email
        </div>
        <input
          type="email"
          placeholder="you@company.com"
          className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none ring-0 focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
          {...form.register("email")}
        />
        {form.formState.errors.email?.message ? (
          <div className="mt-1 text-xs text-red-600">
            {form.formState.errors.email.message}
          </div>
        ) : null}
      </label>

      <label className="block">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          Password
        </div>
        <input
          type="password"
          placeholder="••••••••"
          className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none ring-0 focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
          {...form.register("password")}
        />
        {form.formState.errors.password?.message ? (
          <div className="mt-1 text-xs text-red-600">
            {form.formState.errors.password.message}
          </div>
        ) : null}
      </label>

      {serverError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {serverError}
        </div>
      ) : null}

      {info ? (
        <div className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs text-white/80">
          {info}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={form.formState.isSubmitting}
        className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {form.formState.isSubmitting
          ? "Creating…"
          : isDemoMode()
            ? "Enter Demo"
            : "Create account"}
      </button>
    </form>
  );
}


