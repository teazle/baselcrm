const IXCHANGE_PATIENT_ID_SELECTORS = [
  'input#patientId',
  'input[id="patientId"]',
  'input[name*="member" i]',
  'input[id*="member" i]',
  'input[name*="nric" i]',
  'input[id*="nric" i]',
  'input[type="search"]',
];

const IXCHANGE_PATIENT_NAME_SELECTORS = [
  'input#patientName',
  'input[id="patientName"]',
  'input[name="patientName"]',
  'input[name*="patientName" i]',
  'input[id*="patientName" i]',
  'input[placeholder*="Patient Name" i]',
];

function normalizeIdentifier(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  if (!raw) return '';
  const nric = raw.match(/[STFGM]\d{7}[A-Z]/);
  if (nric) return nric[0];
  return raw.replace(/[^A-Z0-9]/g, '');
}

function normalizeName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLeadingTag(value) {
  return String(value || '')
    .replace(
      /^(?:\s*(?:TAG\s+)?(?:AVIVA|SINGLIFE|MHC|MHCAXA|AIA|AIACLIENT|GE|NTUC_IM|ALLIANZ|ALLIANCE|FULLERT|IHP|PARKWAY|ALL|TOKIOM|ALLIANC|ALLSING|AXAMED|PRUDEN)\s*)+(?:[|:/-]+\s*)*/i,
      ''
    )
    .trim();
}

function reorderClinicAssistName(value) {
  const cleaned = normalizeName(stripLeadingTag(value));
  if (!cleaned) return '';
  const commaMatch = cleaned.match(/^([^,]+),\s*(.+)$/);
  if (commaMatch) {
    return normalizeName(`${commaMatch[2]} ${commaMatch[1]}`);
  }
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return cleaned;
  return normalizeName([...tokens.slice(1), tokens[0]].join(' '));
}

function getIxchangeTags(visit) {
  const md = visit?.extraction_metadata || {};
  const rawPieces = [
    visit?.pay_type,
    md?.pay_type,
    md?.payType,
    md?.portalTag,
    md?.insuranceTag,
    md?.flow3PortalHint,
  ];
  if (Array.isArray(md?.tags)) rawPieces.push(...md.tags);
  const tags = new Set();
  for (const piece of rawPieces) {
    const raw = String(piece || '').toUpperCase();
    if (!raw) continue;
    for (const token of raw.split(/[^A-Z0-9_]+/).filter(Boolean)) {
      tags.add(token);
    }
  }
  return [...tags];
}

export function resolveIxchangeMode(visit) {
  const tags = getIxchangeTags(visit);
  if (tags.includes('PARKWAY')) return 'PARKWAY';
  if (tags.includes('ALL')) return 'ALL';
  return 'ALL';
}

function extractIxchangeSearchIdentifiers(visit) {
  const md = visit?.extraction_metadata || {};
  const candidates = [
    visit?.nric,
    md?.nric,
    md?.fin,
    md?.idNumber,
    md?.idNo,
    visit?.member_id,
    visit?.memberId,
    md?.member_id,
    md?.memberId,
    md?.healthCardNo,
    md?.healthcardNo,
    md?.externalId,
    md?.staffId,
  ]
    .map(normalizeIdentifier)
    .filter(Boolean);
  return [...new Set(candidates)];
}

function extractIxchangeNameCandidates(visit) {
  const md = visit?.extraction_metadata || {};
  const rawNames = [visit?.patient_name, md?.patient_name, md?.patientName, md?.name];
  const names = [];
  for (const raw of rawNames) {
    const cleaned = normalizeName(stripLeadingTag(raw));
    if (cleaned) names.push(cleaned);
  }
  return [...new Set(names)];
}

function buildModeSignals(mode) {
  return {
    parkway: mode === 'PARKWAY',
    all: mode === 'ALL',
  };
}

function decorateAttempt({ value, inputSelectors, label, mode, tags, attemptKind, purpose }) {
  return {
    value,
    inputSelectors,
    label,
    attemptKind,
    purpose,
    portalTarget: 'IXCHANGE',
    portalName: 'IXCHANGE SPOS',
    searchMode: mode,
    mode,
    modeSignals: buildModeSignals(mode),
    searchTags: [...tags],
  };
}

export function buildIxchangeSearchAttempts({
  visit,
  selectors = {},
  purpose = 'submitted_detail_unavailable',
} = {}) {
  const mode = resolveIxchangeMode(visit);
  const tags = getIxchangeTags(visit);
  const idCandidates = extractIxchangeSearchIdentifiers(visit);
  const nameCandidates = extractIxchangeNameCandidates(visit);
  const patientIdSelectors =
    Array.isArray(selectors.searchInputPatientId) && selectors.searchInputPatientId.length > 0
      ? selectors.searchInputPatientId
      : IXCHANGE_PATIENT_ID_SELECTORS;
  const patientNameSelectors =
    Array.isArray(selectors.searchInputPatientName) && selectors.searchInputPatientName.length > 0
      ? selectors.searchInputPatientName
      : IXCHANGE_PATIENT_NAME_SELECTORS;

  if (mode === 'PARKWAY') {
    return idCandidates.map(value =>
      decorateAttempt({
        value,
        inputSelectors: patientIdSelectors,
        label: 'parkway_nric',
        mode,
        tags,
        attemptKind: 'patient_id',
        purpose,
      })
    );
  }

  const nameVariants = [];
  for (const name of nameCandidates) {
    const reordered = reorderClinicAssistName(name);
    if (reordered) nameVariants.push(reordered);
    nameVariants.push(name);
  }
  const attempts = [...new Set(nameVariants.map(normalizeName).filter(Boolean))].map(value =>
    decorateAttempt({
      value,
      inputSelectors: patientNameSelectors,
      label: 'all_name',
      mode,
      tags,
      attemptKind: 'patient_name',
      purpose,
    })
  );

  if (attempts.length > 0) return attempts;

  return idCandidates.map(value =>
    decorateAttempt({
      value,
      inputSelectors: patientIdSelectors,
      label: 'all_identifier_fallback',
      mode,
      tags,
      attemptKind: 'patient_id',
      purpose,
    })
  );
}

export function buildIxchangeSubmittedTruthCaptureUnavailable({
  visit = null,
  portalTarget = 'IXCHANGE',
  portalName = 'IXCHANGE SPOS',
  auditedAt = new Date().toISOString(),
  sessionState = 'unknown',
  reason = 'submitted_detail_extractor_unavailable_for_ixchange',
  purpose = 'submitted_detail_unavailable',
  selectors = {},
} = {}) {
  const mode = resolveIxchangeMode(visit);
  const tags = getIxchangeTags(visit);
  const attempts = buildIxchangeSearchAttempts({
    visit,
    selectors,
    purpose,
  });

  return {
    found: false,
    reason,
    portalTarget,
    portalName,
    mode,
    modeSignals: buildModeSignals(mode),
    searchTags: tags,
    attempts,
    searchAttemptCount: attempts.length,
    sessionState,
    auditedAt,
    source: 'ixchange_submitted_detail_unavailable',
  };
}
