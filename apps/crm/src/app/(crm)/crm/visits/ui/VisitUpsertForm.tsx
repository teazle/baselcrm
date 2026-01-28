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
  case_id: z.string().min(1),
  visit_date: z.string().min(1),
  time_arrived: z.string().nullable().optional(),
  time_left: z.string().nullable().optional(),
  symptoms: z.string().nullable().optional(),
  examination_detail: z.string().nullable().optional(),
  investigation_detail: z.string().nullable().optional(),
  diagnosis_description: z.string().nullable().optional(),
  treatment_detail: z.string().nullable().optional(),
  instruction_to_patient: z.string().nullable().optional(),
  mc_required: z.boolean().optional(),
  mc_start_date: z.string().nullable().optional(),
  mc_end_date: z.string().nullable().optional(),
  light_duty_required: z.boolean().optional(),
  light_duty_start_date: z.string().nullable().optional(),
  light_duty_end_date: z.string().nullable().optional(),
  total_amount: z.coerce.number().nullable().optional(),
  amount_outstanding: z.coerce.number().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function VisitUpsertForm({
  mode,
  id,
  initialCaseId,
}: {
  mode: "create" | "edit";
  id?: string;
  initialCaseId?: string;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(mode === "edit");
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      case_id: initialCaseId ?? "",
      visit_date: "",
      time_arrived: "",
      time_left: "",
      symptoms: "",
      examination_detail: "",
      investigation_detail: "",
      diagnosis_description: "",
      treatment_detail: "",
      instruction_to_patient: "",
      mc_required: false,
      mc_start_date: "",
      mc_end_date: "",
      light_duty_required: false,
      light_duty_start_date: "",
      light_duty_end_date: "",
      total_amount: null,
      amount_outstanding: null,
    },
  });

  async function load() {
    if (mode !== "edit" || !id) return;
    setLoading(true);
    const res = await sbGetById<UnknownRecord>("visits", id, "*");
    if (res.error) {
      setServerError(String(res.error.message ?? res.error));
      setLoading(false);
      return;
    }
    form.reset({
      case_id: asString(res.data.case_id) ?? "",
      visit_date: asString(res.data.visit_date) ?? "",
      time_arrived: asString(res.data.time_arrived) ?? "",
      time_left: asString(res.data.time_left) ?? "",
      symptoms: asString(res.data.symptoms) ?? "",
      examination_detail: asString(res.data.examination_detail) ?? "",
      investigation_detail: asString(res.data.investigation_detail) ?? "",
      diagnosis_description: asString(res.data.diagnosis_description) ?? "",
      treatment_detail: asString(res.data.treatment_detail) ?? "",
      instruction_to_patient: asString(res.data.instruction_to_patient) ?? "",
      mc_required: Boolean(res.data.mc_required ?? false),
      mc_start_date: asString(res.data.mc_start_date) ?? "",
      mc_end_date: asString(res.data.mc_end_date) ?? "",
      light_duty_required: Boolean(res.data.light_duty_required ?? false),
      light_duty_start_date: asString(res.data.light_duty_start_date) ?? "",
      light_duty_end_date: asString(res.data.light_duty_end_date) ?? "",
      total_amount: res.data.total_amount as number | null ?? null,
      amount_outstanding: res.data.amount_outstanding as number | null ?? null,
    });
    setLoading(false);
  }

  useEffect(() => {
    if (mode !== "edit" || !id) return;
    let cancelled = false;
    (async () => {
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [form, id, mode]);

  useEffect(() => {
    if (mode !== "edit" || !id) return;
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { visitId?: string } | undefined;
      if (detail?.visitId && String(detail.visitId) !== String(id)) return;
      load();
    };
    window.addEventListener("crm:data-changed", onChanged);
    return () => window.removeEventListener("crm:data-changed", onChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mode]);

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Visit</div>
          <div className="mt-1 text-lg font-semibold">
            {mode === "edit" ? "Edit visit" : "Create visit"}
          </div>
        </div>
        {mode === "edit" && id ? (
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              setServerError(null);
              const res = await sbDelete("visits", id);
              if (res.error) return setServerError(String(res.error.message ?? res.error));
              router.replace("/crm/visits");
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
            time_arrived: values.time_arrived || null,
            time_left: values.time_left || null,
            symptoms: values.symptoms || null,
            examination_detail: values.examination_detail || null,
            investigation_detail: values.investigation_detail || null,
            diagnosis_description: values.diagnosis_description || null,
            treatment_detail: values.treatment_detail || null,
            instruction_to_patient: values.instruction_to_patient || null,
            mc_start_date: values.mc_start_date || null,
            mc_end_date: values.mc_end_date || null,
            light_duty_start_date: values.light_duty_start_date || null,
            light_duty_end_date: values.light_duty_end_date || null,
          };
          // Outstanding is computed from total_amount minus matched offsets.
          delete payload.amount_outstanding;
          if (payload.amount_outstanding == null && typeof payload.total_amount === "number") {
            payload.amount_outstanding = payload.total_amount;
          }

          const res =
            mode === "edit" && id
              ? await sbUpdate<Record<string, unknown>>("visits", id, payload, "id")
              : await sbInsert<Record<string, unknown>>("visits", payload, "id");
          if (res.error) return setServerError(String(res.error.message ?? res.error));
          router.replace(`/crm/visits/${String(res.data.id)}`);
        })}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field className="md:col-span-2">
            <Label>Case</Label>
            <LookupSelect
              table="cases"
              labelColumn="case_no"
              value={form.watch("case_id")}
              onChange={(v) => form.setValue("case_id", v ?? "")}
              placeholder="Select case…"
            />
          </Field>
          <Field>
            <Label>Visit Date</Label>
            <Input type="date" {...form.register("visit_date")} />
          </Field>
          <Field>
            <Label>Time Arrived</Label>
            <Input type="time" {...form.register("time_arrived")} />
          </Field>
          <Field>
            <Label>Time Left</Label>
            <Input type="time" {...form.register("time_left")} />
          </Field>
          <Field>
            <Label>Total Amount</Label>
            <Input type="number" step="0.01" {...form.register("total_amount")} />
          </Field>
          <Field>
            <Label>Outstanding</Label>
            <Input type="number" step="0.01" readOnly {...form.register("amount_outstanding")} />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <Label>Symptoms</Label>
            <Textarea {...form.register("symptoms")} />
          </Field>
          <Field>
            <Label>Examination</Label>
            <Textarea {...form.register("examination_detail")} />
          </Field>
          <Field>
            <Label>Investigation</Label>
            <Textarea {...form.register("investigation_detail")} />
          </Field>
          <Field>
            <Label>Diagnosis</Label>
            <Textarea {...form.register("diagnosis_description")} />
          </Field>
          <Field className="md:col-span-2">
            <Label>Treatment</Label>
            <Textarea {...form.register("treatment_detail")} />
          </Field>
          <Field className="md:col-span-2">
            <Label>Instruction to Patient</Label>
            <Textarea {...form.register("instruction_to_patient")} />
          </Field>
        </div>

        <div className="rounded-2xl border border-border bg-muted/20 p-4">
          <div className="text-sm font-medium">MC / Light Duty</div>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...form.register("mc_required")} /> MC
                required
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <Field>
                  <Label>MC Start</Label>
                  <Input type="date" {...form.register("mc_start_date")} />
                </Field>
                <Field>
                  <Label>MC End</Label>
                  <Input type="date" {...form.register("mc_end_date")} />
                </Field>
              </div>
            </div>
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...form.register("light_duty_required")} /> Light
                duty required
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <Field>
                  <Label>LD Start</Label>
                  <Input type="date" {...form.register("light_duty_start_date")} />
                </Field>
                <Field>
                  <Label>LD End</Label>
                  <Input type="date" {...form.register("light_duty_end_date")} />
                </Field>
              </div>
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


