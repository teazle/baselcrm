// Shared portal config for both frontend and backend (ESM)
export const ALLIANCE_MEDINET_TAGS = ['TOKIOM', 'ALLIANC', 'ALLSING', 'AXAMED', 'PRUDEN'];
export const ALLIANZ_TAGS = ['ALLIANZ', 'ALLIANCE'];
export const FULLERTON_TAGS = ['FULLERT'];
export const IHP_TAGS = ['IHP'];
export const IXCHANGE_TAGS = ['PARKWAY', 'ALL'];
export const GE_NTUC_TAGS = ['GE', 'NTUC_IM'];
export const MHC_TAGS = ['MHC', 'AIA', 'AIACLIENT', 'AVIVA', 'SINGLIFE', 'MHCAXA'];
export const SUPPORTED_PORTALS = [...MHC_TAGS, ...ALLIANCE_MEDINET_TAGS];
export const UNSUPPORTED_PORTALS = [
  ...ALLIANZ_TAGS,
  ...FULLERTON_TAGS,
  ...IHP_TAGS,
  ...IXCHANGE_TAGS,
  ...GE_NTUC_TAGS,
  'ALLIMED',
];
export const FLOW3_PORTAL_TARGETS = [
  'MHC',
  'ALLIANCE_MEDINET',
  'ALLIANZ',
  'FULLERTON',
  'IHP',
  'IXCHANGE',
  'GE_NTUC',
];
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
];
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
];

export function isSupportedPortal(payType) {
  if (!payType) return false;
  return SUPPORTED_PORTALS.includes(String(payType).toUpperCase());
}

export function isUnsupportedPortal(payType) {
  if (!payType) return false;
  return UNSUPPORTED_PORTALS.includes(String(payType).toUpperCase());
}

export function getSupportedPortals() {
  return SUPPORTED_PORTALS;
}

export function getUnsupportedPortals() {
  return UNSUPPORTED_PORTALS;
}

export function getPortalPayTypes() {
  return PORTAL_PAY_TYPES;
}

function normalizePortalTag(value) {
  return String(value || '').toUpperCase();
}

function hasPortalTagToken(source, tag) {
  return new RegExp(`(^|[^A-Z0-9])${tag}([^A-Z0-9]|$)`).test(source);
}

function normalizeMetadataPortalHint(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .trim();
}

function containsAnyTag(payType, patientName, tags) {
  const sources = [normalizePortalTag(payType), normalizePortalTag(patientName)];
  for (const source of sources) {
    if (!source) continue;
    for (const tag of tags) {
      if (hasPortalTagToken(source, tag)) return true;
    }
  }
  return false;
}

export function extractAlliancePortalHint(extractionMetadata) {
  const md = extractionMetadata && typeof extractionMetadata === 'object' ? extractionMetadata : null;
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

export function isAllianceMedinetTagMatch(value) {
  const raw = normalizePortalTag(value);
  if (!raw) return false;
  return ALLIANCE_MEDINET_TAGS.some(tag => hasPortalTagToken(raw, tag));
}

export function extractAllianceMedinetTag(payType, patientName) {
  const sources = [normalizePortalTag(payType), normalizePortalTag(patientName)];
  for (const source of sources) {
    if (!source) continue;
    for (const tag of ALLIANCE_MEDINET_TAGS) {
      if (hasPortalTagToken(source, tag)) return tag;
    }
  }
  return null;
}

export function isAllianceMedinetVisit(payType, patientName, extractionMetadata = null) {
  return resolveFlow3PortalTarget(payType, patientName, extractionMetadata) === 'ALLIANCE_MEDINET';
}

export function getFlow3PortalTargets() {
  return FLOW3_PORTAL_TARGETS;
}

export function normalizeFlow3PortalTarget(value) {
  let code = String(value || '').trim().toUpperCase();
  if (!code) return null;
  if (code === 'FULLERT') code = 'FULLERTON';
  if (code === 'GE' || code === 'NTUC_IM' || code === 'NTUCIM') code = 'GE_NTUC';
  if (code === 'ALLIMED' || code === 'ALL') code = 'IXCHANGE';
  return FLOW3_PORTAL_TARGETS.includes(code) ? code : null;
}

export function resolveFlow3PortalTarget(payType, patientName, extractionMetadata = null) {
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

export function matchesFlow3PortalTargets(payType, patientName, targets, extractionMetadata = null) {
  if (!targets || targets.length === 0) return true;
  const normalizedTargets = targets.map(t => normalizeFlow3PortalTarget(t)).filter(Boolean);
  if (normalizedTargets.length === 0) return true;
  const route = resolveFlow3PortalTarget(payType, patientName, extractionMetadata);
  return !!route && normalizedTargets.includes(route);
}

export function getPortalScopeOrFilter() {
  const clauses = [`pay_type.in.(${PORTAL_PAY_TYPES.join(',')})`];
  for (const tag of PATIENT_NAME_PORTAL_TAGS) {
    clauses.push(`pay_type.ilike.%${tag}%`);
    clauses.push(`patient_name.ilike.%${tag}%`);
  }
  return clauses.join(',');
}
