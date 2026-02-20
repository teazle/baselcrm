/**
 * Shared portal configuration for RPA Flow 3
 * This file is the source of truth for supported/unsupported portals.
 * It's used by both frontend (TypeScript) and backend (JavaScript via import).
 *
 * For backend usage, import from: '../../apps/crm/src/lib/rpa/portals.shared.js'
 * (TypeScript will compile this to JavaScript)
 */

export const ALLIANCE_MEDINET_TAGS = ['TOKIOM', 'ALLIANC', 'ALLSING', 'AXAMED', 'PRUDEN'] as const;
export const ALLIANZ_TAGS = ['ALLIANZ', 'ALLIANCE'] as const;
export const FULLERTON_TAGS = ['FULLERT'] as const;
export const IHP_TAGS = ['IHP'] as const;
export const IXCHANGE_TAGS = ['PARKWAY', 'ALL'] as const;
export const GE_NTUC_TAGS = ['GE', 'NTUC_IM'] as const;
export const MHC_TAGS = ['MHC', 'AIA', 'AIACLIENT', 'AVIVA', 'SINGLIFE', 'MHCAXA'] as const;
export const SUPPORTED_PORTALS = [...MHC_TAGS, ...ALLIANCE_MEDINET_TAGS] as const;
export const UNSUPPORTED_PORTALS = [
  ...ALLIANZ_TAGS,
  ...FULLERTON_TAGS,
  ...IHP_TAGS,
  ...IXCHANGE_TAGS,
  ...GE_NTUC_TAGS,
  'ALLIMED',
] as const;
export const FLOW3_PORTAL_TARGETS = [
  'MHC',
  'ALLIANCE_MEDINET',
  'ALLIANZ',
  'FULLERTON',
  'IHP',
  'IXCHANGE',
  'GE_NTUC',
] as const;
export const PORTAL_PAY_TYPES = [
  'MHC',
  'MHCAXA',
  'AIA',
  'AIACLIENT',
  'AVIVA',
  'SINGLIFE',
  'FULLERT',
  'IHP',
  'PARKWAY',
  'ALL',
  'ALLIMED',
  'ALLIANZ',
  'ALLIANCE',
  'GE',
  'NTUC_IM',
  ...ALLIANCE_MEDINET_TAGS,
] as const;

export const PATIENT_NAME_PORTAL_TAGS = [
  'TOKIOM',
  'ALLIANC',
  'ALLSING',
  'AXAMED',
  'PRUDEN',
  'ALLIANZ',
  'ALLIANCE',
  'FULLERT',
  'PARKWAY',
  'NTUC_IM',
  'MHCAXA',
] as const;

export type SupportedPortal = (typeof SUPPORTED_PORTALS)[number];
export type UnsupportedPortal = (typeof UNSUPPORTED_PORTALS)[number];
export type Portal = SupportedPortal | UnsupportedPortal;
export type Flow3PortalTarget = (typeof FLOW3_PORTAL_TARGETS)[number];

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

function hasPortalTagToken(source: string, tag: string): boolean {
  return new RegExp(`(^|[^A-Z0-9])${tag}([^A-Z0-9]|$)`).test(source);
}

function normalizeMetadataPortalHint(value: unknown): string {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .trim();
}

function containsAnyTag(
  payType: string | null | undefined,
  patientName: string | null | undefined,
  tags: readonly string[]
): boolean {
  const sources = [normalizePortalTag(payType), normalizePortalTag(patientName)];
  for (const source of sources) {
    if (!source) continue;
    for (const tag of tags) {
      if (hasPortalTagToken(source, tag)) return true;
    }
  }
  return false;
}

export function extractAlliancePortalHint(extractionMetadata: unknown): Flow3PortalTarget | null {
  const md =
    extractionMetadata && typeof extractionMetadata === 'object'
      ? (extractionMetadata as Record<string, unknown>)
      : null;
  if (!md) return null;
  const candidates = [
    md.allianceNetwork,
    md.memberNetwork,
    md.network,
    md.alliancePortal,
    md.alliancePortalTarget,
    md.flow3PortalHint,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeMetadataPortalHint(candidate);
    if (!normalized) continue;
    if (normalized === 'GE' || normalized === 'NTUCIM') return 'GE_NTUC';
    if (normalized === 'ALLIANZ' || normalized === 'ALLIANCE') return 'ALLIANZ';
    if (normalized === 'FULLERT' || normalized === 'FULLERTON') return 'FULLERTON';
    if (normalized === 'IHP') return 'IHP';
    if (normalized === 'IXCHANGE' || normalized === 'PARKWAY') return 'IXCHANGE';
    if (
      normalized === 'MHC' ||
      normalized === 'AIA' ||
      normalized === 'AIACLIENT' ||
      normalized === 'AVIVA' ||
      normalized === 'SINGLIFE' ||
      normalized === 'MHCAXA'
    ) {
      return 'MHC';
    }
    if (normalized === 'ALLIANCEMEDINET') return 'ALLIANCE_MEDINET';
  }
  return null;
}

export function isAllianceMedinetTagMatch(value: string | null | undefined): boolean {
  const raw = normalizePortalTag(value);
  if (!raw) return false;
  return ALLIANCE_MEDINET_TAGS.some(tag => hasPortalTagToken(raw, tag));
}

export function extractAllianceMedinetTag(
  payType: string | null | undefined,
  patientName: string | null | undefined
): string | null {
  const sources = [normalizePortalTag(payType), normalizePortalTag(patientName)];
  for (const source of sources) {
    if (!source) continue;
    for (const tag of ALLIANCE_MEDINET_TAGS) {
      if (hasPortalTagToken(source, tag)) return tag;
    }
  }
  return null;
}

export function isAllianceMedinetVisit(
  payType: string | null | undefined,
  patientName: string | null | undefined,
  extractionMetadata: unknown = null
): boolean {
  return resolveFlow3PortalTarget(payType, patientName, extractionMetadata) === 'ALLIANCE_MEDINET';
}

export function getFlow3PortalTargets(): readonly string[] {
  return FLOW3_PORTAL_TARGETS;
}

export function normalizeFlow3PortalTarget(value: string | null | undefined): Flow3PortalTarget | null {
  let code = String(value || '').trim().toUpperCase();
  if (!code) return null;
  if (code === 'FULLERT') code = 'FULLERTON';
  if (code === 'GE' || code === 'NTUC_IM' || code === 'NTUCIM') code = 'GE_NTUC';
  if (code === 'ALLIMED' || code === 'ALL') code = 'IXCHANGE';
  return FLOW3_PORTAL_TARGETS.includes(code as Flow3PortalTarget) ? (code as Flow3PortalTarget) : null;
}

export function resolveFlow3PortalTarget(
  payType: string | null | undefined,
  patientName: string | null | undefined,
  extractionMetadata: unknown = null
): Flow3PortalTarget | null {
  if (containsAnyTag(payType, null, MHC_TAGS)) {
    return 'MHC';
  }
  if (extractAllianceMedinetTag(payType, patientName)) {
    // Route Alliance-Medinet-tagged records to Alliance Medinet first.
    // GE/other reroutes are decided by runtime portal behavior (popup/network response).
    return 'ALLIANCE_MEDINET';
  }
  const hint = extractAlliancePortalHint(extractionMetadata);
  if (hint) return hint;
  if (containsAnyTag(payType, patientName, ALLIANZ_TAGS)) return 'ALLIANZ';
  if (containsAnyTag(payType, patientName, FULLERTON_TAGS)) return 'FULLERTON';
  if (containsAnyTag(payType, patientName, IHP_TAGS)) return 'IHP';
  if (containsAnyTag(payType, patientName, GE_NTUC_TAGS)) return 'GE_NTUC';
  if (containsAnyTag(payType, patientName, IXCHANGE_TAGS)) return 'IXCHANGE';
  if (String(payType || '').toUpperCase().includes('ALLIMED')) return 'IXCHANGE';
  return null;
}

export function matchesFlow3PortalTargets(
  payType: string | null | undefined,
  patientName: string | null | undefined,
  targets: readonly string[] | null | undefined,
  extractionMetadata: unknown = null
): boolean {
  if (!targets || targets.length === 0) return true;
  const normalizedTargets = targets
    .map(t => normalizeFlow3PortalTarget(t))
    .filter((t): t is Flow3PortalTarget => Boolean(t));
  if (normalizedTargets.length === 0) return true;
  const route = resolveFlow3PortalTarget(payType, patientName, extractionMetadata);
  return !!route && normalizedTargets.includes(route);
}

export function getPortalScopeOrFilter(): string {
  const clauses: string[] = [`pay_type.in.(${PORTAL_PAY_TYPES.join(',')})`];
  for (const tag of PATIENT_NAME_PORTAL_TAGS) {
    clauses.push(`pay_type.ilike.%${tag}%`);
    clauses.push(`patient_name.ilike.%${tag}%`);
  }
  return clauses.join(',');
}
