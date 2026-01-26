"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Field, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth/AuthProvider";
import { sbDelete, sbGetById, sbInsert, sbUpdate } from "@/lib/supabase/table";
import type { UnknownRecord } from "@/lib/db/coerce";
import { asString } from "@/lib/db/coerce";

const schema = z.object({
  subject: z.string().min(1, "Subject is required."),
  status: z.string().optional(),
  priority: z.string().optional(),
  due_date: z.string().optional(),
  description: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function TaskUpsertForm({
  mode,
  id,
}: {
  mode: "create" | "edit";
  id?: string;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(mode === "edit");
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      subject: "",
      status: "Not Started",
      priority: "Medium",
      due_date: "",
      description: "",
    },
  });

  useEffect(() => {
    if (mode !== "edit" || !id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setServerError(null);
      try {
        const res = await sbGetById<UnknownRecord>("tasks", id, "*");
        if (cancelled) return;
        if (res.error) {
          setServerError(String(res.error.message ?? res.error));
          return;
        }
        form.reset({
          subject: asString(res.data.subject) ?? "",
          status: asString(res.data.status) ?? "Not Started",
          priority: asString(res.data.priority) ?? "Medium",
          due_date: asString(res.data.due_date) ?? "",
          description: asString(res.data.description) ?? "",
        });
      } catch (e) {
        if (cancelled) return;
        setServerError(String((e as any)?.message ?? e));
      } finally {
        if (cancelled) return;
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally omit `form` from deps (it is stable, but including it can
    // cause unnecessary re-fetch loops in dev StrictMode).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mode]);

  const title = useMemo(() => {
    const subject = form.watch("subject") || "Unnamed";
    return mode === "edit" ? subject : "Create task";
  }, [form, mode]);

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Task</div>
          <div className="mt-1 text-lg font-semibold">{title}</div>
        </div>
        {mode === "edit" && id ? (
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              setServerError(null);
              const res = await sbDelete("tasks", id);
              if (res.error) {
                setServerError(String(res.error.message ?? res.error));
                return;
              }
              router.replace("/crm/tasks");
            }}
          >
            Delete
          </Button>
        ) : null}
      </div>

      {serverError ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {serverError}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4 text-sm text-muted-foreground">Loading…</div>
      ) : null}

      <form
        className="mt-6 grid gap-4"
        onSubmit={form.handleSubmit(async (values) => {
          setServerError(null);
          if (!user) return setServerError("Not signed in.");

          const payload: Record<string, unknown> = {
            user_id: user.id,
            subject: values.subject.trim(),
          };
          // Optional fields: only send when present to keep schema-tolerant.
          const status = values.status?.trim();
          if (status) payload.status = status;
          const priority = values.priority?.trim();
          if (priority) payload.priority = priority;
          const due = values.due_date?.trim();
          if (due) payload.due_date = due;
          const desc = values.description?.trim();
          if (desc) payload.description = desc;

          const res =
            mode === "edit" && id
              ? await sbUpdate("tasks", id, payload, "id")
              : await sbInsert("tasks", payload, "id");

          if (res.error) {
            setServerError(String(res.error.message ?? res.error));
            return;
          }
          // @ts-expect-error sbInsert/sbUpdate returns at least {id}
          router.replace(`/crm/tasks/${res.data.id}`);
        })}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field className="md:col-span-3">
            <Label>Subject</Label>
            <Input placeholder="e.g. Follow up with employer" {...form.register("subject")} />
          </Field>

          <Field>
            <Label>Status</Label>
            <select
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
              {...form.register("status")}
            >
              <option value="Not Started">Not Started</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
              <option value="Waiting on someone else">Waiting on someone else</option>
              <option value="Deferred">Deferred</option>
            </select>
          </Field>

          <Field>
            <Label>Priority</Label>
            <select
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
              {...form.register("priority")}
            >
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </Field>

          <Field>
            <Label>Due Date</Label>
            <Input type="date" {...form.register("due_date")} />
          </Field>
        </div>

        <Field>
          <Label>Description</Label>
          <Textarea placeholder="Details…" {...form.register("description")} />
        </Field>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit">{mode === "edit" ? "Save" : "Create"}</Button>
        </div>
      </form>
    </Card>
  );
}


