"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabaseBrowser } from "@/lib/supabase/browser";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

type FormValues = z.infer<typeof schema>;

export default function LoginForm() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const next = searchParams.get("next") || "/crm";

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
        if (!supabase) {
          setServerError("Supabase is not configured.");
          return;
        }
        const { error } = await supabase.auth.signInWithPassword(values);
        if (error) {
          setServerError(error.message);
          return;
        }
        router.replace(next);
      })}
    >
      <label className="block">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          Email
        </div>
        <input
          type="email"
          placeholder="you@company.com"
          className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm text-gray-900 outline-none ring-0 placeholder:text-gray-500 focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
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
          className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm text-gray-900 outline-none ring-0 placeholder:text-gray-500 focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
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

      {supabase && serverError?.toLowerCase().includes("not confirmed") ? (
        <div className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs text-white/80">
          <div>Email confirmation is enabled in Supabase.</div>
          <button
            type="button"
            className="mt-2 font-medium text-white underline underline-offset-4"
            onClick={async () => {
              setServerError(null);
              setInfo(null);
              const email = form.getValues("email");
              const { error } = await supabase.auth.resend({
                type: "signup",
                email,
              });
              if (error) return setServerError(error.message);
              setInfo("Confirmation email resent. Please check your inbox.");
            }}
          >
            Resend confirmation email
          </button>
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
        {form.formState.isSubmitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
