export type UnknownRecord = Record<string, unknown>;

export function asString(v: unknown): string | null {
  return typeof v === "string" ? v : v == null ? null : String(v);
}

export function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function asBoolean(v: unknown): boolean {
  return Boolean(v);
}


