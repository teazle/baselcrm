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

const schema = z.object({
  case_date: z.string().min(1),
  contact_id: z.string().min(1),
  project_id: z.string().min(1),
  bill_to_company_id: z.string().nullable().optional(),
  invoice_billed_to: z
    .enum(["Main Contractor", "Direct Employer", "Others", "Self Payment"])
    .nullable()
    .optional(),
  type_of_case: z
    .enum([
      "Billing",
      "Dental",
      "Dermatology",
      "ENT",
      "Eye",
      "Non-orthopaedic",
      "Orthopaedic",
      "Urology",
    ])
    .nullable()
    .optional(),
  region: z.string().nullable().optional(),
  injury_details: z.string().nullable().optional(),
  injury_description: z.string().nullable().optional(),
  date_of_injury: z.string().nullable().optional(),
  monitor_case: z.boolean().optional(),
  trigger_sms: z.boolean().optional(),
  reg_remark: z.string().nullable().optional(),
  dispensing_remark: z.string().nullable().optional(),
  payment_remark: z.string().nullable().optional(),
  special_remarks_company: z.string().nullable().optional(),
  special_remarks_contact: z.string().nullable().optional(),
  special_remarks_project: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function CaseUpsertForm({
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
      case_date: "",
      contact_id: "",
      project_id: "",
      bill_to_company_id: null,
      invoice_billed_to: null,
      type_of_case: "Orthopaedic",
      region: "",
      injury_details: "",
      injury_description: "",
      date_of_injury: "",
      monitor_case: false,
      trigger_sms: false,
      reg_remark: "",
      dispensing_remark: "",
      payment_remark: "",
      special_remarks_company: "",
      special_remarks_contact: "",
      special_remarks_project: "",
    },
  });

  useEffect(() => {
    if (mode !== "edit" || !id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await sbGetById<UnknownRecord>("cases", id, "*");
      if (cancelled) return;
      if (res.error) {
        setServerError(String(res.error.message ?? res.error));
        setLoading(false);
        return;
      }
      form.reset({
        case_date: asString(res.data.case_date) ?? "",
        contact_id: asString(res.data.contact_id) ?? "",
        project_id: asString(res.data.project_id) ?? "",
        bill_to_company_id: asString(res.data.bill_to_company_id),
        invoice_billed_to:
          (asString(res.data.invoice_billed_to) as FormValues["invoice_billed_to"]) ??
          null,
        type_of_case:
          (asString(res.data.type_of_case) as FormValues["type_of_case"]) ?? null,
        region: Array.isArray(res.data.region)
          ? (res.data.region as unknown[]).map((x) => String(x)).join("; ")
          : asString(res.data.region) ?? "",
        injury_details: asString(res.data.injury_details) ?? "",
        injury_description: asString(res.data.injury_description) ?? "",
        date_of_injury: asString(res.data.date_of_injury)?.slice(0, 10) ?? "",
        monitor_case: Boolean(res.data.monitor_case ?? false),
        trigger_sms: Boolean(res.data.trigger_sms ?? false),
        reg_remark: asString(res.data.reg_remark) ?? "",
        dispensing_remark: asString(res.data.dispensing_remark) ?? "",
        payment_remark: asString(res.data.payment_remark) ?? "",
        special_remarks_company: asString(res.data.special_remarks_company) ?? "",
        special_remarks_contact: asString(res.data.special_remarks_contact) ?? "",
        special_remarks_project: asString(res.data.special_remarks_project) ?? "",
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
          <div className="text-xs font-medium text-muted-foreground">Case</div>
          <div className="mt-1 text-lg font-semibold">
            {mode === "edit" ? "Edit case" : "Create case"}
          </div>
        </div>
        {mode === "edit" && id ? (
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              setServerError(null);
              const res = await sbDelete("cases", id);
              if (res.error) return setServerError(String(res.error.message ?? res.error));
              router.replace("/crm/cases");
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
            bill_to_company_id: values.bill_to_company_id || null,
            invoice_billed_to: values.invoice_billed_to || null,
            type_of_case: values.type_of_case || null,
            region: values.region || null,
            injury_details: values.injury_details || null,
            injury_description: values.injury_description || null,
            date_of_injury: values.date_of_injury || null,
            reg_remark: values.reg_remark || null,
            dispensing_remark: values.dispensing_remark || null,
            payment_remark: values.payment_remark || null,
            special_remarks_company: values.special_remarks_company || null,
            special_remarks_contact: values.special_remarks_contact || null,
            special_remarks_project: values.special_remarks_project || null,
          };

          const res =
            mode === "edit" && id
              ? await sbUpdate<Record<string, unknown>>("cases", id, payload, "id")
              : await sbInsert<Record<string, unknown>>("cases", payload, "id");
          if (res.error) return setServerError(String(res.error.message ?? res.error));

          router.replace(`/crm/cases/${String(res.data.id)}`);
        })}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field>
            <Label>Case Date</Label>
            <Input type="date" {...form.register("case_date")} />
          </Field>
          <Field className="md:col-span-2">
            <Label>Patient (Contact)</Label>
            <LookupSelect
              table="contacts"
              labelColumn="first_name"
              value={form.watch("contact_id")}
              onChange={(v) => form.setValue("contact_id", v ?? "")}
              placeholder="Select patient…"
            />
          </Field>
          <Field className="md:col-span-2">
            <Label>Project</Label>
            <LookupSelect
              table="projects"
              labelColumn="name"
              value={form.watch("project_id")}
              onChange={(v) => form.setValue("project_id", v ?? "")}
              placeholder="Select project…"
            />
          </Field>
          <Field>
            <Label>Bill To Company</Label>
            <LookupSelect
              table="accounts"
              labelColumn="name"
              value={form.watch("bill_to_company_id")}
              onChange={(v) => form.setValue("bill_to_company_id", v)}
              placeholder="(optional)"
            />
          </Field>
          <Field>
            <Label>Invoice Billed To</Label>
            <select
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
              {...form.register("invoice_billed_to")}
            >
              <option value="">—</option>
              <option value="Main Contractor">Main Contractor</option>
              <option value="Direct Employer">Direct Employer</option>
              <option value="Others">Others</option>
              <option value="Self Payment">Self Payment</option>
            </select>
          </Field>
          <Field>
            <Label>Type of Case</Label>
            <select
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
              {...form.register("type_of_case")}
            >
              <option value="">—</option>
              {[
                "Billing",
                "Dental",
                "Dermatology",
                "ENT",
                "Eye",
                "Non-orthopaedic",
                "Orthopaedic",
                "Urology",
              ].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <Label>Date of Injury</Label>
            <Input type="date" {...form.register("date_of_injury")} />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <Label>Region (multi)</Label>
            <Textarea placeholder="e.g. Wrist; Hand" {...form.register("region")} />
          </Field>
          <Field>
            <Label>Injury Details</Label>
            <Input {...form.register("injury_details")} />
          </Field>
          <Field className="md:col-span-2">
            <Label>Injury Description</Label>
            <Textarea {...form.register("injury_description")} />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Field>
            <Label>Reg Remark</Label>
            <Textarea {...form.register("reg_remark")} />
          </Field>
          <Field>
            <Label>Dispensing Remark</Label>
            <Textarea {...form.register("dispensing_remark")} />
          </Field>
          <Field>
            <Label>Payment Remark</Label>
            <Textarea {...form.register("payment_remark")} />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Field>
            <Label>Special Remarks (Company)</Label>
            <Textarea {...form.register("special_remarks_company")} />
          </Field>
          <Field>
            <Label>Special Remarks (Contact)</Label>
            <Textarea {...form.register("special_remarks_contact")} />
          </Field>
          <Field>
            <Label>Special Remarks (Project)</Label>
            <Textarea {...form.register("special_remarks_project")} />
          </Field>
        </div>

        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("monitor_case")} />
            Monitor Case
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("trigger_sms")} />
            Trigger SMS
          </label>
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


