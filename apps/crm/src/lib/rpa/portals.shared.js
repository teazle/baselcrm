// Shared portal config for both frontend and backend (ESM)
export const ALLIANCE_MEDINET_TAGS = [
  'TOKIOM',
  'ALLIANC',
  'ALLSING',
  'AXAMED',
  'ALLIMED',
  'HSBCLIFE',
  'PRUDEN',
];
export const ALLIANZ_TAGS = ['ALLIANZ'];
export const FULLERTON_TAGS = ['FULLERT', 'AONCARE'];
export const IHP_TAGS = ['IHP'];
export const IXCHANGE_TAGS = ['ALL', 'ALL_PW', 'PARKWAY'];
export const GE_NTUC_TAGS = ['GE'];
export const MHC_TAGS = ['MHC', 'AVIVA', 'NTUC_IM', 'MHCAXA'];
export const AMBIGUOUS_INSURER_NAMES = [
  'AIA',
  'AIACLIENT',
  'SINGLIFE',
  'GREAT EASTERN',
  'GREATEASTERN',
  'PRUDENTIAL',
  'QBE',
  'AXA',
  'HSBC',
  'INCOME',
  'TOKIO MARINE',
];
export const CA_PORTAL_TAG_ROUTES = Object.freeze({
  MHC: ['MHC', 'AVIVA', 'NTUC_IM'],
  ALLIANZ: ['ALLIANZ'],
  FULLERTON: ['FULLERT', 'AONCARE'],
  IHP: ['IHP'],
  IXCHANGE: ['ALL', 'ALL_PW', 'PARKWAY'],
  ALLIANCE_MEDINET: ['ALLIANC', 'ALLSING', 'AXAMED', 'ALLIMED', 'HSBCLIFE', 'PRUDEN', 'TOKIOM'],
  GE_NTUC: ['GE'],
});
export const SUPPORTED_PORTALS = [...MHC_TAGS, ...ALLIANCE_MEDINET_TAGS];
export const UNSUPPORTED_PORTALS = [
  ...ALLIANZ_TAGS,
  ...FULLERTON_TAGS,
  ...IHP_TAGS,
  ...IXCHANGE_TAGS,
  ...GE_NTUC_TAGS,
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
  'ALL_PW',
  'ALL',
  'ALLIMED',
  'AONCARE',
  'HSBCLIFE',
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
  'ALLIMED',
  'HSBCLIFE',
  'ALLIANZ',
  'ALLIANCE',
  'FULLERT',
  'AONCARE',
  'PARKWAY',
  'ALL_PW',
  'NTUC_IM',
  'MHCAXA',
];
export const CLAIM_CANDIDATE_STATUSES = ['claim_candidate', 'not_claim_candidate', 'manual_review'];
export const FLOW3_UI_STATUSES = [
  'candidate_pending',
  'manual_review',
  'shadow_fill_ready',
  'filled_unverified',
  'truth_unavailable',
  'truth_captured',
  'drift_mismatch',
  'otp_blocked',
  'sms_otp_required',
  'captcha_blocked',
  'portal_read_only',
  'portal_unavailable',
  'not_found',
  'login_blocked',
  'session_blocked',
  'draft',
  'submitted',
  'error',
];

function lowerMeta(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function hasRealFlow3Mismatches(comparison) {
  const c = comparison && typeof comparison === 'object' ? comparison : null;
  if (!c) return false;
  const categories = Array.isArray(c.mismatchCategories) ? c.mismatchCategories : [];
  return categories.some(category => {
    const key = lowerMeta(category);
    return key.length > 0 && key !== 'submitted_truth_unavailable';
  });
}

function hasFilledUnverifiedFields(fillVerification) {
  const fv = fillVerification && typeof fillVerification === 'object' ? fillVerification : null;
  if (!fv) return false;
  return Object.values(fv).some(value => {
    const node = value && typeof value === 'object' ? value : null;
    return lowerMeta(node?.status) === 'filled_unverified';
  });
}

export function deriveFlow3UiStatus(submissionStatus, submissionMetadata) {
  const status = lowerMeta(submissionStatus);
  const md = submissionMetadata && typeof submissionMetadata === 'object' ? submissionMetadata : {};
  const sessionState = lowerMeta(md.sessionState);
  const blockedReason = lowerMeta(md.blocked_reason ?? md.blockedReason ?? md.reason);
  const comparison = md.comparison && typeof md.comparison === 'object' ? md.comparison : null;

  if (status === 'submitted') return 'submitted';
  if (status === 'draft') return 'draft';
  if (sessionState === 'captcha_blocked' || blockedReason.includes('captcha'))
    return 'captcha_blocked';
  if (blockedReason === 'portal_sms_otp_required' || sessionState === 'sms_otp_required')
    return 'sms_otp_required';
  if (sessionState === 'otp_blocked' || blockedReason.includes('otp')) return 'otp_blocked';
  if (blockedReason === 'member_not_found' || blockedReason === 'not_found') return 'not_found';
  if (
    sessionState === 'login_blocked' ||
    blockedReason.includes('login_not_advanced') ||
    blockedReason.includes('invalid_credentials') ||
    blockedReason.includes('auth_failed')
  )
    return 'login_blocked';
  if (sessionState === 'session_conflict' || blockedReason.includes('session_conflict'))
    return 'session_blocked';
  if (blockedReason.includes('read_only') || blockedReason.includes('no_claim_form'))
    return 'portal_read_only';
  if (sessionState === 'portal_unavailable' || blockedReason === 'portal_unavailable')
    return 'portal_unavailable';
  if (status === 'error' || md.success === false) return 'error';
  if (hasRealFlow3Mismatches(comparison)) return 'drift_mismatch';
  if (md.submittedTruthSnapshot || md.submittedTruthCapture?.found === true)
    return 'truth_captured';
  if (
    md.submittedTruthCapture?.found === false ||
    blockedReason === 'submitted_truth_unavailable' ||
    comparison?.unavailableReason === 'submitted_truth_unavailable'
  ) {
    return 'truth_unavailable';
  }
  if (
    lowerMeta(md.mode) === 'fill_evidence' &&
    md.success === true &&
    md.botSnapshot &&
    hasFilledUnverifiedFields(md.fillVerification)
  ) {
    return 'filled_unverified';
  }
  if (lowerMeta(md.mode) === 'fill_evidence' && md.success === true && md.botSnapshot) {
    return 'shadow_fill_ready';
  }
  return 'candidate_pending';
}

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

function normalizedAmbiguousInsurerName(value) {
  const raw = normalizePortalTag(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  for (const name of AMBIGUOUS_INSURER_NAMES) {
    if (raw === name || raw.includes(` ${name} `) || raw.startsWith(`${name} `)) return name;
  }
  return null;
}

function normalizeCandidateStatus(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (raw === 'claim_candidate' || raw === 'not_claim_candidate' || raw === 'manual_review') {
    return raw;
  }
  return null;
}

function uniqueStrings(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function hasUsableNric(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  if (!raw) return false;
  return /[STFGM]\d{7}[A-Z]/.test(raw) || raw.length >= 5;
}

function looksLikeCreditCardPayType(value) {
  return /\b(CREDIT\s*CARD|VISA|MASTERCARD|AMEX)\b/.test(value);
}

function looksLikeCashOrSelfPay(value) {
  return /\b(CASH|SELF\s*PAY(?:MENT)?|PRIVATE\s*PAY|SELFPAY)\b/.test(value);
}

function findMatchedPortalTag(payType, patientName, tags, { includePatientName = true } = {}) {
  const sources = [
    { source: 'pay_type', value: normalizePortalTag(payType) },
    includePatientName ? { source: 'patient_name', value: normalizePortalTag(patientName) } : null,
  ].filter(Boolean);
  for (const source of sources) {
    if (!source.value) continue;
    for (const tag of [...tags].sort((a, b) => String(b).length - String(a).length)) {
      if (hasPortalTagToken(source.value, tag)) {
        return { tag, source: source.source };
      }
    }
  }
  return null;
}

export function resolveFlow3PortalRouting(payType, patientName, extractionMetadata = null) {
  for (const [portalTarget, tags] of Object.entries(CA_PORTAL_TAG_ROUTES)) {
    const matched = findMatchedPortalTag(payType, patientName, tags, {
      includePatientName: portalTarget !== 'MHC',
    });
    if (matched) {
      return {
        portalTarget,
        source: matched.source,
        tag: matched.tag,
        reason: 'ca_portal_tag_guide',
      };
    }
  }

  const hint = extractAlliancePortalHint(extractionMetadata);
  if (hint) {
    return {
      portalTarget: hint,
      source: 'extraction_metadata',
      tag: null,
      reason: 'metadata_hint',
    };
  }

  const ambiguous = normalizedAmbiguousInsurerName(payType);
  if (ambiguous) {
    return {
      portalTarget: null,
      source: null,
      tag: ambiguous,
      reason: 'ambiguous_insurer_name',
    };
  }

  const legacyChecks = [
    ['MHC', MHC_TAGS, false],
    ['ALLIANCE_MEDINET', ALLIANCE_MEDINET_TAGS, true],
    ['ALLIANZ', ALLIANZ_TAGS, true],
    ['FULLERTON', FULLERTON_TAGS, true],
    ['IHP', IHP_TAGS, true],
    ['GE_NTUC', GE_NTUC_TAGS, true],
    ['IXCHANGE', IXCHANGE_TAGS, true],
  ];
  for (const [portalTarget, tags, includePatientName] of legacyChecks) {
    const matched = findMatchedPortalTag(payType, patientName, tags, { includePatientName });
    if (matched) {
      return {
        portalTarget,
        source: matched.source,
        tag: matched.tag,
        reason: 'legacy_portal_tag',
      };
    }
  }
  return {
    portalTarget: null,
    source: null,
    tag: null,
    reason: 'portal_unknown',
  };
}

export function describePortalRouting(payType, patientName, extractionMetadata = null) {
  const routing = resolveFlow3PortalRouting(payType, patientName, extractionMetadata);
  return {
    portalTarget: routing.portalTarget,
    portalTag: routing.tag,
    portalRoutingSource:
      routing.reason === 'ca_portal_tag_guide'
        ? 'tpa_user_interface_guide'
        : routing.reason === 'metadata_hint'
          ? 'extraction_metadata'
          : null,
    reason: routing.reason,
    source: routing.source,
    tag: routing.tag,
  };
}

export function extractAlliancePortalHint(extractionMetadata) {
  const md =
    extractionMetadata && typeof extractionMetadata === 'object' ? extractionMetadata : null;
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
    if (normalized === 'GE') return 'GE_NTUC';
    if (normalized === 'ALLIANZ') return 'ALLIANZ';
    if (normalized === 'FULLERT' || normalized === 'FULLERTON' || normalized === 'AONCARE')
      return 'FULLERTON';
    if (normalized === 'IHP') return 'IHP';
    if (normalized === 'IXCHANGE' || normalized === 'PARKWAY' || normalized === 'ALLPW')
      return 'IXCHANGE';
    if (
      normalized === 'MHC' ||
      normalized === 'AVIVA' ||
      normalized === 'NTUCIM' ||
      normalized === 'MHCAXA'
    ) {
      return 'MHC';
    }
    if (
      normalized === 'ALLIANCEMEDINET' ||
      normalized === 'ALLIANC' ||
      normalized === 'ALLIANCE' ||
      normalized === 'ALLSING' ||
      normalized === 'AXAMED' ||
      normalized === 'ALLIMED' ||
      normalized === 'HSBCLIFE' ||
      normalized === 'PRUDEN' ||
      normalized === 'TOKIOM'
    )
      return 'ALLIANCE_MEDINET';
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
  let code = String(value || '')
    .trim()
    .toUpperCase();
  if (!code) return null;
  if (code === 'FULLERT' || code === 'AONCARE') code = 'FULLERTON';
  if (code === 'GE') code = 'GE_NTUC';
  if (code === 'NTUC_IM' || code === 'NTUCIM' || code === 'AVIVA' || code === 'MHCAXA')
    code = 'MHC';
  if (code === 'ALLIMED' || code === 'HSBCLIFE') code = 'ALLIANCE_MEDINET';
  if (code === 'ALL' || code === 'ALL_PW' || code === 'PARKWAY') code = 'IXCHANGE';
  return FLOW3_PORTAL_TARGETS.includes(code) ? code : null;
}

export function resolveFlow3PortalTarget(payType, patientName, extractionMetadata = null) {
  return resolveFlow3PortalRouting(payType, patientName, extractionMetadata).portalTarget;
}

export function classifyVisitForRpa(
  payType,
  patientName,
  nric,
  extractionMetadata = null,
  submissionStatus = null
) {
  const normalizedPayType = normalizePortalTag(payType).replace(/\s+/g, ' ').trim();
  const existingStatus =
    extractionMetadata && typeof extractionMetadata === 'object'
      ? normalizeCandidateStatus(extractionMetadata.claimCandidateStatus)
      : null;
  const routing = resolveFlow3PortalRouting(payType, patientName, extractionMetadata);
  const route = routing.portalTarget;
  const metadataNric =
    extractionMetadata && typeof extractionMetadata === 'object'
      ? String(extractionMetadata.nric || '').trim()
      : '';
  const hasNric = hasUsableNric(nric) || hasUsableNric(metadataNric);
  const submission = String(submissionStatus || '')
    .trim()
    .toLowerCase();

  if (submission === 'draft' || submission === 'submitted') {
    return {
      status: 'not_claim_candidate',
      reasons: ['already_submitted'],
      portalTarget: route,
      normalizedPayType,
      hasNric,
    };
  }

  if (normalizedPayType && looksLikeCreditCardPayType(normalizedPayType)) {
    return {
      status: 'not_claim_candidate',
      reasons: ['credit_card'],
      portalTarget: route,
      normalizedPayType,
      hasNric,
    };
  }

  if (normalizedPayType && looksLikeCashOrSelfPay(normalizedPayType)) {
    return {
      status: 'not_claim_candidate',
      reasons: ['cash_self_pay'],
      portalTarget: route,
      normalizedPayType,
      hasNric,
    };
  }

  if (route) {
    const reasons = uniqueStrings(['portal_supported', !hasNric ? 'missing_nric' : null]);
    return {
      status: hasNric ? 'claim_candidate' : 'manual_review',
      reasons,
      portalTarget: route,
      portalRouting: routing,
      normalizedPayType,
      hasNric,
    };
  }

  if (existingStatus) {
    return {
      status: existingStatus,
      reasons: uniqueStrings([routing.reason || 'portal_unknown']),
      portalTarget: route,
      normalizedPayType,
      hasNric,
    };
  }

  return {
    status: 'manual_review',
    reasons: [routing.reason || 'portal_unknown'],
    portalTarget: null,
    normalizedPayType,
    hasNric,
  };
}

export function isFlow2EligibleVisit(extractionMetadata = null) {
  const status =
    extractionMetadata && typeof extractionMetadata === 'object'
      ? normalizeCandidateStatus(extractionMetadata.claimCandidateStatus)
      : null;
  if (status === 'claim_candidate' || status === 'manual_review') return true;
  if (status === 'not_claim_candidate') return false;
  return true;
}

export function matchesFlow3PortalTargets(
  payType,
  patientName,
  targets,
  extractionMetadata = null
) {
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
