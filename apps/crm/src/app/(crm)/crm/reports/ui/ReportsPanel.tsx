"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Field, Label } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { LookupSelect } from "@/components/ui/LookupSelect";
import { sbGetById, sbList } from "@/lib/supabase/table";
import { downloadText, printHtml, toCsv } from "@/lib/reports/export";

type AccountRow = { id: string; name: string | null };
type CaseRow = { id: string; case_no: string | null; bill_to_company_id: string | null };
type VisitRow = {
  id: string;
  visit_record_no: string | null;
  case_id: string;
  visit_date: string | null;
  total_amount: number | null;
  amount_outstanding: number | null;
};
type ReceiptRow = {
  id: string;
  receipt_no: string | null;
  transaction_type: string | null;
  receipt_date: string | null;
  receipt_amount: number | null;
  amount_applied: number | null;
  balance: number | null;
};
type OffsetRow = { id: string; receipt_id: string; visit_id: string; amount_applied: number | null };
type TreatmentRow = { id: string; treatment_record_no: string | null; treatment_master_id: string | null; quantity: number | null; cost_per_unit: number | null; line_cost: number | null };

export default function ReportsPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [visitId, setVisitId] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [offsets, setOffsets] = useState<OffsetRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);

      const [a, c, v, r, o] = await Promise.all([
        sbList<AccountRow[]>("accounts", { select: "id,name,updated_at", order: { column: "updated_at", ascending: false }, limit: 500 }),
        sbList<CaseRow[]>("cases", { select: "id,case_no,bill_to_company_id,updated_at", order: { column: "updated_at", ascending: false }, limit: 2000 }),
        sbList<VisitRow[]>("visits", { select: "id,visit_record_no,case_id,visit_date,total_amount,amount_outstanding,updated_at", order: { column: "updated_at", ascending: false }, limit: 5000 }),
        sbList<ReceiptRow[]>("receipts", { select: "id,receipt_no,transaction_type,receipt_date,receipt_amount,amount_applied,balance,updated_at", order: { column: "updated_at", ascending: false }, limit: 2000 }),
        sbList<OffsetRow[]>("receipt_visit_offsets", { select: "id,receipt_id,visit_id,amount_applied,updated_at", order: { column: "updated_at", ascending: false }, limit: 10000 }),
      ]);

      if (cancelled) return;
      if (a.error) return setError(String(a.error.message ?? a.error));
      if (c.error) return setError(String(c.error.message ?? c.error));
      if (v.error) return setError(String(v.error.message ?? v.error));
      if (r.error) return setError(String(r.error.message ?? r.error));
      if (o.error) return setError(String(o.error.message ?? o.error));

      setAccounts(a.data ?? []);
      setCases(c.data ?? []);
      setVisits(v.data ?? []);
      setReceipts(r.data ?? []);
      setOffsets(o.data ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const caseIdsForCompany = useMemo(() => {
    if (!companyId) return new Set<string>();
    return new Set(cases.filter((k) => k.bill_to_company_id === companyId).map((k) => k.id));
  }, [cases, companyId]);

  const visitsForCompany = useMemo(() => {
    if (!companyId) return [];
    return visits.filter((v) => caseIdsForCompany.has(v.case_id));
  }, [caseIdsForCompany, companyId, visits]);

  const selectedReceipt = useMemo(() => receipts.find((r) => r.id === receiptId) ?? null, [receipts, receiptId]);
  const selectedVisit = useMemo(() => visits.find((v) => v.id === visitId) ?? null, [visits, visitId]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="p-6">
        <div className="text-xs font-medium text-muted-foreground">Company</div>
        <div className="mt-1 text-lg font-semibold">Statement of Account</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Placeholder export based on Visits under Cases billed to a company.
        </div>

        <div className="mt-5 space-y-4">
          <Field>
            <Label>Company</Label>
            <LookupSelect
              table="accounts"
              labelColumn="name"
              value={companyId}
              onChange={setCompanyId}
              placeholder="Select company…"
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!companyId}
              onClick={() => {
                const rows = visitsForCompany.map((v) => ({
                  visit_record_no: v.visit_record_no,
                  visit_date: v.visit_date,
                  total_amount: v.total_amount,
                  outstanding: v.amount_outstanding,
                }));
                downloadText(
                  `statement-of-account-${companyId}.csv`,
                  toCsv(rows),
                  "text/csv;charset=utf-8",
                );
              }}
            >
              Download CSV
            </Button>
            <Button
              type="button"
              disabled={!companyId}
              onClick={() => {
                const totalOutstanding = visitsForCompany.reduce(
                  (sum, v) => sum + (typeof v.amount_outstanding === "number" ? v.amount_outstanding : 0),
                  0,
                );
                const body = `
                  <h1>Statement of Account</h1>
                  <div class="meta">Company ID: ${companyId}</div>
                  <h2>Visits</h2>
                  <table>
                    <thead><tr><th>Visit No.</th><th>Date</th><th>Total</th><th>Outstanding</th></tr></thead>
                    <tbody>
                      ${visitsForCompany
                        .map(
                          (v) =>
                            `<tr><td>${v.visit_record_no ?? v.id}</td><td>${v.visit_date ?? ""}</td><td>${v.total_amount ?? ""}</td><td>${v.amount_outstanding ?? ""}</td></tr>`,
                        )
                        .join("")}
                    </tbody>
                  </table>
                  <div class="note">Total outstanding: ${totalOutstanding.toFixed(2)} (placeholder template)</div>
                `;
                printHtml("Statement of Account", body);
              }}
            >
              Print / Save as PDF
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="text-xs font-medium text-muted-foreground">Receipt</div>
        <div className="mt-1 text-lg font-semibold">Receipt / Credit Note</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Export receipt header + its Offsets.
        </div>

        <div className="mt-5 space-y-4">
          <Field>
            <Label>Receipt</Label>
            <LookupSelect
              table="receipts"
              labelColumn="receipt_no"
              value={receiptId}
              onChange={setReceiptId}
              placeholder="Select receipt…"
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!receiptId}
              onClick={() => {
                const rows = offsets
                  .filter((o) => o.receipt_id === receiptId)
                  .map((o) => ({
                    receipt_id: o.receipt_id,
                    visit_id: o.visit_id,
                    amount_applied: o.amount_applied,
                  }));
                downloadText(
                  `receipt-${receiptId}.csv`,
                  toCsv([
                    {
                      receipt_no: selectedReceipt?.receipt_no,
                      transaction_type: selectedReceipt?.transaction_type,
                      receipt_date: selectedReceipt?.receipt_date,
                      receipt_amount: selectedReceipt?.receipt_amount,
                      amount_applied: selectedReceipt?.amount_applied,
                      balance: selectedReceipt?.balance,
                    },
                    ...rows,
                  ]),
                  "text/csv;charset=utf-8",
                );
              }}
            >
              Download CSV
            </Button>
            <Button
              type="button"
              disabled={!receiptId}
              onClick={() => {
                const rows = offsets.filter((o) => o.receipt_id === receiptId);
                const body = `
                  <h1>${selectedReceipt?.transaction_type ?? "Receipt"}</h1>
                  <div class="meta">
                    Receipt No: ${selectedReceipt?.receipt_no ?? receiptId}<br/>
                    Date: ${selectedReceipt?.receipt_date ?? ""}<br/>
                    Amount: ${selectedReceipt?.receipt_amount ?? ""}<br/>
                    Applied: ${selectedReceipt?.amount_applied ?? ""}<br/>
                    Balance: ${selectedReceipt?.balance ?? ""}
                  </div>
                  <h2>Offsets</h2>
                  <table>
                    <thead><tr><th>Visit</th><th>Amount Applied</th></tr></thead>
                    <tbody>
                      ${rows
                        .map(
                          (o) => `<tr><td>${o.visit_id}</td><td>${o.amount_applied ?? ""}</td></tr>`,
                        )
                        .join("")}
                    </tbody>
                  </table>
                  <div class="note">Placeholder template. Use browser print dialog to save as PDF.</div>
                `;
                printHtml("Receipt", body);
              }}
            >
              Print / Save as PDF
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="text-xs font-medium text-muted-foreground">Visit</div>
        <div className="mt-1 text-lg font-semibold">Visit Invoice</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Export visit header + treatments + matched offsets.
        </div>

        <div className="mt-5 space-y-4">
          <Field>
            <Label>Visit</Label>
            <LookupSelect
              table="visits"
              labelColumn="visit_record_no"
              value={visitId}
              onChange={setVisitId}
              placeholder="Select visit…"
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!visitId}
              onClick={async () => {
                if (!visitId) return;
                const t = await sbList<TreatmentRow[]>("visit_treatments", {
                  select: "id,treatment_record_no,treatment_master_id,quantity,cost_per_unit,line_cost,visit_id,updated_at",
                  order: { column: "updated_at", ascending: false },
                  limit: 5000,
                });
                const treatments = t.error ? [] : (t.data ?? []).filter((x: any) => String(x.visit_id) === String(visitId));
                const matched = offsets.filter((o) => o.visit_id === visitId);
                downloadText(
                  `visit-${visitId}.csv`,
                  toCsv([
                    {
                      visit_record_no: selectedVisit?.visit_record_no,
                      visit_date: selectedVisit?.visit_date,
                      total_amount: selectedVisit?.total_amount,
                      amount_outstanding: selectedVisit?.amount_outstanding,
                    },
                    ...treatments.map((x: any) => ({
                      line_type: "treatment",
                      treatment_record_no: x.treatment_record_no,
                      treatment_master_id: x.treatment_master_id,
                      quantity: x.quantity,
                      cost_per_unit: x.cost_per_unit,
                      line_cost: x.line_cost,
                    })),
                    ...matched.map((o) => ({
                      line_type: "offset",
                      receipt_id: o.receipt_id,
                      amount_applied: o.amount_applied,
                    })),
                  ]),
                  "text/csv;charset=utf-8",
                );
              }}
            >
              Download CSV
            </Button>
            <Button
              type="button"
              disabled={!visitId}
              onClick={async () => {
                if (!visitId) return;
                const t = await sbList<TreatmentRow[]>("visit_treatments", {
                  select: "id,treatment_record_no,treatment_master_id,quantity,cost_per_unit,line_cost,visit_id,updated_at",
                  order: { column: "updated_at", ascending: false },
                  limit: 5000,
                });
                const treatments = t.error ? [] : (t.data ?? []).filter((x: any) => String(x.visit_id) === String(visitId));
                const matched = offsets.filter((o) => o.visit_id === visitId);
                const body = `
                  <h1>Visit Invoice</h1>
                  <div class="meta">
                    Visit No: ${selectedVisit?.visit_record_no ?? visitId}<br/>
                    Date: ${selectedVisit?.visit_date ?? ""}<br/>
                    Total: ${selectedVisit?.total_amount ?? ""}<br/>
                    Outstanding: ${selectedVisit?.amount_outstanding ?? ""}
                  </div>
                  <h2>Treatments</h2>
                  <table>
                    <thead><tr><th>Record No</th><th>Treatment</th><th>Qty</th><th>CPU</th><th>Line</th></tr></thead>
                    <tbody>
                      ${treatments
                        .map(
                          (x: any) =>
                            `<tr><td>${x.treatment_record_no ?? ""}</td><td>${x.treatment_master_id ?? ""}</td><td>${x.quantity ?? ""}</td><td>${x.cost_per_unit ?? ""}</td><td>${x.line_cost ?? ""}</td></tr>`,
                        )
                        .join("")}
                    </tbody>
                  </table>
                  <h2>Matched Payments</h2>
                  <table>
                    <thead><tr><th>Receipt</th><th>Amount</th></tr></thead>
                    <tbody>
                      ${matched.map((o) => `<tr><td>${o.receipt_id}</td><td>${o.amount_applied ?? ""}</td></tr>`).join("")}
                    </tbody>
                  </table>
                  <div class="note">Placeholder template. Replace IDs with human names later.</div>
                `;
                printHtml("Visit Invoice", body);
              }}
            >
              Print / Save as PDF
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}


