/**
 * Shared portal configuration for RPA Flow 3
 * This file is the source of truth for supported/unsupported portals.
 * It's used by both frontend (TypeScript) and backend (JavaScript via import).
 * 
 * For backend usage, import from: '../../apps/crm/src/lib/rpa/portals.shared.js'
 * (TypeScript will compile this to JavaScript)
 */

export const SUPPORTED_PORTALS = ['MHC', 'AIA', 'AIACLIENT'] as const;
export const UNSUPPORTED_PORTALS = ['IHP', 'GE', 'FULLERT', 'ALLIMED', 'ALL'] as const;

export type SupportedPortal = typeof SUPPORTED_PORTALS[number];
export type UnsupportedPortal = typeof UNSUPPORTED_PORTALS[number];
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
