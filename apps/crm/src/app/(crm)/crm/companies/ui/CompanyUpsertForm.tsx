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
import type { Account } from "@/lib/db/models";
import { useAuth } from "@/lib/auth/AuthProvider";
import { sbDelete, sbGetById, sbInsert, sbUpdate } from "@/lib/supabase/table";
import type { UnknownRecord } from "@/lib/db/coerce";
import { asString } from "@/lib/db/coerce";

const optionalEmail = z.union([z.string().email(), z.literal(""), z.null()]).optional();

const schema = z.object({
  name: z.string().min(1),
  company_code: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  fax: z.string().nullable().optional(),
  active: z.boolean().optional(),
  mou_date: z.string().nullable().optional(),
  email_statement_of_account: optionalEmail,
  billing_street: z.string().nullable().optional(),
  reg_remark: z.string().nullable().optional(),
  dispensing_remark: z.string().nullable().optional(),
  payment_remark: z.string().nullable().optional(),
  special_remarks_company: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function CompanyUpsertForm({
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
      company_code: "",
      phone: "",
      fax: "",
      active: true,
      mou_date: "",
      email_statement_of_account: "",
      billing_street: "",
      reg_remark: "",
      dispensing_remark: "",
      payment_remark: "",
      special_remarks_company: "",
    },
  });

  useEffect(() => {
    if (mode !== "edit" || !id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await sbGetById<UnknownRecord>("accounts", id, "*");
      if (cancelled) return;
      if (res.error) {
        setServerError(String(res.error.message ?? res.error));
        setLoading(false);
        return;
      }
      form.reset({
        name: asString(res.data.name) ?? "",
        company_code: asString(res.data.company_code) ?? "",
        phone: asString(res.data.phone) ?? "",
        fax: asString(res.data.fax) ?? "",
        active: Boolean(res.data.active ?? false),
        mou_date: asString(res.data.mou_date) ?? "",
        email_statement_of_account: asString(res.data.email_statement_of_account) ?? "",
        billing_street: asString(res.data.billing_street) ?? "",
        reg_remark: asString(res.data.reg_remark) ?? "",
        dispensing_remark: asString(res.data.dispensing_remark) ?? "",
        payment_remark: asString(res.data.payment_remark) ?? "",
        special_remarks_company: asString(res.data.special_remarks_company) ?? "",
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
          <div className="text-xs font-medium text-muted-foreground">Company</div>
          <div className="mt-1 text-lg font-semibold">
            {mode === "edit" ? form.watch("name") || "Company" : "Create company"}
          </div>
        </div>
        {mode === "edit" && id ? (
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              setServerError(null);
              const res = await sbDelete("accounts", id);
              if (res.error) {
                setServerError(String(res.error.message ?? res.error));
                return;
              }
              router.replace("/crm/companies");
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
          if (!user) {
            setServerError("Not signed in.");
            return;
          }

          const payload: Record<string, unknown> = {
            user_id: user.id,
            ...values,
            company_code: values.company_code || null,
            phone: values.phone || null,
            fax: values.fax || null,
            mou_date: values.mou_date || null,
            email_statement_of_account: values.email_statement_of_account || null,
            billing_street: values.billing_street || null,
            reg_remark: values.reg_remark || null,
            dispensing_remark: values.dispensing_remark || null,
            payment_remark: values.payment_remark || null,
            special_remarks_company: values.special_remarks_company || null,
          };

          const res =
            mode === "edit" && id
              ? await sbUpdate<Account>("accounts", id, payload, "id")
              : await sbInsert<Account>("accounts", payload, "id");

          if (res.error) {
            setServerError(String(res.error.message ?? res.error));
            return;
          }

          router.replace(`/crm/companies/${res.data.id}`);
        })}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field className="md:col-span-2">
            <Label>Company Name</Label>
            <Input placeholder="Company name" {...form.register("name")} />
          </Field>
          <Field>
            <Label>Company Code</Label>
            <Input placeholder="e.g. SIMLIAN" {...form.register("company_code")} />
          </Field>

          <Field>
            <Label>Phone</Label>
            <Input placeholder="Phone" {...form.register("phone")} />
          </Field>
          <Field>
            <Label>Fax</Label>
            <Input placeholder="Fax" {...form.register("fax")} />
          </Field>
          <Field>
            <Label>Email (Statement of Account)</Label>
            <Input
              placeholder="soa@company.com"
              {...form.register("email_statement_of_account")}
            />
          </Field>

          <Field>
            <Label>MOU Date</Label>
            <Input type="date" {...form.register("mou_date")} />
          </Field>
          <Field className="md:col-span-2">
            <Label>Billing Address</Label>
            <Textarea placeholder="Billing address" {...form.register("billing_street")} />
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

        <Field>
          <Label>Special Remarks (Company)</Label>
          <Textarea {...form.register("special_remarks_company")} />
        </Field>

        <div className="rounded-2xl border border-border bg-muted/20 p-4 text-sm">
          <div className="font-medium">Statement of Account actions</div>
          <div className="mt-1 text-muted-foreground">
            Salesforce has <span className="font-medium">Email Statement of Account</span> and{" "}
            <span className="font-medium">Print Statement of Account</span> buttons. We’ll implement these as
            report exports once Receipts/Offsets are wired.
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


