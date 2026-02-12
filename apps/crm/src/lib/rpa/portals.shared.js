// Shared portal config for both frontend and backend (ESM)
export const ALLIANCE_MEDINET_TAGS = ['TOKIOM', 'ALLIANC', 'ALLSING', 'AXAMED', 'PRUDEN'];
export const SUPPORTED_PORTALS = ['MHC', 'AIA', 'AIACLIENT', ...ALLIANCE_MEDINET_TAGS];
export const UNSUPPORTED_PORTALS = ['IHP', 'GE', 'FULLERT', 'ALLIMED', 'ALL', 'ALLIANCE'];
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

export function isAllianceMedinetTagMatch(value) {
  const raw = normalizePortalTag(value);
  if (!raw) return false;
  return ALLIANCE_MEDINET_TAGS.some(tag => raw.includes(tag));
}

export function extractAllianceMedinetTag(payType, patientName) {
  const sources = [normalizePortalTag(payType), normalizePortalTag(patientName)];
  for (const source of sources) {
    if (!source) continue;
    for (const tag of ALLIANCE_MEDINET_TAGS) {
      if (source.includes(tag)) return tag;
    }
  }
  return null;
}

export function isAllianceMedinetVisit(payType, patientName) {
  return !!extractAllianceMedinetTag(payType, patientName);
}

export function getPortalScopeOrFilter() {
  const clauses = [`pay_type.in.(${PORTAL_PAY_TYPES.join(',')})`];
  for (const tag of ALLIANCE_MEDINET_TAGS) {
    clauses.push(`pay_type.ilike.%${tag}%`);
    clauses.push(`patient_name.ilike.%${tag}%`);
  }
  return clauses.join(',');
}
