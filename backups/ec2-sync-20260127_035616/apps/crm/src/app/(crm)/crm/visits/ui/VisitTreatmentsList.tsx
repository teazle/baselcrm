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

type TreatmentRow = {
  id: string;
  treatment_record_no: string | null;
  treatment_master_id: string | null;
  quantity: number | null;
  cost_per_unit: number | null;
  line_cost: number | null;
  visit_id: string;
  updated_at?: string;
};

export default function VisitTreatmentsList({ visitId }: { visitId: string }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<TreatmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tmNameById, setTmNameById] = useState<Record<string, string>>({});

  const [treatmentMasterId, setTreatmentMasterId] = useState<string | null>(null);
  const [qty, setQty] = useState<string>("1");
  const [cpu, setCpu] = useState<string>("");

  async function refresh() {
    setLoading(true);
    setError(null);
    const res = await sbList<TreatmentRow[]>("visit_treatments", {
      select:
        "id,treatment_record_no,treatment_master_id,quantity,cost_per_unit,line_cost,visit_id,updated_at",
      order: { column: "updated_at", ascending: false },
      limit: 200,
    });
    if (res.error) {
      setError(String(res.error.message ?? res.error));
      setRows([]);
      setLoading(false);
      return;
    }
    setRows((res.data ?? []).filter((r) => r.visit_id === visitId));
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await sbList<Array<{ id: string; name: string | null }>>("treatment_master", {
        select: "id,name,updated_at",
        order: { column: "updated_at", ascending: false },
        limit: 500,
      });
      if (cancelled) return;
      if (res.error) return;
      const map: Record<string, string> = {};
      for (const r of res.data ?? []) {
        if (r?.id) map[String(r.id)] = String(r.name ?? r.id);
      }
      setTmNameById(map);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className="p-0">
      <div className="px-6 py-5">
        <div className="text-xs font-medium text-muted-foreground">Related</div>
        <div className="mt-1 text-lg font-semibold">Treatments</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Visit line items (links to Treatment Master).
        </div>
      </div>

      <div className="px-6 pb-6">
        <div className="mb-5 grid gap-3 rounded-2xl border border-border bg-muted/20 p-4 md:grid-cols-4">
          <Field className="md:col-span-2">
            <Label>Treatment Master</Label>
            <LookupSelect
              table="treatment_master"
              labelColumn="name"
              value={treatmentMasterId}
              onChange={setTreatmentMasterId}
              placeholder="Select treatment…"
            />
          </Field>
          <Field>
            <Label>Qty</Label>
            <Input value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field>
            <Label>Cost / Unit</Label>
            <Input value={cpu} onChange={(e) => setCpu(e.target.value)} />
          </Field>
          <div className="md:col-span-4 flex justify-end">
            <Button
              type="button"
              onClick={async () => {
                if (!user) return;
                if (!treatmentMasterId) {
                  setError("Select a Treatment Master item.");
                  return;
                }
                const q = Number(qty || 0);
                const c = Number(cpu || 0);
                const payload: Record<string, unknown> = {
                  user_id: user.id,
                  visit_id: visitId,
                  treatment_master_id: treatmentMasterId,
                  quantity: Number.isFinite(q) ? q : null,
                  cost_per_unit: Number.isFinite(c) ? c : null,
                  line_cost: Number.isFinite(q) && Number.isFinite(c) ? q * c : null,
                };
                const res = await sbInsert<Record<string, unknown>>(
                  "visit_treatments",
                  payload,
                  "id",
                );
                if (res.error) {
                  setError(String(res.error.message ?? res.error));
                  return;
                }
                setTreatmentMasterId(null);
                setQty("1");
                setCpu("");
                await refresh();
              }}
            >
              Add line item
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
              {
                header: "Treatment Record No.",
                cell: (r) => r.treatment_record_no ?? "—",
              },
              {
                header: "Treatment Master",
                cell: (r) =>
                  r.treatment_master_id
                    ? tmNameById[String(r.treatment_master_id)] ?? String(r.treatment_master_id)
                    : "—",
              },
              { header: "Qty", cell: (r) => String(r.quantity ?? "—") },
              {
                header: "Line Cost",
                cell: (r) =>
                  r.line_cost != null ? `$${Number(r.line_cost).toFixed(2)}` : "—",
              },
              {
                header: "",
                cell: (r) => (
                  <button
                    type="button"
                    className="text-xs font-medium text-red-700 hover:underline"
                    onClick={async () => {
                      const del = await sbDelete("visit_treatments", r.id);
                      if (del.error) {
                        setError(String(del.error.message ?? del.error));
                        return;
                      }
                      await refresh();
                    }}
                  >
                    Delete
                  </button>
                ),
              },
            ]}
            empty="No treatments yet."
          />
        )}
      </div>
    </Card>
  );
}


