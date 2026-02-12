/**
 * Shared portal configuration for RPA Flow 3
 * This file is the source of truth for supported/unsupported portals.
 * It's used by both frontend (TypeScript) and backend (JavaScript via import).
 *
 * For backend usage, import from: '../../apps/crm/src/lib/rpa/portals.shared.js'
 * (TypeScript will compile this to JavaScript)
 */

export const ALLIANCE_MEDINET_TAGS = ['TOKIOM', 'ALLIANC', 'ALLSING', 'AXAMED', 'PRUDEN'] as const;
export const SUPPORTED_PORTALS = ['MHC', 'AIA', 'AIACLIENT', ...ALLIANCE_MEDINET_TAGS] as const;
export const UNSUPPORTED_PORTALS = ['IHP', 'GE', 'FULLERT', 'ALLIMED', 'ALL'] as const;
export const PORTAL_PAY_TYPES = [
  'MHC',
  'FULLERT',
  'IHP',
  'ALL',
  'ALLIANZ',
  'ALLIANCE',
  'AIA',
  'GE',
  'AIACLIENT',
  'AVIVA',
  'SINGLIFE',
] as const;

export type SupportedPortal = (typeof SUPPORTED_PORTALS)[number];
export type UnsupportedPortal = (typeof UNSUPPORTED_PORTALS)[number];
export type Portal = SupportedPortal | UnsupportedPortal;

/**
 * Check if a pay type is a supported portal
 */
export function isSupportedPortal(payType: string | null | undefined): boolean {
  if (!payType) return false;
  return SUPPORTED_PORTALS.includes(payType.toUpperCase() as SupportedPortal);
}

/**
 * Check if a pay type is an unsupported portal
 */
export function isUnsupportedPortal(payType: string | null | undefined): boolean {
  if (!payType) return false;
  return UNSUPPORTED_PORTALS.includes(payType.toUpperCase() as UnsupportedPortal);
}

/**
 * Get all supported portals as an array
 */
export function getSupportedPortals(): readonly string[] {
  return SUPPORTED_PORTALS;
}

/**
 * Get all unsupported portals as an array
 */
export function getUnsupportedPortals(): readonly string[] {
  return UNSUPPORTED_PORTALS;
}

export function getPortalPayTypes(): readonly string[] {
  return PORTAL_PAY_TYPES;
}

function normalizePortalTag(value: string | null | undefined): string {
  return String(value || '').toUpperCase();
}

export function isAllianceMedinetTagMatch(value: string | null | undefined): boolean {
  const raw = normalizePortalTag(value);
  if (!raw) return false;
  return ALLIANCE_MEDINET_TAGS.some(tag => raw.includes(tag));
}

export function extractAllianceMedinetTag(
  payType: string | null | undefined,
  patientName: string | null | undefined
): string | null {
  const sources = [normalizePortalTag(payType), normalizePortalTag(patientName)];
  for (const source of sources) {
    if (!source) continue;
    for (const tag of ALLIANCE_MEDINET_TAGS) {
      if (source.includes(tag)) return tag;
    }
  }
  return null;
}

export function isAllianceMedinetVisit(
  payType: string | null | undefined,
  patientName: string | null | undefined
): boolean {
  return !!extractAllianceMedinetTag(payType, patientName);
}

export function getPortalScopeOrFilter(): string {
  const clauses: string[] = [`pay_type.in.(${PORTAL_PAY_TYPES.join(',')})`];
  for (const tag of ALLIANCE_MEDINET_TAGS) {
    clauses.push(`pay_type.ilike.%${tag}%`);
    clauses.push(`patient_name.ilike.%${tag}%`);
  }
  return clauses.join(',');
}
