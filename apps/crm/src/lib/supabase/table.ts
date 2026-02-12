'use client';

import type { PostgrestError } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase/browser';

export type SbResult<T> = { data: T; error: null } | { data: null; error: PostgrestError | Error };

const NOT_CONFIGURED = new Error('Supabase is not configured');

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

export async function sbList<T>(
  table: string,
  opts?: { select?: string; order?: { column: string; ascending?: boolean }; limit?: number }
) {
  const supabase = supabaseBrowser();
  if (!supabase) return { data: null, error: NOT_CONFIGURED };
  const select = opts?.select ?? '*';
  let q = supabase.from(table).select(select);
  if (opts?.order) q = q.order(opts.order.column, { ascending: opts.order.ascending ?? false });
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) return { data: null, error };
  return { data: data as unknown as T, error: null };
}

export async function sbGetById<T>(table: string, id: string, select = '*'): Promise<SbResult<T>> {
  const supabase = supabaseBrowser();
  if (!supabase) return { data: null, error: NOT_CONFIGURED };
  const { data, error } = await supabase.from(table).select(select).eq('id', id).single();
  if (error) return { data: null, error };
  return { data: data as unknown as T, error: null };
}

export async function sbInsert<T>(
  table: string,
  values: Record<string, unknown>,
  select = '*'
): Promise<SbResult<T>> {
  const supabase = supabaseBrowser();
  if (!supabase) return { data: null, error: NOT_CONFIGURED };

  // Auto-generate case_no and registration_no when missing to avoid unique constraint violations
  const needCaseNo =
    table === 'cases' &&
    (!values.case_no || (typeof values.case_no === 'string' && values.case_no.trim() === ''));
  const needRegNo =
    table === 'contacts' &&
    (!values.registration_no ||
      (typeof values.registration_no === 'string' &&
        (values.registration_no.trim() === '' || values.registration_no.toUpperCase() === 'XX')));
  let payload = { ...values };
  if (needCaseNo) {
    payload = {
      ...payload,
      case_no: await nextAutoNoSupabase(supabase, 'cases', 'case_no', 'C-'),
    };
  }
  if (needRegNo) {
    payload = {
      ...payload,
      registration_no: await nextAutoNoSupabase(
        supabase,
        'contacts',
        'registration_no',
        'REG-'
      ),
    };
  }

  const { data, error } = await supabase.from(table).insert(payload).select(select).single();
  if (error) return { data: null, error };
  if (table === 'receipt_visit_offsets') {
    await reconcileReceiptAndVisitSupabase({
      receiptId:
        typeof (payload as any)?.receipt_id === 'string'
          ? String((payload as any).receipt_id)
          : null,
      visitId:
        typeof (payload as any)?.visit_id === 'string'
          ? String((payload as any).visit_id)
          : null,
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
  if (!supabase) return { data: null, error: NOT_CONFIGURED };
  const { data, error } = await supabase
    .from(table)
    .update(values)
    .eq('id', id)
    .select(select)
    .single();
  if (error) return { data: null, error };
  if (table === 'receipt_visit_offsets') {
    const row: any = data;
    await reconcileReceiptAndVisitSupabase({
      receiptId:
        (typeof row?.receipt_id === 'string' && row.receipt_id) ||
        (typeof (values as any)?.receipt_id === 'string' &&
          String((values as any).receipt_id)) ||
        null,
      visitId:
        (typeof row?.visit_id === 'string' && row.visit_id) ||
        (typeof (values as any)?.visit_id === 'string' &&
          String((values as any).visit_id)) ||
        null,
    });
  }
  return { data: data as unknown as T, error: null };
}

export async function sbDelete(table: string, id: string): Promise<SbResult<true>> {
  const supabase = supabaseBrowser();
  if (!supabase) return { data: null, error: NOT_CONFIGURED };
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
  if (error) return { data: null, error };
  if (table === 'receipt_visit_offsets') {
    await reconcileReceiptAndVisitSupabase({
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
