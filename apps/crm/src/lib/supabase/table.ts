'use client';

import type { PostgrestError } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { isDemoMode } from '@/lib/env';
import { mockDelete, mockGetTable, mockUpsert } from '@/lib/mock/storage';

export type SbResult<T> = { data: T; error: null } | { data: null; error: PostgrestError | Error };

function isMissingTableError(err: unknown) {
  const msg =
    typeof (err as any)?.message === 'string'
      ? String((err as any).message)
      : typeof err === 'string'
        ? err
        : '';
  // PostgREST typically says: "Could not find the table 'public.tasks' in the schema cache"
  return msg.includes('Could not find the table') && msg.includes('schema cache');
}

const mockFallbackTables = new Set<string>(['tasks']);

async function reconcileReceiptAndVisitSupabase(input: {
  receiptId?: string | null;
  visitId?: string | null;
}) {
  const supabase = supabaseBrowser();
  if (!supabase) return;

  const receiptId = input.receiptId ?? null;
  const visitId = input.visitId ?? null;

  // Receipt: amount_applied = sum(offsets), balance = receipt_amount - amount_applied
  if (receiptId) {
    const offs = await supabase
      .from('receipt_visit_offsets')
      .select('amount_applied')
      .eq('receipt_id', receiptId);
    if (!offs.error) {
      const applied = (offs.data ?? []).reduce((sum, r) => {
        const v = (r as any)?.amount_applied;
        return sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
      }, 0);
      const rec = await supabase
        .from('receipts')
        .select('receipt_amount')
        .eq('id', receiptId)
        .maybeSingle();
      if (!rec.error) {
        const receiptAmount = (rec.data as any)?.receipt_amount;
        const balance =
          typeof receiptAmount === 'number' && Number.isFinite(receiptAmount)
            ? Number(receiptAmount) - applied
            : null;
        await supabase
          .from('receipts')
          .update({ amount_applied: applied, balance })
          .eq('id', receiptId);
      }
    }
  }

  // Visit: amount_outstanding = total_amount - sum(offsets across all receipts)
  if (visitId) {
    const offs = await supabase
      .from('receipt_visit_offsets')
      .select('amount_applied')
      .eq('visit_id', visitId);
    if (!offs.error) {
      const matched = (offs.data ?? []).reduce((sum, r) => {
        const v = (r as any)?.amount_applied;
        return sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
      }, 0);
      const visit = await supabase
        .from('visits')
        .select('total_amount')
        .eq('id', visitId)
        .maybeSingle();
      if (!visit.error) {
        const total = (visit.data as any)?.total_amount;
        const outstanding =
          typeof total === 'number' && Number.isFinite(total) ? Number(total) - matched : null;
        await supabase.from('visits').update({ amount_outstanding: outstanding }).eq('id', visitId);
      }
    }
  }
}

function reconcileReceiptAndVisitDemo(input: {
  receiptId?: string | null;
  visitId?: string | null;
}) {
  const receiptId = input.receiptId ?? null;
  const visitId = input.visitId ?? null;

  if (receiptId) {
    const offs = mockGetTable('receipt_visit_offsets').filter(
      r => String(r.receipt_id) === String(receiptId)
    );
    const applied = offs.reduce((sum, r) => {
      const v = r.amount_applied;
      return sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    }, 0);
    const receipts = mockGetTable('receipts');
    const rec = receipts.find(r => String(r.id) === String(receiptId));
    if (rec) {
      const amt = typeof rec.receipt_amount === 'number' ? rec.receipt_amount : null;
      const balance = amt != null ? amt - applied : null;
      mockUpsert('receipts', { ...rec, amount_applied: applied, balance });
    }
  }

  if (visitId) {
    const offs = mockGetTable('receipt_visit_offsets').filter(
      r => String(r.visit_id) === String(visitId)
    );
    const matched = offs.reduce((sum, r) => {
      const v = r.amount_applied;
      return sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    }, 0);
    const visits = mockGetTable('visits');
    const v = visits.find(r => String(r.id) === String(visitId));
    if (v) {
      const total = typeof v.total_amount === 'number' ? v.total_amount : null;
      const outstanding = total != null ? total - matched : null;
      mockUpsert('visits', { ...v, amount_outstanding: outstanding });
    }
  }
}

function nextAutoNo(table: string, field: string, prefix: string, width = 6) {
  const rows = mockGetTable(table);
  let max = 0;
  for (const r of rows) {
    const v = r?.[field];
    if (typeof v !== 'string') continue;
    if (!v.startsWith(prefix)) continue;
    const n = Number(v.slice(prefix.length));
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  const next = max + 1;
  return `${prefix}${String(next).padStart(width, '0')}`;
}

/** For Supabase: compute next running number for a table/field with prefix (e.g. case_no "C-", registration_no "REG-"). */
async function nextAutoNoSupabase(
  supabase: NonNullable<ReturnType<typeof supabaseBrowser>>,
  table: string,
  field: string,
  prefix: string,
  width = 6
): Promise<string> {
  const { data, error } = await supabase
    .from(table)
    .select(field)
    .like(field, `${prefix}%`)
    .limit(2000);
  if (error) return `${prefix}${String(1).padStart(width, '0')}`;
  let max = 0;
  for (const r of data ?? []) {
    const v = (r as unknown as Record<string, unknown>)?.[field];
    if (typeof v !== 'string') continue;
    if (!v.startsWith(prefix)) continue;
    const n = Number(v.slice(prefix.length));
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  const next = max + 1;
  return `${prefix}${String(next).padStart(width, '0')}`;
}

function contactNameById(contactId: string | null | undefined) {
  if (!contactId) return null;
  const rows = mockGetTable('contacts');
  const c = rows.find(r => String(r.id) === String(contactId));
  if (!c) return null;
  const first = typeof c.first_name === 'string' ? c.first_name : '';
  const last = typeof c.last_name === 'string' ? c.last_name : '';
  const full = [first, last].filter(Boolean).join(' ').trim();
  return full || null;
}

function casePatientNameByCaseId(caseId: string | null | undefined) {
  if (!caseId) return null;
  const rows = mockGetTable('cases');
  const k = rows.find(r => String(r.id) === String(caseId));
  if (!k) return null;
  if (typeof k.patient_name === 'string' && k.patient_name.trim()) return k.patient_name;
  return contactNameById(typeof k.contact_id === 'string' ? k.contact_id : null);
}

export async function sbList<T>(
  table: string,
  opts?: { select?: string; order?: { column: string; ascending?: boolean }; limit?: number }
) {
  const supabase = supabaseBrowser();
  if (isDemoMode() || !supabase) {
    const rows = mockGetTable(table);
    const order = opts?.order;
    let sorted = rows;
    if (order?.column) {
      const asc = order.ascending ?? false;
      sorted = [...rows].sort((a, b) => {
        const av = a[order.column];
        const bv = b[order.column];
        if (av == null && bv == null) return 0;
        if (av == null) return asc ? -1 : 1;
        if (bv == null) return asc ? 1 : -1;
        return String(av).localeCompare(String(bv)) * (asc ? 1 : -1);
      });
    }
    if (opts?.limit) sorted = sorted.slice(0, opts.limit);
    return { data: sorted as unknown as T, error: null };
  }
  const select = opts?.select ?? '*';
  let q = supabase.from(table).select(select);
  if (opts?.order) q = q.order(opts.order.column, { ascending: opts.order.ascending ?? false });
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) {
    if (mockFallbackTables.has(table) && isMissingTableError(error)) {
      const rows = mockGetTable(table);
      return { data: rows as unknown as T, error: null };
    }
    return { data: null, error };
  }
  return { data: data as unknown as T, error: null };
}

export async function sbGetById<T>(table: string, id: string, select = '*'): Promise<SbResult<T>> {
  const supabase = supabaseBrowser();
  if (isDemoMode() || !supabase) {
    const rows = mockGetTable(table);
    const found = rows.find(r => String(r.id) === id);
    if (!found) return { data: null, error: new Error(`Not found: ${table}.${id}`) };
    return { data: found as unknown as T, error: null };
  }
  const { data, error } = await supabase.from(table).select(select).eq('id', id).single();
  if (error) {
    if (mockFallbackTables.has(table) && isMissingTableError(error)) {
      const rows = mockGetTable(table);
      const found = rows.find(r => String(r.id) === id);
      if (!found) return { data: null, error: new Error(`Not found: ${table}.${id}`) };
      return { data: found as unknown as T, error: null };
    }
    return { data: null, error };
  }
  return { data: data as unknown as T, error: null };
}

export async function sbInsert<T>(
  table: string,
  values: Record<string, unknown>,
  select = '*'
): Promise<SbResult<T>> {
  const supabase = supabaseBrowser();
  if (isDemoMode() || !supabase) {
    const id = (values.id as string | undefined) ?? crypto.randomUUID();
    const base: Record<string, unknown> = { id, ...values };

    // Demo-only: auto-number + convenience denormalized display fields so the UI
    // behaves more like Salesforce (no "undefined" in lookups/tables).
    if (table === 'contacts') {
      const rn = base.registration_no;
      const emptyRegNo =
        !rn || (typeof rn === 'string' && (rn.trim() === '' || rn.toUpperCase() === 'XX'));
      if (emptyRegNo) base.registration_no = nextAutoNo('contacts', 'registration_no', 'REG-');
    }
    if (table === 'cases') {
      if (!base.case_no) base.case_no = nextAutoNo('cases', 'case_no', 'C-');
      if (!base.patient_name) {
        base.patient_name = contactNameById(
          typeof base.contact_id === 'string' ? base.contact_id : null
        );
      }
    }

    if (table === 'visits') {
      if (!base.visit_record_no)
        base.visit_record_no = nextAutoNo('visits', 'visit_record_no', 'V-');
      if (!base.patient_name) {
        base.patient_name = casePatientNameByCaseId(
          typeof base.case_id === 'string' ? base.case_id : null
        );
      }
      // If outstanding isn't set, default to total_amount.
      if (base.amount_outstanding == null && typeof base.total_amount === 'number') {
        base.amount_outstanding = base.total_amount;
      }
    }

    if (table === 'receipts') {
      if (!base.receipt_no) base.receipt_no = nextAutoNo('receipts', 'receipt_no', 'R-');
      if (base.balance == null && typeof base.receipt_amount === 'number') {
        const applied = typeof base.amount_applied === 'number' ? base.amount_applied : 0;
        base.balance = Number(base.receipt_amount) - applied;
      }
    }

    if (table === 'visit_treatments') {
      if (!base.treatment_record_no) {
        base.treatment_record_no = nextAutoNo('visit_treatments', 'treatment_record_no', 'VT-');
      }
      if (base.line_cost == null) {
        const q = typeof base.quantity === 'number' ? base.quantity : null;
        const c = typeof base.cost_per_unit === 'number' ? base.cost_per_unit : null;
        base.line_cost = q != null && c != null ? q * c : null;
      }
    }

    if (table === 'receipt_visit_offsets') {
      if (!base.rvo_record_no) {
        base.rvo_record_no = nextAutoNo('receipt_visit_offsets', 'rvo_record_no', 'RVO-');
      }
    }

    const next = mockUpsert(table, base);
    if (table === 'receipt_visit_offsets') {
      reconcileReceiptAndVisitDemo({
        receiptId: typeof base.receipt_id === 'string' ? base.receipt_id : null,
        visitId: typeof base.visit_id === 'string' ? base.visit_id : null,
      });
    }
    return { data: next as unknown as T, error: null };
  }

  // Supabase: auto-generate case_no and registration_no when missing to avoid unique constraint violations
  const needCaseNo =
    table === 'cases' &&
    (!values.case_no || (typeof values.case_no === 'string' && values.case_no.trim() === ''));
  const needRegNo =
    table === 'contacts' &&
    (!values.registration_no ||
      (typeof values.registration_no === 'string' &&
        (values.registration_no.trim() === '' || values.registration_no.toUpperCase() === 'XX')));
  if (needCaseNo) {
    values = { ...values, case_no: await nextAutoNoSupabase(supabase, 'cases', 'case_no', 'C-') };
  }
  if (needRegNo) {
    values = {
      ...values,
      registration_no: await nextAutoNoSupabase(supabase, 'contacts', 'registration_no', 'REG-'),
    };
  }

  const { data, error } = await supabase.from(table).insert(values).select(select).single();
  if (error) {
    if (mockFallbackTables.has(table) && isMissingTableError(error)) {
      const id = (values.id as string | undefined) ?? crypto.randomUUID();
      const next = mockUpsert(table, { id, ...values });
      return { data: next as unknown as T, error: null };
    }
    return { data: null, error };
  }
  if (table === 'receipt_visit_offsets') {
    await reconcileReceiptAndVisitSupabase({
      receiptId:
        typeof (values as any)?.receipt_id === 'string' ? String((values as any).receipt_id) : null,
      visitId:
        typeof (values as any)?.visit_id === 'string' ? String((values as any).visit_id) : null,
    });
  }
  return { data: data as unknown as T, error: null };
}

export async function sbUpdate<T>(
  table: string,
  id: string,
  values: Record<string, unknown>,
  select = '*'
): Promise<SbResult<T>> {
  const supabase = supabaseBrowser();
  if (isDemoMode() || !supabase) {
    const rows = mockGetTable(table);
    const existing = rows.find(r => String(r.id) === id);
    if (!existing) return { data: null, error: new Error(`Not found: ${table}.${id}`) };
    const next = mockUpsert(table, { ...existing, ...values, id });
    if (table === 'receipt_visit_offsets') {
      const receiptId =
        (typeof (values as any)?.receipt_id === 'string' && String((values as any).receipt_id)) ||
        (typeof (existing as any)?.receipt_id === 'string' &&
          String((existing as any).receipt_id)) ||
        null;
      const visitId =
        (typeof (values as any)?.visit_id === 'string' && String((values as any).visit_id)) ||
        (typeof (existing as any)?.visit_id === 'string' && String((existing as any).visit_id)) ||
        null;
      reconcileReceiptAndVisitDemo({ receiptId, visitId });
    }
    return { data: next as unknown as T, error: null };
  }
  const { data, error } = await supabase
    .from(table)
    .update(values)
    .eq('id', id)
    .select(select)
    .single();
  if (error) {
    if (mockFallbackTables.has(table) && isMissingTableError(error)) {
      const rows = mockGetTable(table);
      const existing = rows.find(r => String(r.id) === id);
      if (!existing) return { data: null, error: new Error(`Not found: ${table}.${id}`) };
      const next = mockUpsert(table, { ...existing, ...values, id });
      return { data: next as unknown as T, error: null };
    }
    return { data: null, error };
  }
  if (table === 'receipt_visit_offsets') {
    const row: any = data;
    await reconcileReceiptAndVisitSupabase({
      receiptId:
        (typeof row?.receipt_id === 'string' && row.receipt_id) ||
        (typeof (values as any)?.receipt_id === 'string' && String((values as any).receipt_id)) ||
        null,
      visitId:
        (typeof row?.visit_id === 'string' && row.visit_id) ||
        (typeof (values as any)?.visit_id === 'string' && String((values as any).visit_id)) ||
        null,
    });
  }
  return { data: data as unknown as T, error: null };
}

export async function sbDelete(table: string, id: string): Promise<SbResult<true>> {
  const supabase = supabaseBrowser();
  if (isDemoMode() || !supabase) {
    const existing =
      table === 'receipt_visit_offsets'
        ? mockGetTable(table).find(r => String(r.id) === String(id))
        : null;
    mockDelete(table, id);
    if (table === 'receipt_visit_offsets' && existing) {
      reconcileReceiptAndVisitDemo({
        receiptId:
          typeof (existing as any)?.receipt_id === 'string'
            ? String((existing as any).receipt_id)
            : null,
        visitId:
          typeof (existing as any)?.visit_id === 'string'
            ? String((existing as any).visit_id)
            : null,
      });
    }
    return { data: true, error: null };
  }
  let existing: { receipt_id?: string | null; visit_id?: string | null } | null = null;
  if (table === 'receipt_visit_offsets') {
    const pre = await supabase
      .from('receipt_visit_offsets')
      .select('receipt_id,visit_id')
      .eq('id', id)
      .maybeSingle();
    if (!pre.error) existing = (pre.data as any) ?? null;
  }
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) {
    if (mockFallbackTables.has(table) && isMissingTableError(error)) {
      mockDelete(table, id);
      return { data: true, error: null };
    }
    return { data: null, error };
  }
  if (table === 'receipt_visit_offsets') {
    await reconcileReceiptAndVisitSupabase({
      receiptId:
        typeof (existing as any)?.receipt_id === 'string'
          ? String((existing as any).receipt_id)
          : null,
      visitId:
        typeof (existing as any)?.visit_id === 'string' ? String((existing as any).visit_id) : null,
    });
  }
  return { data: true, error: null };
}
