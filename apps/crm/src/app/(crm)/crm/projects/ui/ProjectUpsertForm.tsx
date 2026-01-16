"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Field, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { LookupSelect } from "@/components/ui/LookupSelect";
import { useAuth } from "@/lib/auth/AuthProvider";
import { sbDelete, sbGetById, sbInsert, sbUpdate } from "@/lib/supabase/table";
import type { UnknownRecord } from "@/lib/db/coerce";
import { asString } from "@/lib/db/coerce";

const optionalEmail = z.union([z.string().email(), z.literal(""), z.null()]).optional();

const schema = z.object({
  name: z.string().min(1),
  account_id: z.string().nullable().optional(),
  category_1: z.string().nullable().optional(),
  category_2: z.string().nullable().optional(),
  site_address: z.string().nullable().optional(),
  whatsapp_group_name: z.string().nullable().optional(),
  ssoc_staff_id: z.string().nullable().optional(),
  active: z.boolean().optional(),
  special_remarks_project: z.string().nullable().optional(),
  auto_email_1: optionalEmail,
  auto_email_2: optionalEmail,
  auto_email_3: optionalEmail,
  auto_email_4: optionalEmail,
  auto_email_5: optionalEmail,
  auto_email_6: optionalEmail,
  auto_email_7: optionalEmail,
  auto_sms_1: z.string().nullable().optional(),
  auto_sms_2: z.string().nullable().optional(),
  auto_sms_3: z.string().nullable().optional(),
  auto_sms_4: z.string().nullable().optional(),
  auto_sms_5: z.string().nullable().optional(),
  auto_sms_6: z.string().nullable().optional(),
  auto_sms_7: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function ProjectUpsertForm({
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
      name: "",
      account_id: null,
      category_1: "",
      category_2: "",
      site_address: "",
      whatsapp_group_name: "",
      ssoc_staff_id: null,
      active: true,
      special_remarks_project: "",
      auto_email_1: "",
      auto_email_2: "",
      auto_email_3: "",
      auto_email_4: "",
      auto_email_5: "",
      auto_email_6: "",
      auto_email_7: "",
      auto_sms_1: "",
      auto_sms_2: "",
      auto_sms_3: "",
      auto_sms_4: "",
      auto_sms_5: "",
      auto_sms_6: "",
      auto_sms_7: "",
    },
  });

  useEffect(() => {
    if (mode !== "edit" || !id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await sbGetById<UnknownRecord>("projects", id, "*");
      if (cancelled) return;
      if (res.error) {
        setServerError(String(res.error.message ?? res.error));
        setLoading(false);
        return;
      }
      form.reset({
        name: asString(res.data.name) ?? "",
        account_id: asString(res.data.account_id),
        category_1: asString(res.data.category_1) ?? "",
        category_2: asString(res.data.category_2) ?? "",
        site_address: asString(res.data.site_address) ?? "",
        whatsapp_group_name: asString(res.data.whatsapp_group_name) ?? "",
        ssoc_staff_id: asString(res.data.ssoc_staff_id),
        active: Boolean(res.data.active ?? false),
        special_remarks_project: asString(res.data.special_remarks_project) ?? "",
        auto_email_1: asString(res.data.auto_email_1) ?? "",
        auto_email_2: asString(res.data.auto_email_2) ?? "",
        auto_email_3: asString(res.data.auto_email_3) ?? "",
        auto_email_4: asString(res.data.auto_email_4) ?? "",
        auto_email_5: asString(res.data.auto_email_5) ?? "",
        auto_email_6: asString(res.data.auto_email_6) ?? "",
        auto_email_7: asString(res.data.auto_email_7) ?? "",
        auto_sms_1: asString(res.data.auto_sms_1) ?? "",
        auto_sms_2: asString(res.data.auto_sms_2) ?? "",
        auto_sms_3: asString(res.data.auto_sms_3) ?? "",
        auto_sms_4: asString(res.data.auto_sms_4) ?? "",
        auto_sms_5: asString(res.data.auto_sms_5) ?? "",
        auto_sms_6: asString(res.data.auto_sms_6) ?? "",
        auto_sms_7: asString(res.data.auto_sms_7) ?? "",
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [form, id, mode]);

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Project</div>
          <div className="mt-1 text-lg font-semibold">
            {mode === "edit" ? form.watch("name") || "Project" : "Create project"}
          </div>
        </div>
        {mode === "edit" && id ? (
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              setServerError(null);
              const res = await sbDelete("projects", id);
              if (res.error) {
                setServerError(String(res.error.message ?? res.error));
                return;
              }
              router.replace("/crm/projects");
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
            ...values,
            account_id: values.account_id || null,
            ssoc_staff_id: values.ssoc_staff_id || null,
            category_1: values.category_1 || null,
            category_2: values.category_2 || null,
            site_address: values.site_address || null,
            whatsapp_group_name: values.whatsapp_group_name || null,
            special_remarks_project: values.special_remarks_project || null,
            auto_email_1: values.auto_email_1 || null,
            auto_email_2: values.auto_email_2 || null,
            auto_email_3: values.auto_email_3 || null,
            auto_email_4: values.auto_email_4 || null,
            auto_email_5: values.auto_email_5 || null,
            auto_email_6: values.auto_email_6 || null,
            auto_email_7: values.auto_email_7 || null,
            auto_sms_1: values.auto_sms_1 || null,
            auto_sms_2: values.auto_sms_2 || null,
            auto_sms_3: values.auto_sms_3 || null,
            auto_sms_4: values.auto_sms_4 || null,
            auto_sms_5: values.auto_sms_5 || null,
            auto_sms_6: values.auto_sms_6 || null,
            auto_sms_7: values.auto_sms_7 || null,
          };

          const res =
            mode === "edit" && id
              ? await sbUpdate<Record<string, unknown>>(
                  "projects",
                  id,
                  payload,
                  "id",
                )
              : await sbInsert<Record<string, unknown>>("projects", payload, "id");

          if (res.error) return setServerError(String(res.error.message ?? res.error));
          router.replace(`/crm/projects/${String(res.data.id)}`);
        })}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field className="md:col-span-2">
            <Label>Project Name</Label>
            <Input {...form.register("name")} />
          </Field>
          <Field>
            <Label>Main Contractor (Company)</Label>
            <LookupSelect
              table="accounts"
              labelColumn="name"
              value={form.watch("account_id")}
              onChange={(v) => form.setValue("account_id", v)}
              placeholder="Select company…"
            />
          </Field>
          <Field>
            <Label>Category 1</Label>
            <Input {...form.register("category_1")} />
          </Field>
          <Field>
            <Label>Category 2</Label>
            <Input {...form.register("category_2")} />
          </Field>
          <Field>
            <Label>SSOC Staff</Label>
            <LookupSelect
              table="contacts"
              labelColumn="first_name"
              value={form.watch("ssoc_staff_id")}
              onChange={(v) => form.setValue("ssoc_staff_id", v)}
              placeholder="Select staff…"
            />
          </Field>
          <Field className="md:col-span-2">
            <Label>Site Address</Label>
            <Textarea {...form.register("site_address")} />
          </Field>
          <Field>
            <Label>Whatsapp Group Name</Label>
            <Input {...form.register("whatsapp_group_name")} />
          </Field>
        </div>

        <Field>
          <Label>Special Remarks (Project)</Label>
          <Textarea {...form.register("special_remarks_project")} />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-muted/20 p-4">
            <div className="text-sm font-medium">Patient Case Auto Email</div>
            <div className="mt-3 grid gap-2">
              {([1, 2, 3, 4, 5, 6, 7] as const).map((n) => (
                <Field key={n}>
                  <Label>Auto Email {n}</Label>
                  <Input {...form.register(`auto_email_${n}` as const)} />
                </Field>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-muted/20 p-4">
            <div className="text-sm font-medium">Patient Case Auto SMS</div>
            <div className="mt-3 grid gap-2">
              {([1, 2, 3, 4, 5, 6, 7] as const).map((n) => (
                <Field key={n}>
                  <Label>Auto SMS {n}</Label>
                  <Input {...form.register(`auto_sms_${n}` as const)} />
                </Field>
              ))}
            </div>
          </div>
        </div>

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


