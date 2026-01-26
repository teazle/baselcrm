"use client";

import type { UnknownRecord } from "@/lib/db/coerce";

function keyFor(table: string) {
  return `demo:table:${table}`;
}

export function mockGetTable(table: string): UnknownRecord[] {
  const raw = localStorage.getItem(keyFor(table));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as UnknownRecord[];
    return [];
  } catch {
    return [];
  }
}

export function mockSetTable(table: string, rows: UnknownRecord[]) {
  localStorage.setItem(keyFor(table), JSON.stringify(rows));
}

export function mockUpsert(table: string, row: UnknownRecord): UnknownRecord {
  const rows = mockGetTable(table);
  const id = String(row.id);
  const idx = rows.findIndex((r) => String(r.id) === id);
  const now = new Date().toISOString();
  const next = { ...row, updated_at: now, created_at: row.created_at ?? now };
  if (idx >= 0) rows[idx] = next;
  else rows.unshift(next);
  mockSetTable(table, rows);
  return next;
}

export function mockDelete(table: string, id: string): boolean {
  const rows = mockGetTable(table);
  const next = rows.filter((r) => String(r.id) !== id);
  mockSetTable(table, next);
  return true;
}


