"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { useForm, type Resolver } from "react-hook-form";
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
import { asString, asNumber } from "@/lib/db/coerce";

const schema = z.object({
  transaction_type: z.string().nullable().optional(),
  payment_mode: z.string().nullable().optional(),
  receipt_from_account_id: z.string().nullable().optional(),
  receipt_date: z.string().min(1),
  receipt_amount: z.coerce.number().nullable().optional(),
  amount_applied: z.coerce.number().nullable().optional(),
  balance: z.coerce.number().nullable().optional(),
  remarks: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function ReceiptUpsertForm({
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
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues: {
      transaction_type: "Receipt",
      payment_mode: "",
      receipt_from_account_id: null,
      receipt_date: "",
      receipt_amount: null,
      amount_applied: null,
      balance: null,
      remarks: "",
    },
  });

  async function load() {
    if (mode !== "edit" || !id) return;
    setLoading(true);
    const res = await sbGetById<UnknownRecord>("receipts", id, "*");
    if (res.error) {
      setServerError(String(res.error.message ?? res.error));
      setLoading(false);
      return;
    }
    form.reset({
      transaction_type: asString(res.data.transaction_type) ?? "",
      payment_mode: asString(res.data.payment_mode) ?? "",
      receipt_from_account_id: asString(res.data.receipt_from_account_id),
      receipt_date: asString(res.data.receipt_date) ?? "",
      receipt_amount: asNumber(res.data.receipt_amount) ?? null,
      amount_applied: asNumber(res.data.amount_applied) ?? null,
      balance: asNumber(res.data.balance) ?? null,
      remarks: asString(res.data.remarks) ?? "",
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
      const detail = (e as CustomEvent).detail as { receiptId?: string } | undefined;
      if (detail?.receiptId && String(detail.receiptId) !== String(id)) return;
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
          <div className="text-xs font-medium text-muted-foreground">Receipt</div>
          <div className="mt-1 text-lg font-semibold">
            {mode === "edit" ? "Edit receipt" : "Create receipt"}
          </div>
        </div>
        {mode === "edit" && id ? (
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              setServerError(null);
              const res = await sbDelete("receipts", id);
              if (res.error) return setServerError(String(res.error.message ?? res.error));
              router.replace("/crm/receipts");
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
            // Note: amount_applied + balance are computed from Offsets.
            // We keep them in the form for display but do not write them.
            transaction_type: values.transaction_type || null,
            payment_mode: values.payment_mode || null,
            receipt_from_account_id: values.receipt_from_account_id || null,
            receipt_date: values.receipt_date,
            receipt_amount: values.receipt_amount ?? null,
            remarks: values.remarks || null,
          };

          const res =
            mode === "edit" && id
              ? await sbUpdate<Record<string, unknown>>(
                  "receipts",
                  id,
                  payload,
                  "id",
                )
              : await sbInsert<Record<string, unknown>>("receipts", payload, "id");
          if (res.error) return setServerError(String(res.error.message ?? res.error));
          router.replace(`/crm/receipts/${String(res.data.id)}`);
        })}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field>
            <Label>Transaction Type</Label>
            <select
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
              {...form.register("transaction_type")}
            >
              <option value="Receipt">Receipt</option>
              <option value="Credit Note">Credit Note</option>
            </select>
          </Field>
          <Field>
            <Label>Payment Mode</Label>
            <Input {...form.register("payment_mode")} />
          </Field>
          <Field>
            <Label>Receipt Date</Label>
            <Input type="date" {...form.register("receipt_date")} />
          </Field>

          <Field className="md:col-span-2">
            <Label>Receipt From (Company)</Label>
            <LookupSelect
              table="accounts"
              labelColumn="name"
              value={form.watch("receipt_from_account_id")}
              onChange={(v) => form.setValue("receipt_from_account_id", v)}
              placeholder="Select company…"
            />
          </Field>
          <Field>
            <Label>Receipt Amount</Label>
            <Input type="number" step="0.01" {...form.register("receipt_amount")} />
          </Field>

          <Field>
            <Label>Amount Applied</Label>
            <Input type="number" step="0.01" readOnly {...form.register("amount_applied")} />
          </Field>
          <Field>
            <Label>Balance</Label>
            <Input type="number" step="0.01" readOnly {...form.register("balance")} />
          </Field>
          <Field className="md:col-span-3">
            <Label>Remarks</Label>
            <Textarea {...form.register("remarks")} />
          </Field>
        </div>

        <div className="rounded-2xl border border-border bg-muted/20 p-4 text-sm">
          <div className="font-medium">Print actions</div>
          <div className="mt-1 text-muted-foreground">
            Salesforce has <span className="font-medium">Print Receipt</span> and{" "}
            <span className="font-medium">Print Credit Note</span>. We’ll implement PDF exports once
            templates are finalized.
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


