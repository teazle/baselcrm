"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { DataTable, RowLink } from "@/components/ui/DataTable";
import { Field, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { LookupSelect } from "@/components/ui/LookupSelect";
import { useAuth } from "@/lib/auth/AuthProvider";
import { sbDelete, sbInsert, sbList } from "@/lib/supabase/table";

type OffsetRow = {
  id: string;
  rvo_record_no: string | null;
  receipt_id: string;
  visit_id: string;
  amount_applied: number | null;
  updated_at?: string;
};

export default function ReceiptOffsetsList({ receiptId }: { receiptId: string }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<OffsetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visitNoById, setVisitNoById] = useState<Record<string, string>>({});

  const [visitId, setVisitId] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>("");

  function notifyChanged(visitId: string | null) {
    // Lets sibling forms (Receipt / Visit) re-fetch after reconciliation updates.
    window.dispatchEvent(
      new CustomEvent("crm:data-changed", {
        detail: { receiptId, visitId },
      }),
    );
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    const res = await sbList<OffsetRow[]>("receipt_visit_offsets", {
      select: "id,rvo_record_no,receipt_id,visit_id,amount_applied,updated_at",
      order: { column: "updated_at", ascending: false },
      limit: 200,
    });
    if (res.error) {
      setError(String(res.error.message ?? res.error));
      setRows([]);
      setLoading(false);
      return;
    }
    setRows((res.data ?? []).filter((r) => r.receipt_id === receiptId));
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await sbList<Array<{ id: string; visit_record_no: string | null }>>("visits", {
        select: "id,visit_record_no,updated_at",
        order: { column: "updated_at", ascending: false },
        limit: 500,
      });
      if (cancelled) return;
      if (res.error) return;
      const map: Record<string, string> = {};
      for (const r of res.data ?? []) {
        if (r?.id) map[String(r.id)] = String(r.visit_record_no ?? r.id);
      }
      setVisitNoById(map);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className="p-0">
      <div className="px-6 py-5">
        <div className="text-xs font-medium text-muted-foreground">Related</div>
        <div className="mt-1 text-lg font-semibold">Receipt/Visit Offsets</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Applies receipt amount to specific visit invoices (Salesforce “Match Receipt/Visit”).
        </div>
      </div>

      <div className="px-6 pb-6">
        <div className="mb-5 grid gap-3 rounded-2xl border border-border bg-muted/20 p-4 md:grid-cols-4">
          <Field className="md:col-span-2">
            <Label>Visit</Label>
            <LookupSelect
              table="visits"
              labelColumn="visit_record_no"
              value={visitId}
              onChange={setVisitId}
              placeholder="Select visit…"
            />
          </Field>
          <Field>
            <Label>Amount Applied</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button
              type="button"
              className="w-full"
              onClick={async () => {
                if (!user) return;
                if (!visitId) {
                  setError("Select a visit to apply this receipt to.");
                  return;
                }
                const amt = Number(amount || 0);
                const payload: Record<string, unknown> = {
                  user_id: user.id,
                  receipt_id: receiptId,
                  visit_id: visitId,
                  amount_applied: Number.isFinite(amt) ? amt : null,
                };
                const res = await sbInsert<Record<string, unknown>>(
                  "receipt_visit_offsets",
                  payload,
                  "id",
                );
                if (res.error) {
                  setError(String(res.error.message ?? res.error));
                  return;
                }
                setVisitId(null);
                setAmount("");
                notifyChanged(visitId);
                await refresh();
              }}
            >
              Add Offset
            </Button>
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              { header: "RVO No.", cell: (r) => r.rvo_record_no ?? "—" },
              {
                header: "Visit",
                cell: (r) => (
                  <RowLink href={`/crm/visits/${r.visit_id}`}>
                    {visitNoById[String(r.visit_id)] ?? r.visit_id}
                  </RowLink>
                ),
              },
              {
                header: "Amount Applied",
                cell: (r) =>
                  r.amount_applied != null
                    ? `$${Number(r.amount_applied).toFixed(2)}`
                    : "—",
              },
              {
                header: "",
                cell: (r) => (
                  <button
                    type="button"
                    className="text-xs font-medium text-red-700 hover:underline"
                    onClick={async () => {
                      const del = await sbDelete("receipt_visit_offsets", r.id);
                      if (del.error) {
                        setError(String(del.error.message ?? del.error));
                        return;
                      }
                      notifyChanged(r.visit_id);
                      await refresh();
                    }}
                  >
                    Delete
                  </button>
                ),
              },
            ]}
            empty="No offsets yet."
          />
        )}
      </div>
    </Card>
  );
}


