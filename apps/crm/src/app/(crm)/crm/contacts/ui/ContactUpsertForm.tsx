"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card } from "@/components/ui/Card";
import { Field, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import type { Contact } from "@/lib/db/models";
import { useAuth } from "@/lib/auth/AuthProvider";
import { sbDelete, sbGetById, sbInsert, sbUpdate } from "@/lib/supabase/table";
import { useRouter } from "next/navigation";
import type { UnknownRecord } from "@/lib/db/coerce";
import { asString } from "@/lib/db/coerce";

const optionalEmail = z.union([z.string().email(), z.literal(""), z.null()]).optional();

const schema = z.object({
  record_type: z
    .enum(["Patient", "SSOC Staff", "Referral Source"])
    .nullable()
    .optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  email: optionalEmail,
  mobile: z.string().nullable().optional(),
  registration_no: z.string().nullable().optional(),
  ic_passport_no: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  sex: z.enum(["Male", "Female"]).nullable().optional(),
  date_of_birth: z.string().nullable().optional(),
  mailing_address: z.string().nullable().optional(),
  allergy: z.string().nullable().optional(),
  previous_medical_problem: z.string().nullable().optional(),
  present_medication: z.string().nullable().optional(),
  special_remarks_contact: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function ContactUpsertForm({
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
      record_type: "Patient",
      first_name: "",
      last_name: "",
      email: "",
      mobile: "",
      registration_no: "",
      ic_passport_no: "",
      nationality: "",
      sex: null,
      date_of_birth: "",
      mailing_address: "",
      allergy: "",
      previous_medical_problem: "",
      present_medication: "",
      special_remarks_contact: "",
    },
  });

  useEffect(() => {
    if (mode !== "edit" || !id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await sbGetById<UnknownRecord>("contacts", id, "*");
      if (cancelled) return;
      if (res.error) {
        setServerError(String(res.error.message ?? res.error));
        setLoading(false);
        return;
      }
      form.reset({
        record_type:
          (asString(res.data.record_type) as FormValues["record_type"]) ?? null,
        first_name: asString(res.data.first_name) ?? "",
        last_name: asString(res.data.last_name) ?? "",
        email: asString(res.data.email) ?? "",
        mobile: asString(res.data.mobile) ?? "",
        registration_no: asString(res.data.registration_no) ?? "",
        ic_passport_no: asString(res.data.ic_passport_no) ?? "",
        nationality: asString(res.data.nationality) ?? "",
        sex: (asString(res.data.sex) as FormValues["sex"]) ?? null,
        date_of_birth: asString(res.data.date_of_birth) ?? "",
        mailing_address: asString(res.data.mailing_address) ?? "",
        allergy: asString(res.data.allergy) ?? "",
        previous_medical_problem: asString(res.data.previous_medical_problem) ?? "",
        present_medication: asString(res.data.present_medication) ?? "",
        special_remarks_contact: asString(res.data.special_remarks_contact) ?? "",
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [form, id, mode]);

  const firstName = form.watch("first_name");
  const lastName = form.watch("last_name");
  const title = useMemo(() => {
    const name = [firstName, lastName].filter(Boolean).join(" ") || "Unnamed";
    return mode === "edit" ? name : "Create contact";
  }, [firstName, lastName, mode]);

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-muted-foreground">
            Contact
          </div>
          <div className="mt-1 text-lg font-semibold">{title}</div>
        </div>
        {mode === "edit" && id ? (
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              setServerError(null);
              const res = await sbDelete("contacts", id);
              if (res.error) {
                setServerError(String(res.error.message ?? res.error));
                return;
              }
              router.replace("/crm/contacts");
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
            // Clean empty strings into nulls for optional fields
            first_name: values.first_name || null,
            last_name: values.last_name || null,
            email: values.email || null,
            mobile: values.mobile || null,
            registration_no: values.registration_no || null,
            ic_passport_no: values.ic_passport_no || null,
            nationality: values.nationality || null,
            date_of_birth: values.date_of_birth || null,
            mailing_address: values.mailing_address || null,
            allergy: values.allergy || null,
            previous_medical_problem: values.previous_medical_problem || null,
            present_medication: values.present_medication || null,
            special_remarks_contact: values.special_remarks_contact || null,
          };

          const res =
            mode === "edit" && id
              ? await sbUpdate<Contact>("contacts", id, payload, "id")
              : await sbInsert<Contact>("contacts", payload, "id");

          if (res.error) {
            setServerError(String(res.error.message ?? res.error));
            return;
          }

          router.replace(`/crm/contacts/${res.data.id}`);
        })}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field>
            <Label>Record Type</Label>
            <select
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
              {...form.register("record_type")}
            >
              <option value="Patient">Patient</option>
              <option value="SSOC Staff">SSOC Staff</option>
              <option value="Referral Source">Referral Source</option>
            </select>
          </Field>

          <Field>
            <Label>First Name</Label>
            <Input placeholder="First name" {...form.register("first_name")} />
          </Field>

          <Field>
            <Label>Last Name</Label>
            <Input placeholder="Last name" {...form.register("last_name")} />
          </Field>

          <Field>
            <Label>Mobile</Label>
            <Input placeholder="Mobile" {...form.register("mobile")} />
          </Field>

          <Field>
            <Label>Email</Label>
            <Input placeholder="Email" {...form.register("email")} />
          </Field>

          <Field>
            <Label>Registration No.</Label>
            <Input
              placeholder="e.g. A31123"
              {...form.register("registration_no")}
            />
          </Field>

          <Field>
            <Label>IC/Passport No.</Label>
            <Input
              placeholder="e.g. G8267404M"
              {...form.register("ic_passport_no")}
            />
          </Field>

          <Field>
            <Label>Nationality</Label>
            <Input placeholder="Nationality" {...form.register("nationality")} />
          </Field>

          <Field>
            <Label>Sex</Label>
            <select
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
              {...form.register("sex")}
            >
              <option value="">—</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </Field>

          <Field>
            <Label>Date of Birth</Label>
            <Input type="date" {...form.register("date_of_birth")} />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <Label>Mailing Address</Label>
            <Textarea
              placeholder="Mailing address"
              {...form.register("mailing_address")}
            />
          </Field>
          <Field>
            <Label>Special Remarks (Contact)</Label>
            <Textarea
              placeholder="Special remarks"
              {...form.register("special_remarks_contact")}
            />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Field>
            <Label>Allergy</Label>
            <Textarea placeholder="Allergy" {...form.register("allergy")} />
          </Field>
          <Field>
            <Label>Previous Medical Problem</Label>
            <Textarea
              placeholder="Previous medical problem"
              {...form.register("previous_medical_problem")}
            />
          </Field>
          <Field>
            <Label>Present Medication</Label>
            <Textarea
              placeholder="Present medication"
              {...form.register("present_medication")}
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            Cancel
          </Button>
          <Button type="submit">
            {mode === "edit" ? "Save" : "Create"}
          </Button>
        </div>
      </form>
    </Card>
  );
}


