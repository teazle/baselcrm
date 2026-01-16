"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Field, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth/AuthProvider";
import { sbDelete, sbGetById, sbInsert, sbUpdate } from "@/lib/supabase/table";
import type { UnknownRecord } from "@/lib/db/coerce";
import { asBoolean, asNumber, asString } from "@/lib/db/coerce";

const schema = z.object({
  name: z.string().min(1, "Name is required."),
  code: z.string().optional(),
  unit_price: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function TreatmentMasterUpsertForm({
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
      code: "",
      unit_price: "",
    },
  });

  useEffect(() => {
    if (mode !== "edit" || !id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setServerError(null);
      const res = await sbGetById<UnknownRecord>("treatment_master", id, "*");
      if (cancelled) return;
      if (res.error) {
        setServerError(String(res.error.message ?? res.error));
        setLoading(false);
        return;
      }
      form.reset({
        name: asString(res.data.name) ?? "",
        code: asString(res.data.code) ?? "",
        unit_price:
          asNumber(res.data.unit_price) != null ? String(asNumber(res.data.unit_price)) : "",
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [form, id, mode]);

  const title = useMemo(() => {
    const name = form.watch("name") || "Unnamed";
    return mode === "edit" ? name : "Create treatment";
  }, [form, mode]);

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-muted-foreground">
            Treatment Master
          </div>
          <div className="mt-1 text-lg font-semibold">{title}</div>
        </div>
        {mode === "edit" && id ? (
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              setServerError(null);
              const res = await sbDelete("treatment_master", id);
              if (res.error) {
                setServerError(String(res.error.message ?? res.error));
                return;
              }
              router.replace("/crm/treatment-master");
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
            name: values.name.trim(),
          };

          const code = values.code?.trim();
          if (code) payload.code = code;

          const price = asNumber(values.unit_price);
          if (price != null) payload.unit_price = price;

          const res =
            mode === "edit" && id
              ? await sbUpdate("treatment_master", id, payload, "id")
              : await sbInsert("treatment_master", payload, "id");

          if (res.error) {
            setServerError(String(res.error.message ?? res.error));
            return;
          }
          // @ts-expect-error sbInsert/sbUpdate returns at least {id}
          router.replace(`/crm/treatment-master/${res.data.id}`);
        })}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field className="md:col-span-2">
            <Label>Name</Label>
            <Input placeholder="e.g. Physiotherapy Session" {...form.register("name")} />
          </Field>
          <Field>
            <Label>Code</Label>
            <Input placeholder="e.g. PT-THER" {...form.register("code")} />
          </Field>
          <Field>
            <Label>Unit Price</Label>
            <Input placeholder="e.g. 180" inputMode="decimal" {...form.register("unit_price")} />
          </Field>
          <Field>
            <Label> </Label>
            <div className="flex h-11 items-center rounded-xl border border-border bg-muted/20 px-3 text-sm text-muted-foreground">
              Tip: keep names consistent — Visit line items look up by Treatment Master name.
            </div>
          </Field>
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


